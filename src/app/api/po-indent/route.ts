import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { ensureItemIds, isResponse, requireUser } from '@/lib/api-helpers';
import { num } from '@/lib/format';
import { buildPoIndent } from '@/lib/po-indent';
import {
  ETA_STAT_META,
  cleanEtaLog,
  fmtYmd,
  isEtaStat,
  itemStock,
  type EtaLogEntry,
  type EtaStat,
} from '@/lib/item-stock';
import { bmUserIds, notify, seUserIds } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { canEditPoIndent, canSeePoIndent } from '@/lib/roles';
import { emitCrmEvent } from '@/lib/socket';
import { jakartaToday } from '@/lib/followup-notify';
import type { Prospect } from '@/lib/types';
import { LINE_FABRIKASI } from '@/lib/doc-lines';

/**
 * Tab "PO Indent" Purchasing: item PO/DO berkondisi Indent / Import yang belum
 * terkirim penuh. TANPA harga / nilai Rupiah.
 *   GET  → { groups, today }
 *   POST { items: [{ prospectId, itemId }], eta?: 'YYYY-MM-DD' | '', stat?: EtaStat, note? }
 *     eta undefined = tidak diubah; '' = dikosongkan. Target dimundurkan →
 *     alasan (note) wajib. Riwayat per item di materials[].etaLog.
 */

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canSeePoIndent(user.role)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
  const prospects = (await prisma.prospect.findMany({ where: { status: { in: [4, 5] } }, orderBy: { tglPO: 'desc' } })) as unknown as Prospect[];
  const seCodes = Array.from(new Set(prospects.map((p) => (p.se || '').trim().toUpperCase()).filter(Boolean)));
  const users = await prisma.user.findMany({ where: { se: { in: seCodes, mode: 'insensitive' } }, select: { se: true, name: true } });
  const seName = new Map(users.map((u) => [(u.se || '').toUpperCase(), u.name]));
  const fupas = await prisma.fupa.findMany({ where: { prospectId: { in: prospects.map((p) => p.id) }, cancelledAt: null }, select: { prospectId: true, noFupa: true } });
  const fupaOf = new Map<string, string>();
  fupas.forEach((f) => f.prospectId && f.noFupa && !fupaOf.has(f.prospectId) && fupaOf.set(f.prospectId, f.noFupa));
  const groups = buildPoIndent(prospects, {
    seName: (se) => seName.get((se || '').toUpperCase()) || '',
    fupaNo: (id) => fupaOf.get(id) || '',
    onlyLine: user.role === 'purchasing05' ? LINE_FABRIKASI : undefined,
  });
  return NextResponse.json({ groups, today: jakartaToday() });
}

