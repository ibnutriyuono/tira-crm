import { normalizeLine, num } from './format';
import { LINE_FABRIKASI } from './doc-lines';
import type { Material, RfqItem } from './types';

/**
 * Form material seragam — one row model shared by Prospek, RFQ and FUP A.
 *
 * A row is described by bentuk (shape) + dimensions in mm; berat/pc and the
 * uraian text are derived from them (both still overridable by hand). The
 * stored records keep their existing fields (Material.uraian/beratPc,
 * RfqItem.material/dia/thick/width/length/berat) filled from the row, so every
 * screen, export and report that reads them keeps working; the spec itself
 * rides along in extra optional JSON fields.
 *
 * Line 05 (fabrikasi) rows are sold per unit/set: nama pekerjaan, no. gambar,
 * satuan and harga per unit instead of a shape.
 */

export type DimKey = 'dia' | 'tebal' | 'lebar' | 'panjang' | 'sisi' | 'od' | 'h' | 'b' | 't1' | 't2';
export type Dims = Partial<Record<DimKey, string>>;

export const SHAPES: Record<string, [DimKey, string][]> = {
  'Round Bar': [['dia', 'Dia'], ['panjang', 'Panjang']],
  'Square Bar': [['sisi', 'Sisi'], ['panjang', 'Panjang']],
  'Hex Bar': [['sisi', 'Sisi (AF)'], ['panjang', 'Panjang']],
  Plate: [['tebal', 'Tebal'], ['lebar', 'Lebar'], ['panjang', 'Panjang']],
  'Flat Bar': [['tebal', 'Tebal'], ['lebar', 'Lebar'], ['panjang', 'Panjang']],
  Pipe: [['od', 'OD'], ['tebal', 'Tebal'], ['panjang', 'Panjang']],
  Hollow: [['sisi', 'Sisi'], ['tebal', 'Tebal'], ['panjang', 'Panjang']],
  Beam: [['h', 'H'], ['b', 'B'], ['t1', 't1 web'], ['t2', 't2 flange'], ['panjang', 'Panjang']],
  'Profil Siku': [['h', 'A'], ['b', 'B'], ['tebal', 'Tebal'], ['panjang', 'Panjang']],
  'Profil UNP': [['h', 'H'], ['b', 'B'], ['t1', 't1 web'], ['t2', 't2 flange'], ['panjang', 'Panjang']],
  Coil: [['tebal', 'Tebal'], ['lebar', 'Lebar'], ['panjang', 'Panjang (ops.)']],
  'Wire Mesh': [['dia', 'Dia kawat'], ['sisi', 'Spasi'], ['lebar', 'Lebar'], ['panjang', 'Panjang']],
  Lainnya: [],
};
export const SHAPE_NAMES = Object.keys(SHAPES);
export const SATUAN_FAB = ['unit', 'set', 'lot', 'kg'];

export const GRADE_SUGGESTIONS = [
  'HQ 705', 'HQ 760', 'TC 8000', 'TW 400', 'SH 310', 'SKD11', 'SKD61', 'S45C', 'SS304', 'SS316', 'SS400', 'SCM440',
  'DF2', 'VCN 150', 'ST 37', 'A36', 'K110', 'K340', 'P20', 'SPCC', 'SPHC', 'SGCC',
];

const STEEL = 7.85e-6; // kg per mm³

