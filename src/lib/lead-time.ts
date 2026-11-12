import { getProspectMaterials } from './format';
import { flowItems } from './item-flow';
import { itemStock, needsArrival, STOK_META, type StokKond } from './item-stock';
import { buildTrendRows, monthsEnding, type ItemSentMap } from './material-trend';
import type { Prospect } from './types';

/**
 * Analisa Eksekutif > Lead Time: berapa lama dari PO customer sampai barang
 * terkirim, per item. Sumber tanggal:
 *  - PO   : event 'po' per item (Status Item) → fallback tgl PO prospek.
 *  - Kirim: event 'kirim' per item (Catat Pengiriman / DO; koreksi memperbarui
 *           event yang sama, yang dibatalkan tidak ikut) → fallback tgl
 *           delivery prospek (= pengiriman pertama saja).
 *  - Sumber: kondisi stok per item (Ready / Ready cabang lain = stok, Indent /
 *           Import = indent). Belum diisi: indent bila cocok dengan jawaban
 *           RFQ yang ber-janji, selain itu stok.
 *  - Janji: waktu delivery jawaban Purchasing di RFQ prospek (grade + tebal /
 *           diameter sama) → fallback target tiba (ETA) PO Indent. Perkiraan
 *           lama dari Sales hanya ditampilkan, tidak dinilai.
 * Semua hitungan memakai hari kalender.
 */

export interface LtEvent {
  prospectId: string;
  type: 'po' | 'kirim';
  tgl: string;
  docNo: string;
  items: { itemId: string; qty: number }[];
}

export interface LtJanji {
  prospectId: string;
  noRfq: string;
  grade: string;
  material: string;
  thick: number;
  dia: number;
  text: string;
}

export type LtSource = 'stok' | 'indent';

export interface LtKirim {
  tgl: string;
  qty: number;
  docNo: string;
  days: number;
}

export interface LtRow {
  key: string;
  prospectId: string;
  customer: string;
  cabang: string;
  se: string;
  noPo: string;
  itemId: string;
  label: string;
  grade: string;
  gradeKey: string;
  fab: boolean;
  satuan: string;
  kgPc: number;
  poQty: number;
  sentQty: number;
  openQty: number;
  tglMinta: string;
  tglTawar: string;
  tglPO: string;
  tglFaktur: string;
  kirim: LtKirim[];
  firstDays: number | null;
  lunasDays: number | null;
  lunasMonth: string;
  lunas: boolean;
  /** PO belum lunas: hari sejak PO s/d hari ini. */
  ageDays: number | null;
  tawarToPo: number | null;
  source: LtSource;
  janjiDays: number | null;
  janjiText: string;
  /** Asal janji: RFQ (waktu delivery) / ETA (target tiba PO Indent). */
  janjiFrom: '' | 'RFQ' | 'ETA';
  noRfq: string;
  /** Kondisi stok per item yang diisi Sales ('' bila belum). */
  kond: string;
  /** Perkiraan lama dari Sales (referensi, tidak dinilai). */
  lamaSales: string;
  /** true tepat janji · false terlambat / lewat janji · null belum bisa dinilai. */
  onTime: boolean | null;
  lateBy: number | null;
  poFromItem: boolean;
  kirimFromItem: boolean;
}

const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}/.test(v);
const day = (v: string | null | undefined) => (isDay(v) ? String(v).slice(0, 10) : '');
export function dayDiff(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
const gKey = (g: string) => g.toUpperCase().replace(/[\s\-_.]/g, '');

/**
 * "6–8 minggu" → 56, "2 bulan" → 60, "30 hari" → 30. Ambil batas atas.
 * "Ready stock" → stok (tanpa janji indent). Tak terbaca → null.
 */
export function parseJanji(text: string): { days: number | null; stok: boolean } {
  const t = (text || '').toLowerCase();
  if (/ready|ex[\s-]?stoc?k|\bstoc?k\b|tersedia/.test(t)) return { days: null, stok: true };
  const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(',', '.'))).filter((n) => n > 0);
  if (!nums.length) return { days: null, stok: false };
  const unit = /minggu|mgg|week|wk/.test(t) ? 7 : /bulan|bln|month/.test(t) ? 30 : 1;
  return { days: Math.round(Math.max(...nums) * unit), stok: false };
}

export function median(list: number[]): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
export function quantile(list: number[], q: number): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/** Peta kirim per item untuk tab Product (basis terkirim per bulan kirim). */
export function sentMapOf(events: LtEvent[]): ItemSentMap {
  const map: ItemSentMap = new Map();
  events.forEach((e) => {
    if (e.type !== 'kirim') return;
    const per = map.get(e.prospectId) || new Map();
    e.items.forEach((l) => {
      const list = per.get(l.itemId) || [];
      list.push({ tgl: e.tgl, qty: l.qty });
      per.set(l.itemId, list);
    });
    map.set(e.prospectId, per);
  });
  return map;
}

