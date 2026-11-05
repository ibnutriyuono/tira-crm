/**
 * Data "Lampiran FUP A" dari satu prospek (dipakai
 * Purchasing sebagai lampiran FUP A): kebutuhan barang per item (qty PO bila
 * sudah PO), harga jual ke customer, kondisi stok yang diisi Sales, posisi
 * stok gudang (snapshot Sage), dan jawaban RFQ terkait (harga, HPP, vendor,
 * COO, delivery — HPP/vendor hanya bila role boleh melihat). Client-safe.
 */
import { flowItems } from './item-flow';
import { ETA_STAT_META, itemStock, STOK_META } from './item-stock';
import { materialToRow, rowBeratPc, rowUraian, isFabRow, type SpecExtra } from './material-spec';
import { getProspectMaterials, num } from './format';
import { WORKFLOW_META, rfqAsWorkflowDoc, workflowStage } from './purchasing-workflow';
import { actualMargin, hasHpp, hppIdr } from './rfq-price';
import { fmtQty, locLabel, matchStock, stockGradeKey, unitShort, type StockRow } from './stock';
import { STATUS_META } from './constants';
import { leadSourceLabel } from './leads';
import type { Material, Prospect, Rfq, RfqItem } from './types';

export interface PrLine {
  no: number;
  line: string;
  uraian: string;
  grade: string;
  ukuran: string;
  pcsOffer: number;
  pcsPo: number | null;
  satuan: string;
  beratPc: number;
  /** Kg yang dibutuhkan (qty PO bila sudah PO, selain itu qty penawaran). */
  kg: number;
  hargaKg: number;
  nilai: number;
  stok: string;
  eta: string;
  /** Stok gudang yang cocok (grade & ukuran) — ringkasan qty + lokasi. */
  gudang: string;
  gudangKg: number;
  rfq: null | { no: string; harga: string; coo: string; delivery: string; noQuote: boolean; hppKg: number | null; margin: number | null; vendor: string };
}

export interface PrDoc {
  customer: string;
  cabang: string;
  reg: number | null;
  sales: string;
  status: string;
  noPo: string;
  tglPO: string | null;
  tglDelivery: string | null;
  tglPenawaran: string | null;
  phone: string;
  lead: string;
  keterangan: string;
  kondisiStock: string;
  lines: PrLine[];
  rfqs: { no: string; tgl: string | null; status: string; openedBy: string; answeredBy: string; answeredAt: string | null; priced: number; total: number }[];
  stockAsOf: string | null;
  showHpp: boolean;
}

const sizeOf = (bentuk: string, d: Record<string, string | undefined>) => {
  const v = (k: string) => String(d[k] || '').trim();
  const parts =
    bentuk === 'Round Bar' || bentuk === 'Pipe'
      ? [v('dia') && `Ø${v('dia')}`, v('od') && `OD ${v('od')}`, v('tebal') && `t${v('tebal')}`, v('panjang')]
      : [v('tebal'), v('sisi'), v('h'), v('b'), v('lebar'), v('panjang')];
  return parts.filter(Boolean).join(' x ');
};

/** Cocokkan baris prospek dengan item RFQ terkait: grade sama + tebal / diameter sama (dahulukan yang sudah dijawab). */
function matchRfqItem(row: { grade: string; dim: Record<string, string | undefined>; line: string }, rfqs: Rfq[]): { rfq: Rfq; it: RfqItem & Record<string, unknown> } | null {
  const { key } = stockGradeKey(row.grade || '');
  if (!key) return null;
  const size = num(row.dim.tebal) || num(row.dim.dia) || num(row.dim.sisi);
  const cands: { rfq: Rfq; it: RfqItem & Record<string, unknown>; score: number }[] = [];
  rfqs.forEach((rfq) =>
    (rfq.items || []).forEach((raw) => {
      const it = raw as RfqItem & Record<string, unknown>;
      if (stockGradeKey(String(it.grade || '')).key !== key) return;
      const s2 = num(it.thick) || num(it.dia);
      if (size && s2 && Math.abs(size - s2) > 0.01) return;
      const answered = num(it.hargaPurchasing) > 0 || it.noQuote;
      cands.push({ rfq, it, score: (answered ? 4 : 0) + (size && s2 ? 2 : 0) + (String(it.line || '') === row.line ? 1 : 0) });
    }),
  );
  cands.sort((a, b) => b.score - a.score || String(b.rfq.tglRfq || '').localeCompare(String(a.rfq.tglRfq || '')));
  return cands[0] || null;
}

