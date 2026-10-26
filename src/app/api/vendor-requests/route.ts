import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing, docVisibleTo } from '@/lib/auth';
import { PSTATUS_DIMINTA } from '@/lib/constants';
import { mailConfigured, sendCustomerMail } from '@/lib/email-notify';
import { validEmail } from '@/lib/notif-prefs';
import { prisma } from '@/lib/prisma';
import { canSeeVendors } from '@/lib/roles';
import { getObjectBuffer, isS3Configured, presignGet } from '@/lib/s3';
import { emitCrmEvent } from '@/lib/socket';
import type { RfqItem } from '@/lib/types';
import { vrFromRow, vrLines, waNumber, waUrl } from '@/lib/vendor-request';
import { appBaseUrl, buildVrPdf, buildVrXlsx, vrEmailHtml, vrFileUrl, vrToken } from '@/lib/vendor-request-server';

/**
 * Minta harga ke vendor (Purchasing).
 *   GET  ?rfqId= | ?fupaId=         → { requests }
 *   POST { rfqId | fupaId, vendors: [{ vendorId, channel: email|wa|both }],
 *          idxs?, tenggat, lokasi, subject, message, attach: { pdf, xlsx, gambar } }
 *     → email terpisah per vendor (tanpa nama customer) + tautan WhatsApp
 *       (dibuka berurutan di browser). { results: [{ vendorId, requestId, email, waUrl }] }
 */

