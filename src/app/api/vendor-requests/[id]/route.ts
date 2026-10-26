import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing, docVisibleTo } from '@/lib/auth';
import { kursFor } from '@/lib/kurs-server';
import { mailConfigured, sendCustomerMail } from '@/lib/email-notify';
import { validEmail } from '@/lib/notif-prefs';
import { prisma } from '@/lib/prisma';
import { normalizeHppItems, docForRole } from '@/lib/rfq-price';
import { emitCrmEvent } from '@/lib/socket';
import type { RfqItem } from '@/lib/types';
import { cleanVrItems, fmtDate, vrFromRow, waNumber, waUrl } from '@/lib/vendor-request';
import { vrEmailHtml } from '@/lib/vendor-request-server';

/**
 * Satu permintaan harga ke vendor.
 *   PATCH { action: 'balas', items: VrItemPrice[], status?: 'dibalas'|'noquote', catatan? }
 *   PATCH { action: 'reminder' } → email pengingat (bila ada email) + tautan WA
 *   PATCH { action: 'pakai', idxs? } → harga vendor jadi HPP di jawaban RFQ
 *   DELETE
 */

async function load(id: string) {
  return prisma.quotation.findUnique({ where: { id }, include: { vendor: { select: { nama: true, email: true, wa: true, pic: true } } } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) return NextResponse.json({ error: 'Hanya Purchasing.' }, { status: 403 });
  const { id } = await params;
  const q = await load(id);
  if (!q) return NextResponse.json({ error: 'Permintaan tidak ditemukan' }, { status: 404 });
  if (!(await docVisibleTo(user, { rfqId: q.rfqId, fupaId: q.fupaId }))) return NextResponse.json({ error: 'Permintaan tidak ditemukan' }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (body.action === 'balas') {
    const items = cleanVrItems(body.items);
    const status = body.status === 'noquote' ? 'noquote' : items.some((i) => i.harga) ? 'dibalas' : body.status === 'dibalas' ? 'dibalas' : 'menunggu';
    const first = items.find((i) => i.harga);
    const u = await prisma.quotation.update({
      where: { id },
      data: {
        items: items as unknown as Prisma.InputJsonValue,
        status,
        currency: first?.currency || null,
        harga: first?.harga || 0,
        balasAt: status === 'menunggu' ? null : q.balasAt || new Date(),
        ...(typeof body.catatan === 'string' ? { catatan: body.catatan.slice(0, 500) } : {}),
      },
      include: { vendor: { select: { nama: true, email: true, wa: true } } },
    });
    await logActivity({ user, action: 'update', entity: 'quotation', entityId: id, summary: `Mencatat balasan harga ${q.vendor.nama} (${items.filter((i) => i.harga).length} item${status === 'noquote' ? ', tidak ada harga' : ''})` });
    return NextResponse.json({ request: vrFromRow(u as never) });
  }

  if (body.action === 'reminder') {
    const doc = q.rfqId ? await prisma.rfq.findUnique({ where: { id: q.rfqId }, select: { noRfq: true } }) : await prisma.fupa.findUnique({ where: { id: q.fupaId || '' }, select: { noFupa: true } });
    const no = (doc && ('noRfq' in doc ? doc.noRfq : doc.noFupa)) || 'RFQ';
    const text = `Dengan hormat${q.vendor.pic ? ` Bapak/Ibu ${q.vendor.pic}` : ''},\n\nMengingatkan permintaan penawaran harga kami (ref. ${no}) tanggal ${fmtDate(q.tglDiminta)}${q.tenggat ? ` dengan tenggat ${fmtDate(q.tenggat)}` : ''}. Mohon kabar harga dan lead time-nya.\n\nTerima kasih,\n${user.name}\nPurchasing – PT. TIRA AUSTENITE, Tbk`;
    let email: 'ok' | 'gagal' | null = null;
    const to = String(q.vendor.email || '').split(/[;,\s]+/).filter((e) => validEmail(e));
    if ((q.channel === 'email' || q.channel === 'both') && to.length && mailConfigured()) {
      const r = await sendCustomerMail({ userId: user.id, kind: 'vendor-rfq', senderName: `Purchasing (${user.name})`, replyTo: user.email || undefined, to, cc: [], subject: `Pengingat: permintaan penawaran harga — ${no}`, html: vrEmailHtml(text, []), text, attachments: [] });
      email = r.ok ? 'ok' : 'gagal';
    }
    const num = waNumber(q.vendor.wa);
    const u = await prisma.quotation.update({ where: { id }, data: { reminders: { increment: 1 }, lastReminderAt: new Date() }, include: { vendor: { select: { nama: true, email: true, wa: true } } } });
    return NextResponse.json({ request: vrFromRow(u as never), email, waUrl: num && q.channel !== 'email' ? waUrl(num, text) : null });
  }

  if (body.action === 'pakai') {
    if (!q.rfqId) return NextResponse.json({ error: 'HPP hanya untuk jawaban RFQ.' }, { status: 400 });
    const rfq = await prisma.rfq.findUnique({ where: { id: q.rfqId } });
    if (!rfq) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });
    const want = Array.isArray(body.idxs) ? new Set(body.idxs.map(Number)) : null;
    const prices = (Array.isArray(q.items) ? (q.items as unknown as ReturnType<typeof cleanVrItems>) : []).filter((p) => p.harga && !p.noQuote && (!want || want.has(p.idx)));
    if (!prices.length) return NextResponse.json({ error: 'Belum ada harga vendor untuk dipakai.' }, { status: 400 });
    const items = ((rfq.items as unknown as RfqItem[]) || []).map((it) => ({ ...it })) as (RfqItem & Record<string, unknown>)[];
    let n = 0;
    for (const p of prices) {
      const it = items[p.idx];
      if (!it) continue;
      const cur = (p.currency || 'IDR').toUpperCase();
      it.hpp = p.harga;
      it.hppCur = cur;
      if (cur === 'IDR') it.kurs = 1;
      else if (!(Number(it.kurs) > 0) || it.hppCur !== cur) it.kurs = (await kursFor(cur)) || undefined;
      if (it.margin === undefined) it.margin = 0;
      it.vendorId = q.vendorId;
      it.vendorNama = q.vendor.nama;
      if (p.leadTime && !it.deliveryTime) it.deliveryTime = p.leadTime;
      it.noQuote = false;
      n++;
    }
    const saved = await prisma.rfq.update({ where: { id: rfq.id }, data: { items: normalizeHppItems(items) as unknown as Prisma.InputJsonValue } });
    // Vendor terpilih untuk RFQ ini.
    await prisma.quotation.updateMany({ where: { rfqId: rfq.id }, data: { isWinner: false } });
    await prisma.quotation.update({ where: { id }, data: { isWinner: true } });
    emitCrmEvent('rfq:updated', saved);
    await logActivity({ user, action: 'update', entity: 'rfq', entityId: rfq.id, summary: `Memakai harga ${q.vendor.nama} sebagai HPP (${n} item) di RFQ ${rfq.noRfq || ''}` });
    return NextResponse.json({ rfq: docForRole(saved, user.role), used: n });
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) return NextResponse.json({ error: 'Hanya Purchasing.' }, { status: 403 });
  const { id } = await params;
  const q = await load(id);
  if (!q) return NextResponse.json({ ok: true });
  if (!(await docVisibleTo(user, { rfqId: q.rfqId, fupaId: q.fupaId }))) return NextResponse.json({ error: 'Permintaan tidak ditemukan' }, { status: 404 });
  await prisma.quotation.delete({ where: { id } });
  await logActivity({ user, action: 'delete', entity: 'quotation', entityId: id, summary: `Menghapus permintaan harga ke ${q.vendor.nama}` });
  return NextResponse.json({ ok: true });
}