export function buildPurchaseRequest(p: Prospect, opts: { rfqs: Rfq[]; stock: StockRow[]; stockAsOf: string | null; salesName: string; showHpp: boolean }): PrDoc {
  const mats = getProspectMaterials(p) as (Material & SpecExtra & Record<string, unknown>)[];
  const flow = flowItems(p);
  const won = num(p.status) === 4 || num(p.status) === 5;
  const lines: PrLine[] = mats.map((m, i) => {
    const r = materialToRow(m);
    const fab = isFabRow(r);
    const f = flow[i];
    const pcsOffer = num(r.pcs) || num(m.qty);
    const pcsPo = won && f && f.po != null ? f.po : null;
    const kgPc = fab ? 0 : rowBeratPc(r);
    const pcsNeed = pcsPo ?? pcsOffer;
    const kg = kgPc * pcsNeed;
    const hargaKg = fab ? 0 : num(r.hargaKg);
    const nilai = fab ? num(r.hargaUnit) * pcsNeed : hargaKg * kg;
    const st = itemStock(m, p.kondisiStock);
    const stok = st.kond ? `${STOK_META[st.kond].label}${st.lama ? ` (${st.lama})` : ''}` : '-';
    const eta = st.eta ? `${st.eta}${st.stat !== 'belum' ? ` · ${ETA_STAT_META[st.stat].label}` : ''}` : st.stat !== 'belum' ? ETA_STAT_META[st.stat].label : '';
    let gudang = '-';
    let gudangKg = 0;
    if (!fab && r.grade) {
      const ms = matchStock({ grade: r.grade, bentuk: r.bentuk, dim: r.dim }, opts.stock, p.cabang || '', 12).filter((x) => x.exact);
      if (ms.length) {
        gudangKg = ms.reduce((s, x) => s + x.row.qty, 0);
        const locs = new Map<string, number>();
        ms.forEach((x) => Object.entries(x.row.locations).forEach(([l, q]) => locs.set(locLabel(l), (locs.get(locLabel(l)) || 0) + q)));
        const u = unitShort(ms[0].row.unit);
        const vars = Array.from(new Set(ms.map((x) => (x.row.variant ? `-${x.row.variant}` : 'std'))));
        gudang = `${fmtQty(gudangKg)} ${u}${vars.length > 1 || vars[0] !== 'std' ? ` (${vars.join('/')})` : ''}: ${[...locs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, q]) => `${l} ${fmtQty(q)}`).join(', ')}`;
      }
    }
    const hit = fab ? null : matchRfqItem({ grade: r.grade, dim: r.dim, line: r.line }, opts.rfqs);
    let rfq: PrLine['rfq'] = null;
    if (hit) {
      const it = hit.it;
      const cur = it.currency && it.currency !== 'IDR' ? `${it.currency} ` : 'Rp ';
      rfq = {
        no: hit.rfq.noRfq || '-',
        harga: it.noQuote ? 'No Quote' : num(it.hargaPurchasing) > 0 ? `${cur}${Math.round(num(it.hargaPurchasing)).toLocaleString('id-ID')}${it.uom ? `/${String(it.uom).toLowerCase()}` : ''}` : 'belum dijawab',
        coo: String(it.coo || ''),
        delivery: String(it.deliveryTime || ''),
        noQuote: !!it.noQuote,
        hppKg: opts.showHpp && hasHpp(it) ? hppIdr(it) : null,
        margin: opts.showHpp ? actualMargin(it) : null,
        vendor: opts.showHpp ? String(it.vendorNama || '') : '',
      };
    }
    return {
      no: i + 1,
      line: r.line || '-',
      uraian: fab ? r.fabNama || rowUraian(r) : rowUraian(r),
      grade: r.grade,
      ukuran: fab ? r.noGambar || '-' : sizeOf(r.bentuk, r.dim) || '-',
      pcsOffer,
      pcsPo,
      satuan: fab ? r.satuan || 'unit' : 'pcs',
      beratPc: kgPc,
      kg,
      hargaKg,
      nilai,
      stok,
      eta,
      gudang,
      gudangKg,
      rfq,
    };
  });
  const rfqs = opts.rfqs.map((r) => {
    const st = workflowStage(rfqAsWorkflowDoc(r));
    const items = r.items || [];
    return {
      no: r.noRfq || '-',
      tgl: r.tglRfq,
      status: WORKFLOW_META[st].label.replace(/^\d+\.\s*/, ''),
      openedBy: r.openedByName || '',
      answeredBy: r.jawabanByName || '',
      answeredAt: r.jawabanRfqAt,
      priced: items.filter((it) => num(it.hargaPurchasing) > 0 || it.noQuote).length,
      total: items.length,
    };
  });
  return {
    customer: p.customer,
    cabang: p.cabang || '-',
    reg: p.reg,
    sales: opts.salesName,
    status: STATUS_META[num(p.status)]?.label || String(p.status),
    noPo: p.noPo || '',
    tglPO: p.tglPO,
    tglDelivery: p.tglDelivery,
    tglPenawaran: p.tglPenawaran,
    phone: p.phone || '',
    lead: p.leadSource ? `${leadSourceLabel(p.leadSource)}${p.leadBy ? ` · ${p.leadBy}` : ''}` : '',
    keterangan: p.keterangan || '',
    kondisiStock: p.kondisiStock || '',
    lines,
    rfqs,
    stockAsOf: opts.stockAsOf,
    showHpp: opts.showHpp,
  };
}