async function loadDoc(rfqId: string | null, fupaId: string | null) {
  if (rfqId) {
    const d = await prisma.rfq.findUnique({ where: { id: rfqId } });
    return d ? { no: d.noRfq || 'RFQ', items: (d.items as unknown as RfqItem[]) || [], prospectId: d.prospectId } : null;
  }
  if (fupaId) {
    const d = await prisma.fupa.findUnique({ where: { id: fupaId } });
    return d ? { no: d.noFupa || 'FUP A', items: (d.items as unknown as RfqItem[]) || [], prospectId: d.prospectId } : null;
  }
  return null;
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canSeeVendors(user.role)) return NextResponse.json({ requests: [] });
  const { searchParams } = new URL(req.url);
  const rfqId = searchParams.get('rfqId');
  const fupaId = searchParams.get('fupaId');
  const vendorId = searchParams.get('vendorId');
  if (!rfqId && !fupaId && !vendorId) return NextResponse.json({ error: 'rfqId, fupaId atau vendorId wajib' }, { status: 400 });
  if ((rfqId || fupaId) && !(await docVisibleTo(user, { rfqId, fupaId }))) return NextResponse.json({ requests: [] });
  const rows = await prisma.quotation.findMany({
    where: rfqId ? { rfqId } : fupaId ? { fupaId } : { vendorId: vendorId as string },
    include: { vendor: { select: { nama: true, email: true, wa: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ requests: rows.map((r) => vrFromRow(r as never)) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) return NextResponse.json({ error: 'Hanya Purchasing yang meminta harga ke vendor.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const rfqId = body?.rfqId ? String(body.rfqId) : null;
  const fupaId = body?.fupaId ? String(body.fupaId) : null;
  if (!rfqId && !fupaId) return NextResponse.json({ error: 'Dokumen RFQ / FUP A wajib.' }, { status: 400 });
  if (!(await docVisibleTo(user, { rfqId, fupaId }))) return NextResponse.json({ error: 'Dokumen tidak ditemukan' }, { status: 404 });
  const doc = await loadDoc(rfqId, fupaId);
  if (!doc) return NextResponse.json({ error: 'Dokumen tidak ditemukan' }, { status: 404 });

  const picks = (Array.isArray(body.vendors) ? body.vendors : []) as { vendorId?: unknown; channel?: unknown }[];
  if (!picks.length) return NextResponse.json({ error: 'Pilih minimal satu vendor.' }, { status: 400 });
  if (picks.length > 30) return NextResponse.json({ error: 'Maksimal 30 vendor sekali kirim.' }, { status: 400 });
  const idxs = Array.isArray(body.idxs) ? body.idxs.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0) : [];
  const lines = vrLines(doc.items, idxs);
  if (!lines.length) return NextResponse.json({ error: 'Pilih minimal satu item.' }, { status: 400 });
  const tenggat = /^\d{4}-\d{2}-\d{2}$/.test(String(body.tenggat || '')) ? String(body.tenggat) : '';
  const lokasi = String(body.lokasi || '').slice(0, 120);
  const subject = String(body.subject || `Permintaan penawaran harga — ${doc.no}`).slice(0, 200);
  const message = String(body.message || '').slice(0, 8000);
  if (!message.trim()) return NextResponse.json({ error: 'Isi pesan wajib.' }, { status: 400 });
  const attach = (body.attach || {}) as { pdf?: boolean; xlsx?: boolean; gambar?: boolean };

  const vendors = await prisma.vendor.findMany({ where: { id: { in: picks.map((p) => String(p.vendorId || '')) } } });
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const blocked = vendors.filter((v) => v.statusAvl === 'diblokir');
  if (blocked.length) return NextResponse.json({ error: `Vendor diblokir tidak bisa dimintai harga: ${blocked.map((v) => v.nama).join(', ')}` }, { status: 400 });
  const wantsEmail = picks.some((p) => p.channel === 'email' || p.channel === 'both');
  if (wantsEmail && !mailConfigured()) return NextResponse.json({ error: 'Server email belum diatur — pilih WhatsApp saja.', code: 'NO_SMTP' }, { status: 503 });

  // Lampiran (dibuat sekali, dipakai untuk semua email).
  const meta = { docNo: doc.no, tenggat, lokasi, sender: user.name };
  const files: { filename: string; content: Buffer; contentType: string }[] = [];
  const safeNo = doc.no.replace(/[^\w-]+/g, '_');
  if (attach.pdf) files.push({ filename: `RFQ_Vendor_${safeNo}.pdf`, content: await buildVrPdf(lines, meta), contentType: 'application/pdf' });
  if (attach.xlsx) files.push({ filename: `RFQ_Vendor_${safeNo}.xlsx`, content: await buildVrXlsx(lines, meta), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const gambar = attach.gambar && isS3Configured()
    ? await prisma.attachment.findMany({ where: { OR: [rfqId ? { rfqId } : { fupaId }, ...(doc.prospectId ? [{ prospectId: doc.prospectId }] : [])] }, orderBy: { createdAt: 'asc' } })
    : [];
  const gambarFiles: typeof files = [];
  let gambarBytes = 0;
  for (const g of gambar) {
    if (gambarBytes > 15 * 1024 * 1024) break;
    try {
      const buf = await getObjectBuffer(g.key);
      gambarBytes += buf.length;
      gambarFiles.push({ filename: g.name, content: buf, contentType: g.type || 'application/octet-stream' });
    } catch {
      /* lampiran yang gagal diambil dilewati */
    }
  }
  const gambarLinks = gambar.length ? await Promise.all(gambar.map(async (g) => ({ name: g.name, url: await presignGet(g.key, g.name, 7 * 86400).catch(() => '') }))) : [];

  const base = appBaseUrl(req);
  const today = new Date().toISOString().slice(0, 10);
  const results: { vendorId: string; vendorNama: string; requestId: string; email: 'ok' | 'gagal' | 'tanpa-email' | null; waUrl: string | null; error?: string }[] = [];
  for (const p of picks) {
    const v = byId.get(String(p.vendorId || ''));
    if (!v) continue;
    const ch = p.channel === 'email' || p.channel === 'wa' || p.channel === 'both' ? (p.channel as string) : 'email';
    const existing = await prisma.quotation.findFirst({ where: { vendorId: v.id, ...(rfqId ? { rfqId } : { fupaId }) } });
    const data = { tglDiminta: today, channel: ch, tenggat: tenggat || null, sentAt: new Date(), requestedBy: user.name, catatan: lokasi ? `Lokasi kirim: ${lokasi}` : null };
    const q = existing
      ? await prisma.quotation.update({ where: { id: existing.id }, data: { ...data, status: 'menunggu', balasAt: null } })
      : await prisma.quotation.create({ data: { ...data, vendorId: v.id, rfqId, fupaId, status: 'menunggu' } });
    if (!q.token) await prisma.quotation.update({ where: { id: q.id }, data: { token: vrToken(q.id) } });
    const greet = message
      .replace(/ Bapak\/Ibu \{pic\}/g, v.pic ? ` Bapak/Ibu ${v.pic}` : '')
      .replace(/\{pic\}/g, v.pic || '')
      .replace(/\{vendor\}/g, v.nama);
    const r: (typeof results)[number] = { vendorId: v.id, vendorNama: v.nama, requestId: q.id, email: null, waUrl: null };
    if (ch === 'email' || ch === 'both') {
      const to = String(v.email || '').split(/[;,\s]+/).filter((e) => validEmail(e));
      if (!to.length) r.email = 'tanpa-email';
      else {
        const all = [...files, ...gambarFiles];
        const res = await sendCustomerMail({
          userId: user.id,
          kind: 'vendor-rfq',
          senderName: `Purchasing (${user.name})`,
          replyTo: user.email || undefined,
          to,
          cc: [],
          subject,
          html: vrEmailHtml(greet, all.map((f) => f.filename)),
          text: greet,
          attachments: all,
        });
        r.email = res.ok ? 'ok' : 'gagal';
        if (!res.ok) r.error = res.error;
      }
    }
    if (ch === 'wa' || ch === 'both') {
      const num = waNumber(v.wa);
      if (num) {
        const links = [
          attach.pdf ? `Daftar item (PDF): ${vrFileUrl(base, q.id, 'pdf')}` : '',
          attach.xlsx ? `Daftar item (Excel): ${vrFileUrl(base, q.id, 'xlsx')}` : '',
          ...gambarLinks.filter((g) => g.url).map((g) => `Gambar kerja ${g.name}: ${g.url}`),
        ].filter(Boolean);
        r.waUrl = waUrl(num, links.length ? `${greet}\n\n${links.join('\n')}` : greet);
      }
    }
    results.push(r);
  }

  // Dokumen naik ke tahap "Diminta Penawaran" seperti permintaan penawaran lama.
  if (rfqId) {
    const parent = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { purchStatus: true } });
    if (parent && parent.purchStatus < PSTATUS_DIMINTA) emitCrmEvent('rfq:updated', await prisma.rfq.update({ where: { id: rfqId }, data: { purchStatus: PSTATUS_DIMINTA } }));
  } else if (fupaId) {
    const parent = await prisma.fupa.findUnique({ where: { id: fupaId }, select: { purchStatus: true } });
    if (parent && parent.purchStatus < PSTATUS_DIMINTA) emitCrmEvent('fupa:updated', await prisma.fupa.update({ where: { id: fupaId }, data: { purchStatus: PSTATUS_DIMINTA } }));
  }
  await logActivity({
    user,
    action: 'create',
    entity: 'quotation',
    entityId: results[0]?.requestId || user.id,
    summary: `Minta harga ${doc.no} ke ${results.length} vendor (${lines.length} item): ${results.map((r) => r.vendorNama).join(', ')}`,
  });
  return NextResponse.json({ results });
}
