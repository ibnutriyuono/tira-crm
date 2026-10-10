import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { ensureItemIds, isResponse, requireUser } from '@/lib/api-helpers';
import { isPurchasingRole } from '@/lib/auth';
import { getProspectMaterials } from '@/lib/format';
import { logItemEvent } from '@/lib/item-events';
import { itemLabel, type ItemEventLine } from '@/lib/item-flow';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { emitCrmEvent } from '@/lib/socket';
import type { Material, Prospect } from '@/lib/types';

/**
 * Status item & riwayat (Ditawarkan -> PO -> Terkirim) of one prospect.
 *   GET  -> { prospect, events }   (old rows get their itemId on first open)
 *   POST { action: 'po', noPo?, tglPO?, qty: { [itemId]: n } }
 *   POST { action: 'kirim', noDo, tgl, qty: { [itemId]: n } }
 */

type Row = Material & { itemId: string; qtyPo?: number; qtyKirim?: number; fabNama?: string };

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
  if (isPurchasingRole(user.role)) return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 });
  const { id } = await params;
  const scoped = await assertProspectInScope(user, id);
  if (scoped.error) return scoped.error;
  const existing = scoped.existing;

  const body = await req.json().catch(() => null);
  const action = String(body?.action || '');
  const qtyIn = (body?.qty && typeof body.qty === 'object' ? body.qty : {}) as Record<string, unknown>;
  const status = Number(existing.status);
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

  return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
}