export function buildLeadTimeRows(prospects: Prospect[], events: LtEvent[], janji: LtJanji[], today: string): LtRow[] {
  const evBy = new Map<string, LtEvent[]>();
  events.forEach((e) => evBy.set(e.prospectId, [...(evBy.get(e.prospectId) || []), e]));
  const janjiBy = new Map<string, LtJanji[]>();
  janji.forEach((j) => janjiBy.set(j.prospectId, [...(janjiBy.get(j.prospectId) || []), j]));

  const out: LtRow[] = [];
  prospects.forEach((p) => {
    const status = Number(p.status);
    if (status !== 4 && status !== 5) return;
    const flow = flowItems(p);
    const trend = buildTrendRows([p]);
    const evs = (evBy.get(p.id) || []).slice().sort((a, b) => a.tgl.localeCompare(b.tgl));
    const js = janjiBy.get(p.id) || [];
    const mats = getProspectMaterials(p) as unknown as Record<string, unknown>[];
    const tglTawar = day(p.tglPenawaran);
    const created = day(p.createdAt);
    flow.forEach((f, i) => {
      const po = f.po || 0;
      if (!(po > 0)) return;
      const t = trend[i];
      const poEv = evs.find((e) => e.type === 'po' && e.items.some((l) => l.itemId === f.itemId));
      const tglPO = day(poEv?.tgl) || day(p.tglPO);
      if (!tglPO) return;
      let kirim: LtKirim[] = evs
        .filter((e) => e.type === 'kirim')
        .flatMap((e) => e.items.filter((l) => l.itemId === f.itemId).map((l) => ({ tgl: day(e.tgl), qty: l.qty, docNo: e.docNo, days: 0 })))
        .filter((k) => k.tgl);
      const kirimFromItem = kirim.length > 0;
      if (!kirimFromItem && f.sent > 0 && day(p.tglDelivery)) kirim = [{ tgl: day(p.tglDelivery), qty: f.sent, docNo: '', days: 0 }];
      kirim.forEach((k) => (k.days = Math.max(0, dayDiff(tglPO, k.tgl))));
      const lunas = f.sent >= po && kirim.length > 0;
      const last = kirim[kirim.length - 1];

      // Janji Purchasing: RFQ prospek ini dengan grade (dan tebal / diameter) sama.
      const gk = t?.gradeKey || '';
      const dimV = Number(t?.dim?.tebal || t?.dim?.dia || t?.dim?.od || 0);
      let j: LtJanji | undefined;
      const same = js.filter((x) => gKey(x.grade) && gKey(x.grade) === gk);
      if (same.length) j = same.find((x) => (x.thick || x.dia) && dimV && (x.thick || x.dia) === dimV) || same[0];
      else if (js.length === 1 && flow.length === 1) j = js[0];
      const pj = j ? parseJanji(j.text) : null;
      const rfqJanji = !!pj && !pj.stok && pj.days != null;
      const stk = itemStock(mats[i], p.kondisiStock);
      const kond: StokKond | null = stk.kond;
      const indent = kond ? needsArrival(kond) : rfqJanji;
      let janjiDays: number | null = null;
      let janjiText = '';
      let janjiFrom: LtRow['janjiFrom'] = '';
      if (indent && rfqJanji) {
        janjiDays = pj!.days;
        janjiText = j!.text;
        janjiFrom = 'RFQ';
      } else if (indent && stk.eta && stk.eta >= tglPO) {
        janjiDays = dayDiff(tglPO, stk.eta);
        janjiText = `ETA ${stk.eta.slice(8, 10)}/${stk.eta.slice(5, 7)}/${stk.eta.slice(0, 4)}`;
        janjiFrom = 'ETA';
      }
      const lunasDays = lunas ? last.days : null;
      const ageDays = lunas ? null : Math.max(0, dayDiff(tglPO, today));
      let onTime: boolean | null = null;
      let lateBy: number | null = null;
      if (janjiDays != null) {
        if (lunasDays != null) {
          onTime = lunasDays <= janjiDays;
          lateBy = onTime ? null : lunasDays - janjiDays;
        } else if (ageDays != null && ageDays > janjiDays) {
          onTime = false;
          lateBy = ageDays - janjiDays;
        }
      }
      out.push({
        key: `${p.id}:${f.itemId}`,
        prospectId: p.id,
        customer: p.customer,
        cabang: (p.cabang || '').trim().toUpperCase(),
        se: (p.se || '').toUpperCase(),
        noPo: poEv?.docNo || p.noPo || '',
        itemId: f.itemId,
        label: f.label || t?.label || '',
        grade: f.fab ? 'Line 05 Fabrikasi' : t?.grade || '(Tanpa grade)',
        gradeKey: f.fab ? '~fab' : gk || '~none',
        fab: f.fab,
        satuan: f.satuan,
        kgPc: t?.kgPc || f.kgPc || 0,
        poQty: po,
        sentQty: f.sent,
        openQty: Math.max(0, Math.round((po - f.sent) * 100) / 100),
        tglMinta: created,
        tglTawar,
        tglPO,
        tglFaktur: day(p.tglFaktur),
        kirim,
        firstDays: kirim.length ? kirim[0].days : null,
        lunasDays,
        lunasMonth: lunas ? last.tgl.slice(0, 7) : '',
        lunas,
        ageDays,
        tawarToPo: tglTawar ? Math.max(0, dayDiff(tglTawar, tglPO)) : null,
        source: indent ? 'indent' : 'stok',
        janjiDays,
        janjiText,
        janjiFrom,
        noRfq: janjiFrom === 'RFQ' ? j!.noRfq : '',
        kond: kond ? STOK_META[kond].short : '',
        lamaSales: stk.lama,
        onTime,
        lateBy,
        poFromItem: !!poEv,
        kirimFromItem,
      });
    });
  });
  return out;
}

