import { flowItems, type ItemEvent, type ItemEventLine } from './item-flow';
import { formatDateID } from './format';
import type { SheetSpec } from './exports';
import type { Prospect } from './types';

/**
 * Rekap Pengiriman (DO): semua catatan "Catat Pengiriman (DO)" lintas prospek,
 * diambil dari ProspectItemEvent type 'kirim' (koreksi mengubah event yang
 * sama; pengiriman yang dibatalkan berganti type jadi 'kirim-batal' sehingga
 * otomatis tidak ikut).
 */

export interface DeliveryEvent extends ItemEvent {
  customer: string;
  cabang: string;
}

export interface DeliveryLine {
  itemId: string;
  label: string;
  qty: number;
  satuan: string;
  kg: number;
  /** Sisa PO item ini sesudah DO tersebut dicatat. */
  sisa: number | null;
}

export interface DeliveryRow {
  id: string;
  prospectId: string;
  tgl: string;
  noDo: string;
  customer: string;
  cabang: string;
  se: string;
  noPo: string;
  tglPO: string;
  lines: DeliveryLine[];
  qty: number;
  kg: number;
  /** Status prospek (5 = DO) — hanya DO yang bisa ditandai terfaktur. */
  status: number;
  terfaktur: boolean;
  noFaktur: string;
  tglFaktur: string;
  actorName: string;
  createdAt: string;
}

export function deliveryRows(events: DeliveryEvent[], prospects: Prospect[]): DeliveryRow[] {
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const itemsOf = new Map<string, Map<string, { satuan: string; kgPc: number }>>();
  return events
    .filter((e) => e.type === 'kirim')
    .map((e) => {
      const p = byId.get(e.prospectId);
      let meta = itemsOf.get(e.prospectId);
      if (!meta) {
        meta = new Map(p ? flowItems(p).map((it) => [it.itemId, { satuan: it.satuan, kgPc: it.kgPc }]) : []);
        itemsOf.set(e.prospectId, meta);
      }
      const lines: DeliveryLine[] = ((e.items || []) as ItemEventLine[]).map((l) => {
        const m = meta!.get(l.itemId);
        const qty = Number(l.qty) || 0;
        return { itemId: l.itemId, label: l.label, qty, satuan: m?.satuan || 'pcs', kg: m ? Math.round(qty * m.kgPc * 100) / 100 : 0, sisa: typeof l.sisa === 'number' ? l.sisa : null };
      });
      return {
        id: e.id,
        prospectId: e.prospectId,
        tgl: String(e.tgl || e.createdAt || '').slice(0, 10),
        noDo: e.docNo || '',
        customer: p?.customer || e.customer || '',
        cabang: (p?.cabang || e.cabang || '').toUpperCase(),
        se: (p?.se || '').toUpperCase(),
        noPo: p?.noPo || '',
        tglPO: p?.tglPO || '',
        lines,
        qty: lines.reduce((s, l) => s + l.qty, 0),
        kg: lines.reduce((s, l) => s + l.kg, 0),
        status: Number(p?.status) || 0,
        terfaktur: !!p?.terfaktur,
        noFaktur: p?.noFaktur || '',
        tglFaktur: p?.tglFaktur || '',
        actorName: e.actorName || '',
        createdAt: String(e.createdAt || ''),
      };
    })
    .sort((a, b) => b.tgl.localeCompare(a.tgl) || b.createdAt.localeCompare(a.createdAt));
}

/** Satu baris Excel per item yang dikirim. */
export function buildDeliverySheet(rows: DeliveryRow[]): SheetSpec {
  const header = ['TGL KIRIM', 'NO. DO / SURAT JALAN', 'CUSTOMER', 'CABANG', 'SALES', 'NO. PO', 'TGL PO', 'MATERIAL', 'QTY KIRIM', 'SATUAN', 'BERAT (KG)', 'SISA PO SESUDAH DO', 'TERFAKTUR', 'NO. FAKTUR', 'TGL FAKTUR', 'DICATAT OLEH'];
  const out: unknown[][] = [];
  rows.forEach((r) => {
    const lines = r.lines.length ? r.lines : [{ itemId: '', label: '', qty: 0, satuan: '', kg: 0, sisa: null } as DeliveryLine];
    lines.forEach((l) => {
      out.push([
        formatDateID(r.tgl), r.noDo, r.customer, r.cabang, r.se, r.noPo, r.tglPO ? formatDateID(r.tglPO) : '',
        l.label, l.qty, l.satuan, l.kg || '', l.sisa ?? '',
        r.terfaktur ? 'Sudah' : 'Belum', r.noFaktur, r.tglFaktur ? formatDateID(r.tglFaktur) : '', r.actorName,
      ]);
    });
  });
  const colWidths = [11, 22, 28, 9, 12, 16, 11, 44, 9, 7, 11, 12, 10, 18, 11, 18].map((wch) => ({ wch }));
  return { sheetName: 'Pengiriman (DO)', header, rows: out, colWidths, numFormats: { 10: '#,##0.##' } };
}
