import { num } from './format';
import { flowItems } from './item-flow';
import { etaFlag, fmtYmd, itemStock, needsArrival, type EtaLogEntry, type EtaStat, type StokKond } from './item-stock';
import type { Prospect } from './types';

/**
 * Daftar PO Indent untuk Purchasing: per PO/DO (prospek status 4/5), item
 * berkondisi Indent / Import yang belum terkirim penuh. Tanpa harga.
 */
export interface PoIndentItem {
  itemId: string;
  label: string;
  line: string;
  kond: StokKond;
  lama: string;
  legacy: boolean;
  satuan: string;
  po: number;
  sent: number;
  sisa: number;
  kg: number;
  eta: string;
  stat: EtaStat;
  log: EtaLogEntry[];
}

export interface PoIndentGroup {
  prospectId: string;
  noPo: string;
  tglPO: string;
  status: number;
  cabang: string;
  se: string;
  seName: string;
  customer: string;
  /** Janji kirim ke customer (Tgl. Delivery saat masih PO). */
  janji: string;
  fupa: string;
  /** Item Ready / sudah terkirim yang tidak ditampilkan. */
  hidden: number;
  items: PoIndentItem[];
}

export function buildPoIndent(
  prospects: Prospect[],
  opts: { seName?: (se: string) => string; fupaNo?: (id: string) => string; onlyLine?: string } = {},
): PoIndentGroup[] {
  const out: PoIndentGroup[] = [];
  prospects.forEach((p) => {
    const st = num(p.status);
    if (st !== 4 && st !== 5) return;
    const mats = (Array.isArray(p.materials) ? p.materials : []) as unknown as Record<string, unknown>[];
    const flow = flowItems(p);
    const items: PoIndentItem[] = [];
    let hidden = 0;
    flow.forEach((f) => {
      const m = mats[f.idx] || {};
      const s = itemStock(m, p.kondisiStock);
      const open = (f.po ?? 0) > 0 && f.sent < (f.po ?? 0);
      const lineOk = !opts.onlyLine || String(f.line).split(/\s*,\s*/).includes(opts.onlyLine);
      if (!open || !needsArrival(s.kond) || !lineOk) {
        if ((f.po ?? 0) > 0) hidden++;
        return;
      }
      items.push({
        itemId: f.itemId,
        label: f.label,
        line: f.line,
        kond: s.kond as StokKond,
        lama: s.lama,
        legacy: s.legacy,
        satuan: f.satuan,
        po: f.po ?? 0,
        sent: f.sent,
        sisa: Math.max(0, (f.po ?? 0) - f.sent),
        kg: Math.max(0, (f.po ?? 0) - f.sent) * f.kgPc,
        eta: s.eta,
        stat: s.stat,
        log: s.log,
      });
    });
    if (!items.length) return;
    out.push({
      prospectId: p.id,
      noPo: p.noPo || '',
      tglPO: p.tglPO || '',
      status: st,
      cabang: (p.cabang || '').toUpperCase(),
      se: p.se || '',
      seName: opts.seName?.(p.se || '') || '',
      customer: p.customer,
      janji: st === 4 ? p.tglDelivery || '' : '',
      fupa: opts.fupaNo?.(p.id) || '',
      hidden,
      items,
    });
  });
  return out;
}

/** Ringkas untuk kartu Kanban PO/DO: kapan barang Indent/Import tiba. */
export function arrivalChip(p: Prospect, today: string): { text: string; cls: string } | null {
  const [g] = buildPoIndent([p]);
  if (!g) return null;
  const flags = g.items.map((it) => ({ it, f: etaFlag(it.eta, it.stat, g.janji, today) }));
  const tiba = flags.filter((x) => x.f === 'tiba').length;
  const others = flags.filter((x) => x.f !== 'tiba');
  if (tiba && !others.length) return { text: `${tiba} item tiba di gudang · siap DO`, cls: 'ok' };
  const lewat = others.filter((x) => x.f === 'lewat');
  if (lewat.length) return { text: `Target tiba lewat (${fmtYmd(lewat[0].it.eta)}) · ${lewat.length} item belum tiba`, cls: 'bad' };
  const kosong = others.filter((x) => x.f === 'kosong').length;
  const maxEta = others.map((x) => x.it.eta).filter(Boolean).sort().pop() || '';
  const janji = others.some((x) => x.f === 'janji');
  if (janji) return { text: `Barang tiba ±${fmtYmd(maxEta)} · lewat janji ${fmtYmd(g.janji)}`, cls: 'warn' };
  if (kosong && !maxEta) return { text: `${kosong} item ${others.some((x) => x.it.kond === 'import') ? 'Import' : 'Indent'}: belum ada target tiba`, cls: 'none' };
  return { text: `Barang tiba ±${fmtYmd(maxEta)}${kosong ? ` · ${kosong} item belum ada target` : ''}${tiba ? ` · ${tiba} item sudah tiba` : ''}`, cls: 'ok2' };
}
