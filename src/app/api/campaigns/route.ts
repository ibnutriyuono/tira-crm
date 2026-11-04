import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { CAMPAIGN_WINDOW_DAYS, canRunCampaign, type CampaignResultRow, type CampaignSummary, type CampaignTarget } from '@/lib/campaign';
import { MAIL_ATTACH_TYPES, MAIL_MAX_ATTACH_BYTES, MAIL_MAX_RECIPIENTS, composeEmailHtml, composeEmailText } from '@/lib/compose-email';
import { mailConfigured, sendCustomerMail } from '@/lib/email-notify';
import { validEmail } from '@/lib/notif-prefs';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
const JABATAN: Record<string, string> = { marketing: 'Product & Marketing', vp: 'Vice President', gm: 'General Manager', admin: 'Administrator CRM' };

let logoCache: Buffer | null | undefined;
async function logo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = await readFile(path.join(process.cwd(), 'public', 'logo.png'));
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/** Riwayat kampanye + hasilnya (prospek customer sasaran setelah kampanye). */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'marketing', 'v');
  if (denied) return denied;
  if (!canRunCampaign(user.role)) return NextResponse.json({ error: 'Kampanye untuk Product & Marketing, GM, VP dan Admin.' }, { status: 403 });

  const rows = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const names = Array.from(new Set(rows.flatMap((c) => ((c.targets as unknown as CampaignTarget[]) || []).map((t) => norm(t.name)))));
  const minSent = rows.reduce<Date | null>((m, c) => (c.sentAt && (!m || c.sentAt < m) ? c.sentAt : m), null);
  const prospects = names.length && minSent
    ? await prisma.prospect.findMany({
        where: { createdAt: { gte: minSent }, customer: { in: rows.flatMap((c) => ((c.targets as unknown as CampaignTarget[]) || []).map((t) => t.name)), mode: 'insensitive' } },
        select: { customer: true, createdAt: true, status: true, value: true, penawaranTerkirim: true },
      })
    : [];
  const byName = new Map<string, typeof prospects>();
  prospects.forEach((p) => byName.set(norm(p.customer), [...(byName.get(norm(p.customer)) || []), p]));

  const out: CampaignSummary[] = rows.map((c) => {
    const targets = (c.targets as unknown as CampaignTarget[]) || [];
    const from = c.sentAt?.getTime() ?? 0;
    const to = from + CAMPAIGN_WINDOW_DAYS * 86400000;
    const resRows: CampaignResultRow[] = targets.map((t) => {
      const ps = (byName.get(norm(t.name)) || []).filter((p) => p.createdAt.getTime() >= from && p.createdAt.getTime() <= to && Number(p.status) >= 1);
      const pen = ps.filter((p) => (Number(p.status) >= 2 && Number(p.status) <= 5) || p.penawaranTerkirim);
      const po = ps.filter((p) => Number(p.status) === 4 || Number(p.status) === 5);
      return {
        name: t.name,
        cabang: t.cabang,
        prospek: ps.length,
        penawaran: pen.length,
        po: po.length,
        nilaiPo: po.reduce((s, p) => s + Number(p.value || 0), 0),
        best: po.length ? 'po' : pen.length ? 'penawaran' : ps.length ? 'prospek' : '',
      };
    });
    const f = (c.filter as Record<string, unknown>) || {};
    return {
      id: c.id,
      nama: c.nama,
      channel: f.channel === 'manual' ? 'manual' : 'email',
      subject: c.subject,
      sentAt: c.sentAt ? c.sentAt.toISOString() : null,
      createdBy: c.createdBy,
      targets: targets.length,
      sentCount: c.sentCount,
      failed: (c.failed as unknown as string[]) || [],
      filterText: String(f.text || ''),
      result: {
        customers: resRows.filter((r) => r.best).length,
        prospek: resRows.reduce((s, r) => s + r.prospek, 0),
        penawaran: resRows.reduce((s, r) => s + r.penawaran, 0),
        po: resRows.reduce((s, r) => s + r.po, 0),
        nilaiPo: resRows.reduce((s, r) => s + r.nilaiPo, 0),
        rows: resRows.sort((a, b) => b.nilaiPo - a.nilaiPo || b.prospek - a.prospek),
      },
    };
  });
  return NextResponse.json({ campaigns: out, smtp: mailConfigured() });
}

