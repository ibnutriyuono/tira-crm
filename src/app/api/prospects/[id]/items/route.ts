import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { ensureItemIds, isResponse, requireUser } from '@/lib/api-helpers';
import { isPurchasingRole } from '@/lib/auth';
import { canSetFaktur } from '@/lib/roles';
import { getProspectMaterials } from '@/lib/format';
import { logItemEvent } from '@/lib/item-events';
import { itemLabel, type ItemEventLine } from '@/lib/item-flow';
import { cleanItemQcd, itemOutcome, itemQcdMissing, type ItemQcd } from '@/lib/item-qcd';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { emitCrmEvent } from '@/lib/socket';
import type { Material, Prospect } from '@/lib/types';
import { guard } from '@/lib/permissions-server';

/**
 * Status item & riwayat (Ditawarkan -> PO -> Terkirim) of one prospect.
 *   GET  -> { prospect, events }   (old rows get their itemId on first open)
 *   POST { action: 'po', noPo?, tglPO?, qty: { [itemId]: n } }
 *   POST { action: 'kirim', noDo, tgl, qty: { [itemId]: n } }
 *   POST { action: 'kirim-koreksi', eventId, noDo, tgl, qty: { [itemId]: n }, alasan }
 *   POST { action: 'kirim-batal', eventId, alasan }
 * Koreksi / pembatalan pengiriman: Admin Sales, BM, RM, GM, Admin; alasan
 * wajib; tidak bisa setelah prospek terfaktur.
 *   POST { action: 'qcd', qcd: { [itemId]: ItemQcd } }   (PO/DO/Lose)
 * 'po' juga menerima `qcd` -- QCD per item ikut disimpan bersama qty PO.
 */

type Row = Material & { itemId: string; qtyPo?: number; qtyKirim?: number; fabNama?: string; qcd?: ItemQcd };

/**
 * Terapkan QCD per item dari body ke baris. Item yang ada di `qcd` wajib
 * lengkap (Q/C/D + faktor; kompetitor pemenang bila ada qty yang lepas).
 * Mengembalikan pesan galat atau null.
 */
function applyItemQcd(rows: Row[], input: unknown, lost: boolean): string | null {
  if (!input || typeof input !== 'object') return null;
  const map = input as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.itemId in map)) continue;
    const q = cleanItemQcd(map[r.itemId]);
    const outcome = itemOutcome(Number(r.qty) || 0, typeof r.qtyPo === 'number' ? r.qtyPo : null, lost);
    if (outcome) {
      const miss = itemQcdMissing(q, outcome);
      if (miss.length) return `QCD item "${itemLabel(r)}" belum lengkap: ${miss.join(', ')}.`;
    }
    if (q) r.qcd = q;
    else delete r.qcd;
  }
  return null;
}

const qtyOf = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);

/** The stored rows with ids; an old prospect without a materials list gets its synthesized single row. */
async function loadRows(existing: Record<string, unknown>): Promise<{ rows: Row[]; persisted: boolean }> {
  const stored = Array.isArray(existing.materials) && (existing.materials as unknown[]).length > 0
    ? (existing.materials as unknown[])
    : getProspectMaterials(existing as unknown as Prospect);
  const withIds = ensureItemIds(stored);
  const missingList = !(Array.isArray(existing.materials) && (existing.materials as unknown[]).length > 0);
  return { rows: (withIds || stored) as Row[], persisted: !withIds && !missingList };
}