type Row = Record<string, unknown> & { itemId?: string };

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPoIndent(user.role)) return NextResponse.json({ error: 'Hanya Purchasing yang mengisi target kedatangan.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const list = (Array.isArray(body?.items) ? body.items : []) as { prospectId?: unknown; itemId?: unknown }[];
  if (!list.length) return NextResponse.json({ error: 'Pilih minimal satu item.' }, { status: 400 });
  if (list.length > 300) return NextResponse.json({ error: 'Maksimal 300 item sekali simpan.' }, { status: 400 });
  const etaIn = body.eta === undefined || body.eta === null ? undefined : String(body.eta);
  if (etaIn !== undefined && etaIn !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(etaIn)) return NextResponse.json({ error: 'Tanggal target tidak valid.' }, { status: 400 });
  const statIn: EtaStat | undefined = isEtaStat(body.stat) ? body.stat : undefined;
  if (etaIn === undefined && !statIn) return NextResponse.json({ error: 'Isi target kedatangan atau status barang.' }, { status: 400 });
  const note = String(body.note || '').trim().slice(0, 300);

  const byProspect = new Map<string, Set<string>>();
  list.forEach((x) => {
    const pid = String(x.prospectId || '');
    const iid = String(x.itemId || '');
    if (!pid || !iid) return;
    if (!byProspect.has(pid)) byProspect.set(pid, new Set());
    byProspect.get(pid)!.add(iid);
  });
  const prospects = (await prisma.prospect.findMany({ where: { id: { in: Array.from(byProspect.keys()) }, status: { in: [4, 5] } } })) as unknown as Prospect[];
  if (!prospects.length) return NextResponse.json({ error: 'PO tidak ditemukan.' }, { status: 404 });

  // Validasi dulu (semua atau tidak sama sekali): alasan wajib bila target mundur.
  for (const p of prospects) {
    const ids = byProspect.get(p.id)!;
    const rows = (ensureItemIds(p.materials) || (p.materials as unknown as Row[])) as Row[];
    for (const r of rows) {
      if (!r.itemId || !ids.has(r.itemId)) continue;
      if (user.role === 'purchasing05' && !String(r.line || '').split(/\s*,\s*/).includes(LINE_FABRIKASI)) {
        return NextResponse.json({ error: 'PIC Line 05 hanya mengisi item Line 05.' }, { status: 403 });
      }
      const st = itemStock(r, p.kondisiStock);
      if (etaIn !== undefined && st.eta && etaIn !== st.eta && (etaIn === '' || etaIn > st.eta) && note.length < 3) {
        return NextResponse.json({ error: `Target "${String(r.uraian || r.fabNama || 'item')}" dimundurkan / dihapus — alasan wajib diisi.`, code: 'NEED_NOTE' }, { status: 400 });
      }
    }
  }

  const at = new Date().toISOString();
  let changed = 0;
  const out: Prospect[] = [];
  for (const p of prospects) {
    const ids = byProspect.get(p.id)!;
    const rows = ((ensureItemIds(p.materials) || (p.materials as unknown as Row[])) as Row[]).map((r) => ({ ...r }));
    const janji = num(p.status) === 4 ? p.tglDelivery || '' : '';
    const moved: string[] = [];
    const filled: string[] = [];
    const arrived: string[] = [];
    rows.forEach((r) => {
      if (!r.itemId || !ids.has(r.itemId)) return;
      const st = itemStock(r, p.kondisiStock);
      const label = String(r.uraian || r.fabNama || 'item');
      const nextEta = etaIn === undefined ? st.eta : etaIn;
      const nextStat = statIn || st.stat;
      if (nextEta === st.eta && nextStat === st.stat && !note) return;
      const e: EtaLogEntry = { at, by: user.name };
      if (nextEta !== st.eta) {
        e.from = st.eta;
        e.to = nextEta;
        if (st.eta && nextEta > st.eta) moved.push(`${label}: ${fmtYmd(st.eta)} → ${fmtYmd(nextEta)}${janji && nextEta > janji ? ` (melewati janji ${fmtYmd(janji)})` : ''}`);
        else if (!st.eta && nextEta) filled.push(`${label} tiba ${fmtYmd(nextEta)}${janji && nextEta > janji ? ` (melewati janji ${fmtYmd(janji)})` : ''}`);
      }
      if (nextStat !== st.stat) {
        e.sFrom = st.stat;
        e.sTo = nextStat;
        if (nextStat === 'tiba') arrived.push(label);
      }
      if (note) e.note = note;
      r.eta = nextEta || undefined;
      r.etaStat = nextStat;
      r.etaLog = cleanEtaLog([...st.log, e]);
      // Kondisi dari teks lama ikut dibekukan ke item supaya tidak berubah bila teksnya diganti.
      if (st.legacy && st.kond && !r.stok) {
        r.stok = st.kond;
        if (st.lama) r.stokLama = st.lama;
      }
      changed++;
    });
    if (!moved.length && !filled.length && !arrived.length && !rows.some((r) => r.itemId && ids.has(r.itemId))) continue;
    const saved = (await prisma.prospect.update({ where: { id: p.id }, data: { materials: JSON.parse(JSON.stringify(rows)) } })) as unknown as Prospect;
    out.push(saved);
    emitCrmEvent('prospect:updated', saved);

    const who = `${p.customer}${p.noPo ? ` · ${p.noPo}` : ''}`;
    const sales = await seUserIds(p.se);
    const bms = await bmUserIds(p.cabang);
    if (moved.length) {
      await notify({
        userIds: [...sales, ...bms],
        type: 'po_eta',
        entity: 'prospect',
        entityId: p.id,
        title: `Target kedatangan mundur — ${who}`,
        message: `${moved.join('; ')}${note ? `. Alasan: ${note}` : ''}. Kabari customer bila tanggal kirim bergeser.`,
      });
    }
    if (filled.length) {
      await notify({ userIds: sales, type: 'po_eta', entity: 'prospect', entityId: p.id, title: `Target kedatangan diisi — ${who}`, message: filled.join('; ') });
    }
    if (arrived.length) {
      const admins = await prisma.user.findMany({ where: { role: 'salesadmin', cabang: { equals: p.cabang || '', mode: 'insensitive' } }, select: { id: true } });
      await notify({
        userIds: [...admins.map((a) => a.id), ...sales, ...bms],
        type: 'po_arrived',
        entity: 'prospect',
        entityId: p.id,
        title: `Barang tiba di gudang — ${who}`,
        message: `${arrived.join(', ')} tiba di gudang — siap dicatat pengirimannya (DO).`,
      });
    }
  }
  const what = [etaIn !== undefined ? (etaIn ? `target ${fmtYmd(etaIn)}` : 'hapus target') : '', statIn ? ETA_STAT_META[statIn].label : ''].filter(Boolean).join(', ');
  await logActivity({ user, action: 'update', entity: 'prospect', entityId: out[0]?.id || user.id, summary: `PO Indent: ${what} untuk ${changed} item (${out.length} PO)${note ? ` — ${note}` : ''}` });
  return NextResponse.json({ ok: true, changed, prospects: out });
}