/**
 * Buat kampanye: { nama, channel: 'email'|'manual', filter: { text, ... },
 *   targets: [{ customerId, emails[] }], subject, message, attachments[] }.
 * Email: satu email per customer ke alamat yang tercatat di customer itu.
 * Manual: daftar disimpan untuk ditindaklanjuti (telepon / kunjungan) dan tetap diukur hasilnya.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'marketing', 'v');
  if (denied) return denied;
  if (!canRunCampaign(user.role)) return NextResponse.json({ error: 'Kampanye untuk Product & Marketing, GM, VP dan Admin.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });

  const nama = str(body.nama, 120);
  const channel = body.channel === 'manual' ? 'manual' : 'email';
  const subject = str(body.subject, 200);
  const message = str(body.message, 10000);
  if (!nama) return NextResponse.json({ error: 'Nama kampanye wajib diisi.' }, { status: 400 });
  if (channel === 'email' && (!subject || !message)) return NextResponse.json({ error: 'Subjek dan isi email wajib diisi.' }, { status: 400 });
  if (channel === 'email' && !mailConfigured()) return NextResponse.json({ error: 'Server email belum diatur — simpan sebagai kampanye manual atau minta Admin mengatur SMTP.', code: 'NO_SMTP' }, { status: 503 });

  const reqs = (Array.isArray(body.targets) ? body.targets : []).slice(0, 1000) as { customerId?: unknown; emails?: unknown }[];
  if (!reqs.length) return NextResponse.json({ error: 'Pilih minimal satu customer.' }, { status: 400 });
  const ids = reqs.map((r) => String(r.customerId || ''));
  const customers = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, cabang: true, email: true, pics: true } });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const targets: CampaignTarget[] = [];
  for (const r of reqs) {
    const c = byId.get(String(r.customerId || ''));
    if (!c) continue;
    // Hanya alamat yang memang tercatat di customer ini.
    const known = new Set([c.email, ...((Array.isArray(c.pics) ? c.pics : []) as { email?: string | null }[]).map((p) => p?.email)].map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
    const emails = (Array.isArray(r.emails) ? r.emails : []).map((e) => String(e).trim()).filter((e) => validEmail(e) && known.has(e.toLowerCase()));
    targets.push({ customerId: c.id, name: c.name, cabang: (c.cabang || '').toUpperCase(), emails });
  }
  if (!targets.length) return NextResponse.json({ error: 'Customer tidak ditemukan.' }, { status: 400 });
  if (channel === 'email' && targets.reduce((n, t) => n + t.emails.length, 0) > MAIL_MAX_RECIPIENTS) return NextResponse.json({ error: `Maksimal ${MAIL_MAX_RECIPIENTS} alamat sekali kirim.` }, { status: 400 });

  const files: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
  let bytes = 0;
  for (const a of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 5)) {
    const ext = String(a?.filename || '').split('.').pop()?.toLowerCase() || '';
    if (!MAIL_ATTACH_TYPES[ext]) return NextResponse.json({ error: `Jenis lampiran tidak didukung: ${a?.filename || ''}` }, { status: 400 });
    const content = Buffer.from(String(a?.content || ''), 'base64');
    bytes += content.length;
    if (bytes > MAIL_MAX_ATTACH_BYTES) return NextResponse.json({ error: 'Lampiran terlalu besar (maks. 10 MB total).' }, { status: 413 });
    if (content.length) files.push({ filename: String(a.filename).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120), content, contentType: MAIL_ATTACH_TYPES[ext] });
  }

  let sent = 0;
  const failed: string[] = [];
  if (channel === 'email') {
    const signer = { nama: user.name, jabatan: JABATAN[user.role] || '', email: user.email && validEmail(user.email) ? user.email : '' };
    const logoBuf = await logo();
    const att = logoBuf ? [...files, { filename: 'logo.png', content: logoBuf, contentType: 'image/png', cid: 'tira-logo' }] : files;
    for (const t of targets) {
      if (!t.emails.length) {
        failed.push(`${t.name} (tanpa email)`);
        continue;
      }
      const input = { mode: 'customer' as const, message, attachments: files.map((f) => f.filename), greeting: 'Dengan hormat', signer, logoSrc: logoBuf ? 'cid:tira-logo' : '' };
      const res = await sendCustomerMail({ userId: user.id, kind: 'kampanye', senderName: user.name, replyTo: signer.email || undefined, to: t.emails, cc: [], subject, html: composeEmailHtml(input), text: composeEmailText(input), attachments: att });
      if (res.ok) sent++;
      else failed.push(t.name);
    }
  }

  const filter = { ...(body.filter && typeof body.filter === 'object' ? body.filter : {}), channel } as Prisma.InputJsonValue;
  const c = await prisma.campaign.create({
    data: {
      nama,
      filter,
      targets: targets as unknown as Prisma.InputJsonValue,
      subject: subject || nama,
      message,
      attachments: files.map((f) => f.filename) as unknown as Prisma.InputJsonValue,
      sentCount: sent,
      failed: failed as unknown as Prisma.InputJsonValue,
      sentAt: new Date(),
      createdById: user.id,
      createdBy: user.name,
    },
  });
  await logActivity({ user, action: 'create', entity: 'customer', entityId: c.id, summary: `Kampanye "${nama}" (${channel === 'email' ? `email terkirim ke ${sent} dari ${targets.length} customer` : `daftar manual ${targets.length} customer`})${failed.length ? ` — gagal/tanpa email: ${failed.length}` : ''}` });
  return NextResponse.json({ ok: true, id: c.id, targets: targets.length, sent, failed });
}