async function eventsOf(prospectId: string) {
  return prisma.prospectItemEvent.findMany({ where: { prospectId }, orderBy: { createdAt: 'desc' }, take: 300 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', 'v');
  if (denied) return denied;
  if (user.role === 'purchasing05') return NextResponse.json({ error: 'Prospek tidak ditemukan' }, { status: 404 });
  const { id } = await params;
  const scoped = await assertProspectInScope(user, id);
  if (scoped.error) return scoped.error;

  let prospect = scoped.existing;
  const { rows, persisted } = await loadRows(prospect);
  if (!persisted) {
    prospect = await prisma.prospect.update({ where: { id }, data: { materials: rows as unknown as object } });
    emitCrmEvent('prospect:updated', prospect);
  }
  return NextResponse.json({ prospect, events: await eventsOf(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', 'e');
  if (denied) return denied;
  if (isPurchasingRole(user.role)) return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 });
  const { id } = await params;
  const scoped = await assertProspectInScope(user, id);
  if (scoped.error) return scoped.error;
  const existing = scoped.existing;

  const body = await req.json().catch(() => null);
  const action = String(body?.action || '');
  const qtyIn = (body?.qty && typeof body.qty === 'object' ? body.qty : {}) as Record<string, unknown>;
  const status = Number(existing.status);

  if (action === 'qcd') {
    if (status !== 4 && status !== 5 && status !== 6) {
      return NextResponse.json({ error: 'QCD per item diisi setelah prospek PO / DO / Lose.' }, { status: 400 });
    }
    const { rows } = await loadRows(existing);
    const err = applyItemQcd(rows, body?.qcd, status === 6);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const prospect = await prisma.prospect.update({ where: { id }, data: { materials: rows as unknown as object } });
    emitCrmEvent('prospect:updated', prospect);
    const n = Object.keys(body?.qcd && typeof body.qcd === 'object' ? body.qcd : {}).length;
    await logActivity({ user, action: 'update', entity: 'prospect', entityId: id, summary: `Mengisi QCD per item (${n} item) prospek "${prospect.customer}"` });
    return NextResponse.json({ prospect, events: await eventsOf(id) });
  }

  if (status !== 4 && status !== 5) {
    return NextResponse.json({ error: 'Pindahkan status prospek ke PO / Kontrak dulu (No. PO & QCD wajib), lalu konfirmasi qty per item.' }, { status: 400 });
  }

  const { rows } = await loadRows(existing);
  const data: Record<string, unknown> = {};
  const name = (r: Row) => itemLabel(r);

  if (action === 'po') {
    const noPo = String(body?.noPo ?? existing.noPo ?? '').trim();
    if (!noPo) return NextResponse.json({ error: 'No. PO wajib diisi' }, { status: 400 });
    const tglPO = isDate(body?.tglPO) ? body.tglPO : existing.tglPO || today();
    const correction = rows.some((r) => typeof r.qtyPo === 'number');
    const poLines: ItemEventLine[] = [];
    const noLines: ItemEventLine[] = [];
    rows.forEach((r) => {
      const offered = Number(r.qty) || 0;
      const sent = typeof r.qtyKirim === 'number' ? r.qtyKirim : 0;
      const raw = r.itemId in qtyIn ? qtyOf(qtyIn[r.itemId]) : offered;
      // Never below what has already been delivered, never above the quotation.
      const q = clamp(Number.isFinite(raw) ? raw : offered, Math.min(sent, offered), offered);
      if (correction && r.qtyPo === q) {
        r.qtyPo = q;
        return;
      }
      r.qtyPo = q;
      if (q > 0) poLines.push({ itemId: r.itemId, label: name(r), qty: q, of: offered });
      if (offered - q > 0) noLines.push({ itemId: r.itemId, label: name(r), qty: Math.round((offered - q) * 100) / 100, of: offered });
    });
    const qcdErr = applyItemQcd(rows, body?.qcd, false);
    if (qcdErr) return NextResponse.json({ error: qcdErr }, { status: 400 });
    data.materials = rows;
    data.noPo = noPo;
    data.tglPO = tglPO;
    const prospect = await prisma.prospect.update({ where: { id }, data });
    emitCrmEvent('prospect:updated', prospect);
    await logItemEvent({ prospectId: id, type: 'po', title: `${correction ? 'Koreksi qty PO' : 'PO dikonfirmasi'} — ${noPo}`, items: poLines, user, tgl: tglPO, docNo: noPo });
    await logItemEvent({ prospectId: id, type: 'nopo', title: 'Tidak di-PO', items: noLines, user, tgl: tglPO, docNo: noPo });
    await logActivity({ user, action: 'update', entity: 'prospect', entityId: id, summary: `Mengonfirmasi qty PO per item prospek "${prospect.customer}" (${noPo})` });
    return NextResponse.json({ prospect, events: await eventsOf(id) });
  }

  if (action === 'kirim') {
    const noDo = String(body?.noDo || '').trim();
    if (!noDo) return NextResponse.json({ error: 'No. DO / surat jalan wajib diisi' }, { status: 400 });
    const tgl = isDate(body?.tgl) ? body.tgl : today();
    if (rows.some((r) => typeof r.qtyPo !== 'number')) {
      return NextResponse.json({ error: 'Konfirmasi qty PO per item dulu sebelum mencatat pengiriman.' }, { status: 400 });
    }
    const lines: ItemEventLine[] = [];
    rows.forEach((r) => {
      const po = r.qtyPo as number;
      const sent = typeof r.qtyKirim === 'number' ? r.qtyKirim : 0;
      const raw = qtyOf(qtyIn[r.itemId]);
      const q = clamp(Number.isFinite(raw) ? raw : 0, 0, Math.max(0, po - sent));
      if (q <= 0) return;
      r.qtyKirim = Math.round((sent + q) * 100) / 100;
      lines.push({ itemId: r.itemId, label: name(r), qty: q, sisa: Math.round((po - r.qtyKirim) * 100) / 100 });
    });
    if (!lines.length) return NextResponse.json({ error: 'Isi qty kirim minimal satu item' }, { status: 400 });
    data.materials = rows;
    if (!existing.tglDelivery) data.tglDelivery = tgl;
    if (status === 4) {
      data.status = 5;
      data.statusChangedAt = new Date();
    }
    const prospect = await prisma.prospect.update({ where: { id }, data });
    emitCrmEvent('prospect:updated', prospect);
    await logItemEvent({ prospectId: id, type: 'kirim', title: `Dikirim — ${noDo}`, items: lines, user, tgl, docNo: noDo });
    await logActivity({
      user,
      action: status === 4 ? 'status_change' : 'update',
      entity: 'prospect',
      entityId: id,
      summary: `Mencatat pengiriman ${noDo} prospek "${prospect.customer}"${status === 4 ? ' (status pindah ke DO)' : ''}`,
    });
    return NextResponse.json({ prospect, events: await eventsOf(id) });
  }

  if (action === 'kirim-koreksi' || action === 'kirim-batal') {
    if (!canSetFaktur(user.role)) return NextResponse.json({ error: 'Koreksi pengiriman dilakukan Admin Sales / BM.' }, { status: 403 });
    if (existing.terfaktur) return NextResponse.json({ error: 'Prospek sudah terfaktur — batalkan status faktur dulu di Antrian Admin sebelum mengoreksi pengiriman.' }, { status: 400 });
    const alasan = String(body?.alasan || '').trim().slice(0, 300);
    if (alasan.length < 3) return NextResponse.json({ error: 'Alasan koreksi wajib diisi.' }, { status: 400 });
    const ev = await prisma.prospectItemEvent.findFirst({ where: { id: String(body?.eventId || ''), prospectId: id, type: 'kirim' } });
    if (!ev) return NextResponse.json({ error: 'Catatan pengiriman tidak ditemukan (mungkin sudah dibatalkan).' }, { status: 404 });
    const oldLines = (Array.isArray(ev.items) ? ev.items : []) as unknown as ItemEventLine[];
    const oldQty = new Map(oldLines.map((l) => [l.itemId, Number(l.qty) || 0]));
    const round = (n: number) => Math.round(n * 100) / 100;
    const batal = action === 'kirim-batal';
    const noDo = batal ? ev.docNo || '' : String(body?.noDo ?? ev.docNo ?? '').trim();
    const tgl = batal ? ev.tgl : isDate(body?.tgl) ? body.tgl : ev.tgl;
    if (!batal && !noDo) return NextResponse.json({ error: 'No. DO / surat jalan wajib diisi' }, { status: 400 });

    const newLines: ItemEventLine[] = [];
    const changes: ItemEventLine[] = [];
    for (const r of rows) {
      const before = oldQty.get(r.itemId) || 0;
      const raw = batal ? 0 : r.itemId in qtyIn ? qtyOf(qtyIn[r.itemId]) : before;
      const want = Number.isFinite(raw) ? Math.max(0, raw) : before;
      const sentNow = typeof r.qtyKirim === 'number' ? r.qtyKirim : 0;
      const othersSent = round(sentNow - before);
      const po = typeof r.qtyPo === 'number' ? r.qtyPo : 0;
      if (round(othersSent + want) > po) {
        return NextResponse.json({ error: `Qty kirim "${name(r)}" melebihi qty PO (${po}; sudah dikirim di DO lain ${othersSent}).` }, { status: 400 });
      }
      if (want === before && !batal) {
        if (want > 0) newLines.push({ itemId: r.itemId, label: name(r), qty: want, sisa: round(po - sentNow) });
        continue;
      }
      if (want === before) continue;
      r.qtyKirim = round(othersSent + want);
      if (want > 0) newLines.push({ itemId: r.itemId, label: name(r), qty: want, sisa: round(po - r.qtyKirim) });
      changes.push({ itemId: r.itemId, label: name(r), from: before, to: want });
    }
    if (!batal && !newLines.length) return NextResponse.json({ error: 'Isi qty kirim minimal satu item — atau pilih Batalkan pengiriman.' }, { status: 400 });
    const headerChanged = !batal && (noDo !== (ev.docNo || '') || tgl !== ev.tgl);
    if (!batal && !changes.length && !headerChanged) return NextResponse.json({ error: 'Tidak ada perubahan.' }, { status: 400 });

    // Status & tanggal kirim mengikuti pengiriman yang tersisa.
    const anySent = rows.some((r) => (typeof r.qtyKirim === 'number' ? r.qtyKirim : 0) > 0);
    if (!anySent) rows.forEach((r) => delete r.qtyKirim);
    data.materials = rows;
    const otherKirim = await prisma.prospectItemEvent.findMany({ where: { prospectId: id, type: 'kirim', NOT: { id: ev.id } }, select: { tgl: true } });
    const dates = [...otherKirim.map((e) => e.tgl), batal ? null : tgl].filter((d): d is string => !!d).sort();
    data.tglDelivery = dates[0] || null;
    const revertStatus = !anySent && status === 5;
    if (revertStatus) {
      data.status = 4;
      data.statusChangedAt = new Date();
    }

    const prospect = await prisma.prospect.update({ where: { id }, data });
    if (batal) {
      await prisma.prospectItemEvent.update({ where: { id: ev.id }, data: { type: 'kirim-batal', title: `Dikirim — ${ev.docNo || '-'} (dibatalkan)` } });
    } else {
      await prisma.prospectItemEvent.update({ where: { id: ev.id }, data: { docNo: noDo, tgl, title: `Dikirim — ${noDo}`, items: newLines as unknown as object } });
    }
    const ref = ev.docNo || '-';
    const what = batal
      ? `Pengiriman ${ref} dibatalkan`
      : `Koreksi pengiriman ${ref}${noDo !== ref ? ` → ${noDo}` : ''}${tgl !== ev.tgl ? ` · tgl ${ev.tgl || '-'} → ${tgl}` : ''}`;
    await prisma.prospectItemEvent.create({
      data: {
        prospectId: id,
        type: 'koreksi',
        title: `${what} — alasan: ${alasan}`.slice(0, 200),
        items: (changes.length ? changes : oldLines.map((l) => ({ itemId: l.itemId, label: l.label, from: l.qty, to: l.qty }))) as unknown as object,
        tgl: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10),
        docNo: noDo || ref,
        userId: user.id,
        actorName: user.name,
      },
    });
    emitCrmEvent('prospect:updated', prospect);
    await logActivity({
      user,
      action: revertStatus ? 'status_change' : 'update',
      entity: 'prospect',
      entityId: id,
      summary: `${what} prospek "${prospect.customer}" (alasan: ${alasan})${revertStatus ? ' — status kembali ke PO/Kontrak' : ''}`,
    });
    return NextResponse.json({ prospect, events: await eventsOf(id) });
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
}