/** "19,5" -> 19.5 (dimensions are typed with a decimal comma). */
export function dimNum(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Weight of one piece from shape + dimensions, in kg (unrounded; 0 when it can't be computed). */
export function autoWeight(bentuk: string, d: Dims): number {
  const L = dimNum(d.panjang);
  switch (bentuk) {
    case 'Round Bar': return (Math.PI / 4) * dimNum(d.dia) ** 2 * L * STEEL;
    case 'Square Bar': return dimNum(d.sisi) ** 2 * L * STEEL;
    case 'Hex Bar': return 0.866 * dimNum(d.sisi) ** 2 * L * STEEL;
    case 'Plate':
    case 'Flat Bar':
    case 'Coil': return dimNum(d.tebal) * dimNum(d.lebar) * L * STEEL;
    case 'Pipe': return Math.PI * (dimNum(d.od) - dimNum(d.tebal)) * dimNum(d.tebal) * L * STEEL;
    case 'Hollow': return 4 * (dimNum(d.sisi) - dimNum(d.tebal)) * dimNum(d.tebal) * L * STEEL;
    case 'Profil Siku': return (dimNum(d.h) + dimNum(d.b) - dimNum(d.tebal)) * dimNum(d.tebal) * L * STEEL;
    case 'Beam':
    case 'Profil UNP': return (2 * dimNum(d.b) * dimNum(d.t2) + (dimNum(d.h) - 2 * dimNum(d.t2)) * dimNum(d.t1)) * L * STEEL;
    case 'Wire Mesh': {
      const sp = dimNum(d.sisi);
      const W = dimNum(d.lebar);
      if (!sp || !W || !L) return 0;
      const wires = (Math.floor(W / sp) + 1) * L + (Math.floor(L / sp) + 1) * W;
      return (Math.PI / 4) * dimNum(d.dia) ** 2 * wires * STEEL;
    }
    default: return 0;
  }
}

/** Auto weights are always rounded UP to a whole kg. */
export function roundUpKg(n: number): number {
  return n > 0 ? Math.ceil(n - 1e-9) : 0;
}

export function autoUraian(bentuk: string, grade: string, d: Dims): string {
  const x = ' × ';
  const j = (...v: (string | undefined)[]) => v.filter(Boolean).join(x);
  let dims = '';
  if (bentuk === 'Round Bar' && d.dia) dims = `Dia ${j(d.dia, d.panjang)} mm`;
  if ((bentuk === 'Plate' || bentuk === 'Flat Bar' || bentuk === 'Coil') && d.tebal) dims = `${j(d.tebal, d.lebar, d.panjang)} mm`;
  if (bentuk === 'Pipe' && d.od) dims = `OD ${j(d.od, d.tebal, d.panjang)} mm`;
  if (bentuk === 'Hollow' && d.sisi) dims = `${j(d.sisi, d.sisi, d.tebal, d.panjang)} mm`;
  if (bentuk === 'Square Bar' && d.sisi) dims = `${j(d.sisi, d.sisi, d.panjang)} mm`;
  if (bentuk === 'Hex Bar' && d.sisi) dims = `AF ${j(d.sisi, d.panjang)} mm`;
  if ((bentuk === 'Beam' || bentuk === 'Profil UNP') && d.h) dims = `${j(d.h, d.b, d.t1, d.t2, d.panjang)} mm`;
  if (bentuk === 'Profil Siku' && d.h) dims = `${j(d.h, d.b, d.tebal, d.panjang)} mm`;
  if (bentuk === 'Wire Mesh' && d.dia) dims = `M${d.dia}${d.sisi ? ` ${d.sisi}${x}${d.sisi}` : ''}${d.lebar ? ` · ${j(d.lebar, d.panjang)}` : ''} mm`;
  return [bentuk === 'Lainnya' ? '' : bentuk, grade.trim(), dims].filter(Boolean).join(' ');
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reads "AS HQ 705 Dia 75 x 6 M", "TW 400 # 20 X 1500 X 3000 mm 2 lbr", "WF 200x100x5,5x8 12M"... */
export function parseMaterialText(text: string): { bentuk: string; grade: string; dim: Dims; pcs: string } {
  let t = ` ${String(text || '').toLowerCase()} `;
  let bentuk = 'Lainnya';
  if (/round\s*bar|roundbar|\bas\b|\brb\b/.test(t)) bentuk = 'Round Bar';
  else if (/wire\s*mesh|wiremesh|\bmesh\b/.test(t)) bentuk = 'Wire Mesh';
  else if (/coil/.test(t)) bentuk = 'Coil';
  else if (/siku|angle/.test(t)) bentuk = 'Profil Siku';
  else if (/\bunp\b|channel|kanal/.test(t)) bentuk = 'Profil UNP';
  else if (/beam|\bwf\b|\biwf\b|\bhb\b/.test(t)) bentuk = 'Beam';
  else if (/flat/.test(t)) bentuk = 'Flat Bar';
  else if (/plate|\bplt\b|\bpl\b|#/.test(t)) bentuk = 'Plate';
  else if (/pipe|pipa/.test(t)) bentuk = 'Pipe';
  else if (/hollow/.test(t)) bentuk = 'Hollow';
  else if (/square|\bsq\b/.test(t)) bentuk = 'Square Bar';
  else if (/hex/.test(t)) bentuk = 'Hex Bar';
  else if (/dia|ø/.test(t)) bentuk = 'Round Bar';

  let grade = '';
  for (const g of GRADE_SUGGESTIONS) {
    const re = new RegExp(g.replace(/\s/g, '').split('').map(escRe).join('[\\s-]*'), 'i');
    if (re.test(t)) {
      grade = g;
      t = t.replace(re, ' ');
      break;
    }
  }
  let pcs = '';
  t = t.replace(/(\d+)\s*(pcs|pc|btg|batang|lbr|lembar)\b/, (_m, n: string) => {
    pcs = n;
    return ' ';
  });
  let meshDia = '';
  if (bentuk === 'Wire Mesh') {
    t = t.replace(/\bm\s?(\d+(?:[.,]\d+)?)\b/, (_m, n: string) => {
      meshDia = n;
      return ' ';
    });
  }
  // "2,1 x 5,4 M" (sheet width x length in metres) -> both to mm
  if (/^(Wire Mesh|Plate|Flat Bar|Coil)$/.test(bentuk)) {
    t = t.replace(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*m(?![a-z])/, (all, a: string, b: string) =>
      dimNum(a) <= 12 ? ` ${Math.round(dimNum(a) * 1000)} x ${Math.round(dimNum(b) * 1000)} ` : all,
    );
  }
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*m(?![a-z])/g, (_m, n: string) => ` ${Math.round(dimNum(n) * 1000)} `);
  let dia = '';
  t = t.replace(/(?:dia(?:meter)?\.?|ø)\s*(\d+(?:[.,]\d+)?)/, (_m, n: string) => {
    dia = n;
    return ' ';
  });
  const nums = t.match(/\d+(?:[.,]\d+)?/g) || [];
  const d: Dims = {};
  if (bentuk === 'Round Bar') { d.dia = dia || nums.shift() || ''; d.panjang = nums.shift() || ''; }
  else if (bentuk === 'Plate' || bentuk === 'Flat Bar' || bentuk === 'Coil') { [d.tebal = '', d.lebar = '', d.panjang = ''] = nums; }
  else if (bentuk === 'Pipe') { d.od = dia || nums.shift() || ''; d.tebal = nums.shift() || ''; d.panjang = nums.shift() || ''; }
  else if (bentuk === 'Hollow') { [d.sisi = '', d.tebal = '', d.panjang = ''] = nums; }
  else if (bentuk === 'Profil Siku') { [d.h = '', d.b = '', d.tebal = '', d.panjang = ''] = nums; }
  else if (bentuk === 'Beam' || bentuk === 'Profil UNP') { [d.h = '', d.b = '', d.t1 = '', d.t2 = '', d.panjang = ''] = nums; }
  else if (bentuk === 'Square Bar' || bentuk === 'Hex Bar') { [d.sisi = '', d.panjang = ''] = nums; }
  else if (bentuk === 'Wire Mesh') {
    d.dia = meshDia || dia || nums.shift() || '';
    d.sisi = nums.shift() || '';
    if (nums[0] && nums[0] === d.sisi) nums.shift(); // "150 x 150"
    [d.lebar = '', d.panjang = ''] = nums;
  }
  return { bentuk, grade, dim: d, pcs };
}

// ---------------------------------------------------------------------------
// The editable row and its adapters to the stored shapes.

export interface SpecRow {
  key: string;
  line: string;
  bentuk: string;
  grade: string;
  dim: Dims;
  pcs: string;
  /** Typed weight per piece; '' = use the auto weight. */
  beratManual: string;
  /** Typed description; '' = use the auto uraian. */
  uraianManual: string;
  /** Prospek only. */
  hargaKg: string;
  /** RFQ / FUP A only. */
  lokal: string;
  estimasi: string;
  /** Line 05 (fabrikasi). */
  fabNama: string;
  noGambar: string;
  satuan: string;
  hargaUnit: string;
  /** The stored record this row came from — keeps fields the form doesn't edit (e.g. Purchasing's answer). */
  src?: Record<string, unknown>;
}

/** Extra fields stored inside the material / item JSON. */
export interface SpecExtra {
  bentuk?: string;
  dim?: Dims;
  beratPcAuto?: boolean;
  uraianAuto?: boolean;
  fabNama?: string;
  noGambar?: string;
  satuan?: string;
  hargaUnit?: number;
}

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export function isFabRow(r: Pick<SpecRow, 'line'>): boolean {
  return normalizeLine(r.line).split(/\s*,\s*/).includes(LINE_FABRIKASI);
}

export function emptyRow(over: Partial<SpecRow> = {}): SpecRow {
  return {
    key: newKey(), line: '', bentuk: 'Round Bar', grade: '', dim: {}, pcs: '1', beratManual: '', uraianManual: '',
    hargaKg: '', lokal: 'LOKAL ATAU IMPORT', estimasi: '', fabNama: '', noGambar: '', satuan: 'unit', hargaUnit: '',
    ...over,
  };
}

/** Berat/pc actually used: the typed one, else the rounded-up auto weight. */
export function rowBeratPc(r: SpecRow): number {
  if (isFabRow(r)) return 0;
  return r.beratManual.trim() !== '' ? dimNum(r.beratManual) : roundUpKg(autoWeight(r.bentuk, r.dim));
}

export function rowUraian(r: SpecRow): string {
  if (isFabRow(r)) return [r.fabNama.trim(), r.noGambar.trim() ? `(Gbr ${r.noGambar.trim()})` : ''].filter(Boolean).join(' ');
  return r.uraianManual.trim() !== '' ? r.uraianManual : autoUraian(r.bentuk, r.grade, r.dim);
}

export function rowTotal(r: SpecRow): number {
  const pcs = num(r.pcs);
  if (isFabRow(r)) return pcs * num(r.hargaUnit);
  return pcs * rowBeratPc(r) * num(r.hargaKg);
}

function extraOf(r: SpecRow): SpecExtra {
  if (isFabRow(r)) return { fabNama: r.fabNama, noGambar: r.noGambar, satuan: r.satuan, hargaUnit: num(r.hargaUnit) };
  return { bentuk: r.bentuk, dim: r.dim, beratPcAuto: r.beratManual.trim() === '', uraianAuto: r.uraianManual.trim() === '' };
}

/** Rows read back from storage; records made before this form become 'Lainnya' with their text kept as typed. */
function fromExtra(x: SpecExtra & Record<string, unknown>, base: Partial<SpecRow>, legacyUraian: string, legacyBeratPc: number): SpecRow {
  if (x.fabNama !== undefined || x.noGambar !== undefined) {
    return emptyRow({ ...base, fabNama: String(x.fabNama ?? legacyUraian), noGambar: String(x.noGambar ?? ''), satuan: String(x.satuan || 'unit'), hargaUnit: x.hargaUnit ? String(x.hargaUnit) : '' });
  }
  if (x.bentuk) {
    return emptyRow({
      ...base,
      bentuk: String(x.bentuk),
      dim: { ...(x.dim || {}) },
      beratManual: x.beratPcAuto === false && legacyBeratPc > 0 ? String(legacyBeratPc) : '',
      uraianManual: x.uraianAuto === false ? legacyUraian : '',
    });
  }
  return emptyRow({ ...base, bentuk: 'Lainnya', uraianManual: legacyUraian, beratManual: legacyBeratPc > 0 ? String(legacyBeratPc) : '' });
}

export function materialToRow(m: Material & SpecExtra): SpecRow {
  const base: Partial<SpecRow> = { line: m.line || '', grade: String((m as { grade?: string }).grade || ''), pcs: String(m.qty ?? 1), hargaKg: m.hargaKg ? String(m.hargaKg) : '', src: m as unknown as Record<string, unknown> };
  const r = fromExtra(m as unknown as SpecExtra & Record<string, unknown>, base, m.uraian || '', num(m.beratPc));
  // A legacy line priced as a flat unit price (no berat/harga per kg).
  if (r.bentuk === 'Lainnya' && !isFabRow(r) && !num(m.hargaKg) && num(m.harga) > 0) r.hargaUnit = String(m.harga);
  return r;
}

export function rowToMaterial(r: SpecRow): Material & SpecExtra & { grade?: string } {
  const fab = isFabRow(r);
  const legacyFlat = !fab && !num(r.hargaKg) && num(r.hargaUnit) > 0 ? num(r.hargaUnit) : 0;
  return {
    ...(r.src as object),
    line: normalizeLine(r.line),
    uraian: rowUraian(r),
    qty: num(r.pcs),
    beratPc: fab ? 0 : rowBeratPc(r),
    hargaKg: fab ? 0 : num(r.hargaKg),
    harga: fab ? num(r.hargaUnit) : legacyFlat,
    grade: fab ? '' : r.grade,
    ...extraOf(r),
  } as Material & SpecExtra & { grade?: string };
}

export function itemToRow(it: RfqItem & SpecExtra & { beratPc?: number }): SpecRow {
  const pcs = num(it.pcs) || 1;
  const beratPc = num(it.beratPc) || (num(it.berat) > 0 ? num(it.berat) / pcs : 0);
  const base: Partial<SpecRow> = {
    line: it.line || '', grade: it.grade || '', pcs: String(it.pcs ?? 1), lokal: it.lokal || 'LOKAL ATAU IMPORT', estimasi: it.estimasi || '',
    src: it as unknown as Record<string, unknown>,
  };
  const r = fromExtra(it as unknown as SpecExtra & Record<string, unknown>, base, it.material || '', Math.round(beratPc * 100) / 100);
  if (!it.bentuk && !isFabRow(r)) {
    // Old RFQ rows: keep the typed text, but carry their dimension columns over.
    const d: Dims = {};
    if (it.dia) d.dia = String(it.dia);
    if (it.thick) d.tebal = String(it.thick);
    if (it.width) d.lebar = String(it.width);
    if (it.length) d.panjang = String(it.length);
    r.bentuk = d.dia ? 'Round Bar' : d.tebal || d.lebar ? 'Plate' : 'Lainnya';
    r.dim = d;
  }
  return r;
}

export function rowToItem(r: SpecRow): RfqItem & SpecExtra & { beratPc?: number } {
  const fab = isFabRow(r);
  const beratPc = rowBeratPc(r);
  const pcs = num(r.pcs);
  const d = r.dim;
  return {
    ...(r.src as object),
    line: normalizeLine(r.line),
    grade: fab ? '' : r.grade,
    material: rowUraian(r),
    dia: fab ? '' : d.dia || d.od || '',
    thick: fab ? '' : d.tebal || d.t1 || '',
    width: fab ? '' : d.lebar || d.b || d.sisi || '',
    length: fab ? '' : d.panjang || '',
    pcs: r.pcs,
    // Berat (KGS) on the documents is the line total.
    berat: fab || !beratPc ? '' : String(Math.round(beratPc * pcs * 100) / 100),
    beratPc: fab ? undefined : beratPc || undefined,
    lokal: r.lokal,
    estimasi: r.estimasi,
    ...extraOf(r),
  } as RfqItem & SpecExtra & { beratPc?: number };
}

/** Prospek -> RFQ: same rows, prices dropped, needed-by date filled. */
export function materialRowsToItemRows(rows: SpecRow[], estimasi: string): SpecRow[] {
  return rows.map((r) => ({ ...r, key: newKey(), src: undefined, hargaKg: '', hargaUnit: isFabRow(r) ? '' : r.hargaUnit, lokal: 'LOKAL ATAU IMPORT', estimasi }));
}