export const AGING = [
  { label: '0–14 hari', min: 0, max: 14 },
  { label: '15–30 hari', min: 15, max: 30 },
  { label: '31–60 hari', min: 31, max: 60 },
  { label: '> 60 hari', min: 61, max: Infinity },
];

export interface LtGrade {
  key: string;
  grade: string;
  source: 'stok' | 'indent' | 'campur';
  n: number;
  tawarMed: number | null;
  med: number | null;
  avg: number | null;
  /** [min, q1, q3, max] hari PO → lunas. */
  spread: [number, number, number, number] | null;
  janjiMed: number | null;
  onTime: number;
  judged: number;
  open: number;
  perItem: number;
  lunasN: number;
}

export interface LtAnalysis {
  rows: LtRow[];
  kpi: {
    lunasMed: number | null;
    stokMed: number | null;
    indentMed: number | null;
    firstMed: number | null;
    bertahapPct: number | null;
    onTimePct: number | null;
    onTime: number;
    judged: number;
    openN: number;
    openKg: number;
    open60: number;
    tawarMed: number | null;
    tawarFast: string;
    tawarSlow: string;
  };
  grades: LtGrade[];
  open: LtRow[];
  aging: { label: string; n: number; kg: number }[];
  trend: { month: string; med: number | null; n: number }[];
  quality: { total: number; poItem: number; kirimItem: number; kirimProspek: number; indent: number; kondItem: number; noJanji: number };
}

export const rowKg = (r: LtRow, q: number) => (r.fab ? 0 : q * r.kgPc);

