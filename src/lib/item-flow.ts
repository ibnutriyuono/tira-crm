import { getProspectMaterials, num } from './format';
import { LINE_FABRIKASI } from './doc-lines';
import type { Material, Prospect } from './types';

/**
 * Alur per item material prospek: Ditawarkan -> PO -> Terkirim.
 *
 * Tiap baris material membawa `itemId` (tetap selama baris itu ada) dan, begitu
 * dikonfirmasi lewat "Status Item", `qtyPo` dan `qtyKirim`. Prospek lama (atau
 * yang dipindah ke PO/DO tanpa konfirmasi per item) dihitung penuh: PO = qty
 * penawaran, DO = seluruh PO terkirim -- ditandai `estimated` (perkiraan).
 * Kejadiannya dicatat di tabel ProspectItemEvent (lihat api/prospects/[id]/items).
 */

export interface ItemTrack {
  itemId?: string;
  qtyPo?: number;
  qtyKirim?: number;
}

export type ItemState = 'ditawarkan' | 'tidak-po' | 'po' | 'sebagian' | 'terkirim' | 'batal';

export const ITEM_STATE_META: Record<ItemState, { label: string; color: string }> = {
  ditawarkan: { label: 'Ditawarkan', color: 'steel' },
  'tidak-po': { label: 'Tidak di-PO', color: 'rust' },
  po: { label: 'PO', color: 'amber' },
  sebagian: { label: 'Sebagian terkirim', color: 'green' },
  terkirim: { label: 'Terkirim', color: 'green' },
  batal: { label: 'Lose / Batal', color: 'slate' },
};

export interface FlowItem {
  idx: number;
  itemId: string;
  label: string;
  line: string;
  fab: boolean;
  satuan: string;
  kgPc: number;
  offered: number;
  /** null = belum PO. */
  po: number | null;
  sent: number;
  poConfirmed: boolean;
  sentConfirmed: boolean;
  /** Angka PO/kirim diperkirakan dari status prospek (belum dikonfirmasi per item). */
  estimated: boolean;
  state: ItemState;
}

export type EventType = 'tawar' | 'revisi' | 'po' | 'nopo' | 'kirim';

export const EVENT_META: Record<EventType, { label: string; color: string }> = {
  tawar: { label: 'Penawaran', color: 'steel' },
  revisi: { label: 'Revisi', color: 'slate' },
  po: { label: 'PO', color: 'amber' },
  nopo: { label: 'Tidak di-PO', color: 'rust' },
  kirim: { label: 'Kirim', color: 'green' },
};

export interface ItemEventLine {
  itemId: string;
  label: string;
  qty?: number;
  of?: number;
  from?: number;
  to?: number;
  sisa?: number;
}

export interface ItemEvent {
  id: string;
  prospectId: string;
  createdAt: string;
  tgl: string | null;
  type: EventType;
  docNo: string | null;
  title: string;
  items: ItemEventLine[];
  actorName: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isFabMaterial(m: Pick<Material, 'line'> & { fabNama?: unknown }): boolean {
  return String(m.line || '').split(/\s*,\s*/).includes(LINE_FABRIKASI) || m.fabNama !== undefined;
}

/** Short text for one material row (uraian, or nama pekerjaan for Line 05). */
export function itemLabel(m: Material & { fabNama?: unknown }): string {
  return String(m.uraian || m.fabNama || '').trim() || '(tanpa uraian)';
}

/** Key used before a row has an itemId (old records): its position. */
export const idxKey = (i: number) => `idx:${i}`;

export function flowItems(p: Pick<Prospect, 'materials' | 'qty' | 'value' | 'line' | 'uraian' | 'status'>): FlowItem[] {
  const status = num(p.status);
  const won = status === 4 || status === 5;
  const mats = getProspectMaterials(p) as (Material & ItemTrack & { satuan?: string; fabNama?: string })[];
  // Once any row has been confirmed, rows without a figure are genuinely
  // "not yet" (e.g. a row added after the PO) rather than an estimate.
  const anyPo = mats.some((m) => isNum(m.qtyPo));
  const anySent = mats.some((m) => isNum(m.qtyKirim));
  return mats.map((m, idx) => {
    const offered = num(m.qty);
    const poConfirmed = isNum(m.qtyPo);
    const poEstimated = !poConfirmed && won && !anyPo;
    const po = poConfirmed ? (m.qtyPo as number) : poEstimated ? offered : status === 6 ? 0 : null;
    const sentConfirmed = isNum(m.qtyKirim);
    const sentEstimated = !sentConfirmed && status === 5 && !anySent && !!po;
    const sent = sentConfirmed ? (m.qtyKirim as number) : sentEstimated ? (po as number) : 0;
    const estimated = poEstimated || sentEstimated;
    let state: ItemState;
    if (status === 6) state = 'batal';
    else if (po === null) state = 'ditawarkan';
    else if (po <= 0) state = 'tidak-po';
    else if (sent <= 0) state = 'po';
    else if (sent < po) state = 'sebagian';
    else state = 'terkirim';
    const fab = isFabMaterial(m);
    return {
      idx,
      itemId: m.itemId || idxKey(idx),
      label: itemLabel(m),
      line: m.line || '',
      fab,
      satuan: fab ? String(m.satuan || 'unit') : 'pcs',
      kgPc: fab ? 0 : num(m.beratPc),
      offered,
      po,
      sent,
      poConfirmed,
      sentConfirmed,
      estimated,
      state,
    };
  });
}

export interface FlowTotals {
  offKg: number;
  poKg: number;
  sentKg: number;
  /** PO yang belum terkirim. */
  openKg: number;
  /** Selisih penawaran yang tidak di-PO (hanya item yang sudah PO / ditutup). */
  lostKg: number;
  items: number;
  confirmed: boolean;
  estimated: boolean;
}

export function flowTotals(items: FlowItem[]): FlowTotals {
  const t: FlowTotals = { offKg: 0, poKg: 0, sentKg: 0, openKg: 0, lostKg: 0, items: items.length, confirmed: items.length > 0, estimated: false };
  items.forEach((it) => {
    const k = it.kgPc;
    t.offKg += it.offered * k;
    if (it.po !== null) {
      t.poKg += it.po * k;
      t.sentKg += it.sent * k;
      t.openKg += Math.max(0, it.po - it.sent) * k;
      t.lostKg += Math.max(0, it.offered - it.po) * k;
    }
    if (!it.poConfirmed) t.confirmed = false;
    if (it.estimated) t.estimated = true;
  });
  return t;
}

/** "1,25 t" */
export function formatTon(kg: number, digits = 2): string {
  return `${(kg / 1000).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })} t`;
}

export function formatQty(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