export function analyzeLeadTime(all: LtRow[], opts: { from: string; to: string; source: '' | LtSource; grade: string }): LtAnalysis {
  const keep = (r: LtRow) => (!opts.source || r.source === opts.source) && (!opts.grade || r.gradeKey === opts.grade);
  const inMonth = (m: string) => (!opts.from || m >= opts.from) && (!opts.to || m <= opts.to);
  const rows = all.filter((r) => keep(r) && inMonth(r.tglPO.slice(0, 7)));
  const lunas = rows.filter((r) => r.lunasDays != null);
  const withKirim = rows.filter((r) => r.kirim.length);
  const judged = rows.filter((r) => r.onTime != null);
  const onTime = judged.filter((r) => r.onTime).length;
  // PO terbuka: kondisi saat ini, tidak dibatasi periode.
  const open = all.filter((r) => keep(r) && !r.lunas).sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));

  // Penawaran → PO dihitung per prospek (satu PO), bukan per item.
  const perProspect = new Map<string, LtRow>();
  rows.forEach((r) => r.tawarToPo != null && !perProspect.has(r.prospectId) && perProspect.set(r.prospectId, r));

  const byGrade = new Map<string, LtRow[]>();
  rows.forEach((r) => byGrade.set(r.gradeKey, [...(byGrade.get(r.gradeKey) || []), r]));
  const grades: LtGrade[] = Array.from(byGrade.entries())
    .map(([key, list]) => {
      const d = list.filter((r) => r.lunasDays != null).map((r) => r.lunasDays as number);
      const srcs = new Set(list.map((r) => r.source));
      const j = list.filter((r) => r.onTime != null);
      const tw = new Map<string, number>();
      list.forEach((r) => r.tawarToPo != null && tw.set(r.prospectId, r.tawarToPo));
      return {
        key,
        grade: list[0].grade,
        source: (srcs.size > 1 ? 'campur' : list[0].source) as LtGrade['source'],
        n: list.length,
        tawarMed: median(Array.from(tw.values())),
        med: median(d),
        avg: avg(d),
        spread: d.length ? ([Math.min(...d), quantile(d, 0.25), quantile(d, 0.75), Math.max(...d)] as [number, number, number, number]) : null,
        janjiMed: median(list.filter((r) => r.janjiDays != null).map((r) => r.janjiDays as number)),
        onTime: j.filter((r) => r.onTime).length,
        judged: j.length,
        open: list.filter((r) => !r.lunas).length,
        perItem: list.filter((r) => r.kirimFromItem).length,
        lunasN: d.length,
      };
    })
    .sort((a, b) => Number(a.key.startsWith('~')) - Number(b.key.startsWith('~')) || b.n - a.n);

  const tawarGrades = grades.filter((g) => g.tawarMed != null && g.n >= 2 && !g.key.startsWith('~'));
  const byTawar = [...tawarGrades].sort((a, b) => (a.tawarMed as number) - (b.tawarMed as number));

  const months = monthsEnding(opts.to || new Date().toISOString().slice(0, 7), 12);
  const trendRows = all.filter((r) => keep(r) && r.lunasDays != null);
  const trend = months.map((m) => {
    const d = trendRows.filter((r) => r.lunasMonth === m).map((r) => r.lunasDays as number);
    return { month: m, med: median(d), n: d.length };
  });

  return {
    rows,
    kpi: {
      lunasMed: median(lunas.map((r) => r.lunasDays as number)),
      stokMed: median(lunas.filter((r) => r.source === 'stok').map((r) => r.lunasDays as number)),
      indentMed: median(lunas.filter((r) => r.source === 'indent').map((r) => r.lunasDays as number)),
      firstMed: median(withKirim.map((r) => r.firstDays as number)),
      bertahapPct: withKirim.length ? withKirim.filter((r) => r.kirim.length > 1 || !r.lunas).length / withKirim.length : null,
      onTimePct: judged.length ? onTime / judged.length : null,
      onTime,
      judged: judged.length,
      openN: open.length,
      openKg: open.reduce((s, r) => s + rowKg(r, r.openQty), 0),
      open60: open.filter((r) => (r.ageDays || 0) > 60).length,
      tawarMed: median(Array.from(perProspect.values()).map((r) => r.tawarToPo as number)),
      tawarFast: byTawar.length > 1 ? byTawar[0].grade : '',
      tawarSlow: byTawar.length > 1 ? byTawar[byTawar.length - 1].grade : '',
    },
    grades,
    open,
    aging: AGING.map((b) => {
      const l = open.filter((r) => (r.ageDays || 0) >= b.min && (r.ageDays || 0) <= b.max);
      return { label: b.label, n: l.length, kg: l.reduce((s, r) => s + rowKg(r, r.openQty), 0) };
    }),
    trend,
    quality: {
      total: rows.length,
      poItem: rows.filter((r) => r.poFromItem).length,
      kirimItem: rows.filter((r) => r.kirimFromItem).length,
      kirimProspek: rows.filter((r) => r.kirim.length && !r.kirimFromItem).length,
      indent: rows.filter((r) => r.source === 'indent').length,
      kondItem: rows.filter((r) => r.kond).length,
      noJanji: rows.filter((r) => r.source === 'indent' && r.janjiDays == null).length,
    },
  };
}

/** Status satu item untuk tabel & linimasa. */
export function ltStatus(r: LtRow): { text: string; tone: 'green' | 'rust' | 'amber' | 'slate' } {
  if (r.lunas) {
    if (r.onTime === true) return { text: 'Tepat janji', tone: 'green' };
    if (r.onTime === false) return { text: `Terlambat ${r.lateBy} hr`, tone: 'rust' };
    return { text: 'Terkirim', tone: 'green' };
  }
  if (r.onTime === false) return { text: `Lewat janji ${r.lateBy} hr`, tone: 'rust' };
  if (r.janjiDays != null) return { text: r.sentQty > 0 ? 'Sebagian · dalam janji' : 'Masih dalam janji', tone: 'amber' };
  return { text: r.sentQty > 0 ? 'Sebagian terkirim' : 'Belum kirim', tone: 'amber' };
}
