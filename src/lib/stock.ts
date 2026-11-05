/**
 * Stok gudang (snapshot Inventory Value Report Sage, diunggah Admin) dan
 * pencocokannya dengan material prospek.
 *
 * - Uraian Sage ("TW 500-G PLT 6 X 500 X 1500 MM", "HQ 705-D R 19 L 5000 MM")
 *   dibaca menjadi grade + varian (-D / -G) + bentuk + ukuran.
 * - Prospek dengan grade yang sama (semua varian: dasar, -D, -G) dan tebal /
 *   diameter yang sama ditawarkan sebagai opsi stok, dengan posisi gudang,
 *   kondisi (FSV + umur) dan saran harga jual minimal = HPP × (1 + margin%).
 * - HPP tidak pernah dikirim ke client lewat /api/stock — hanya saran harga.
 *
 * Client-safe (tanpa import server).
 */

export type StockDim = { tebal?: number; lebar?: number; panjang?: number; dia?: number; sisi?: number };

export interface StockRow {
  id: string;
  itemNo: string;
  line: string | null;
  description: string;
  unit: string | null;
  qty: number;
  fsv: number | null;
  ageDays: number | null;
  locations: Record<string, number>;
  grade: string | null;
  gradeKey: string | null;
  variant: string | null;
  bentuk: string | null;
  dim: StockDim;
  /** Saran harga jual minimal per satuan (Rp) — null bila HPP belum tersedia. */
  saran: number | null;
}

export interface StockMeta {
  asOf: string | null;
  fileName: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  count: number;
}

/** Kode FSV Sage → kondisi stok. */
export const FSV_META: Record<number, { label: string; short: string; cls: string }> = {
  1: { label: 'Fast moving', short: 'Fast', cls: 'green' },
  2: { label: 'Slow moving', short: 'Slow', cls: 'amber' },
  3: { label: 'Very slow / lama', short: 'Very slow', cls: 'rust' },
};

/** Kolom lokasi Sage → kode cabang CRM (lokasi tanpa cabang dibiarkan bernama). */
export const STOCK_LOC_CABANG: Record<string, string> = {
  BALIKPAPAN: 'BLP',
  BANDUNG: 'BDG',
  BANJARMASIN: 'BJM',
  CILACAP: 'CLP',
  CILEGON: 'CLG',
  JAKARTA: 'DKI',
  MAKASSAR: 'MKS',
  MEDAN: 'MDN',
  PADANG: 'PDG',
  PALEMBANG: 'PLB',
  PEKANBARU: 'PKB',
  SEMARANG: 'SMG',
  SURABAYA: 'SBY',
};

export function locLabel(loc: string): string {
  const k = loc.trim().toUpperCase();
  if (k.startsWith('PT TIRA')) return 'Gudang Pusat';
  return loc.trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase());
}
export const locCabang = (loc: string) => STOCK_LOC_CABANG[loc.trim().toUpperCase()] || '';

/** "TW 500-G" → "TW500"; "HQ 705" → "HQ705". Spasi, tanda hubung dan akhiran varian -D/-G diabaikan. */
export function stockGradeKey(grade: string): { key: string; variant: string } {
  const g = grade.toUpperCase().trim();
  const m = g.match(/^(.*?)[\s-]*-\s*([DG])$/) || g.match(/^(.*\d)\s*([DG])$/);
  const base = m ? m[1] : g;
  return { key: base.replace(/[\s\-_./]/g, ''), variant: m ? m[2] : '' };
}

const SHAPE_TOKENS: [RegExp, string][] = [
  [/^(PLT|PLATE|PL|SHEET)$/, 'Plate'],
  [/^(R|RB|ROUND)$/, 'Round Bar'],
  [/^(FLAT|FLT|FB)$/, 'Flat Bar'],
  [/^(HEX)$/, 'Hex Bar'],
  [/^(SQ|SQR)$/, 'Square Bar'],
  [/^(PIPE)$/, 'Pipe'],
];
const num = (s: string | undefined) => {
  const n = parseFloat(String(s || '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Baca uraian Sage menjadi grade, varian, bentuk dan ukuran (mm). */
export function parseStockDesc(desc: string): { grade: string; gradeKey: string; variant: string; bentuk: string; dim: StockDim } | null {
  const text = desc.replace(/\s+/g, ' ').trim().toUpperCase();
  const toks = text.split(' ');
  const at = toks.findIndex((t, i) => i > 0 && SHAPE_TOKENS.some(([re]) => re.test(t)));
  if (at <= 0) return null;
  const grade = toks.slice(0, at).join(' ');
  if (!/\d/.test(grade) && grade.length < 2) return null;
  const bentuk = SHAPE_TOKENS.find(([re]) => re.test(toks[at]))![1];
  const rest = toks.slice(at + 1).join(' ').replace(/\bMM\b/g, '').trim();
  const dim: StockDim = {};
  if (bentuk === 'Plate' || bentuk === 'Flat Bar') {
    const m = rest.match(/^([\d.,]+)\s*X\s*([\d.,]+)(?:\s*X\s*([\d.,]+))?/);
    if (m) {
      dim.tebal = num(m[1]);
      dim.lebar = num(m[2]);
      dim.panjang = num(m[3]);
    }
  } else {
    const m = rest.match(/^([\d.,]+)/);
    if (m) {
      if (bentuk === 'Round Bar' || bentuk === 'Pipe') dim.dia = num(m[1]);
      else dim.sisi = num(m[1]);
    }
    const l = rest.match(/L\s*([\d.,]+)/);
    if (l) dim.panjang = num(l[1]);
  }
  const { key, variant } = stockGradeKey(grade);
  return { grade, gradeKey: key, variant, bentuk, dim };
}

/** Saran harga jual minimal: HPP × (1 + margin%), dibulatkan ke atas ke Rp 100. */
export function saranHarga(hpp: number | null | undefined, marginPct: number): number | null {
  if (!hpp || hpp <= 0) return null;
  return Math.ceil((hpp * (1 + marginPct / 100)) / 100) * 100;
}

export interface StockNeed {
  grade: string;
  bentuk: string;
  dim: Record<string, string | undefined>;
}

export interface StockMatch {
  row: StockRow;
  /** Ukuran persis (tebal / diameter sama). */
  exact: boolean;
  /** Plate: lebar × panjang stok cukup untuk dipotong sesuai permintaan. */
  fits: boolean | null;
  /** Varian sama persis dengan yang diminta (dasar / -D / -G). */
  sameVariant: boolean;
  /** Ada di gudang cabang prospek. */
  local: boolean;
}

const plateLike = (b: string) => b === 'Plate' || b === 'Flat Bar' || b === 'Coil';
const barLike = (b: string) => b === 'Round Bar' || b === 'Pipe';

/**
 * Stok yang cocok untuk satu baris material prospek: grade sama (semua varian
 * -D / -G ikut ditampilkan), bentuk sejenis, tebal / diameter sama — atau,
 * bila tidak ada yang persis, ukuran terdekat di atasnya (≤ +25%).
 */
export function matchStock(need: StockNeed, stock: StockRow[], cabang = '', limit = 6): StockMatch[] {
  if (!need.grade.trim()) return [];
  const { key, variant } = stockGradeKey(need.grade);
  if (!key) return [];
  const want = (k: string) => num(need.dim[k]);
  const isPlate = plateLike(need.bentuk);
  const isBar = barLike(need.bentuk);
  const size = isPlate ? want('tebal') : isBar ? want('dia') : want('sisi');
  const cab = cabang.toUpperCase();
  const pool = stock.filter((s) => s.gradeKey === key && s.qty > 0 && (!s.bentuk || !need.bentuk || need.bentuk === 'Lainnya' || (isPlate ? plateLike(s.bentuk) : isBar ? barLike(s.bentuk) : s.bentuk === need.bentuk)));
  const sizeOf = (s: StockRow) => (isPlate ? s.dim.tebal : isBar ? s.dim.dia : s.dim.sisi);
  const build = (s: StockRow, exact: boolean): StockMatch => {
    let fits: boolean | null = null;
    if (isPlate && s.dim.lebar && s.dim.panjang && want('lebar') && want('panjang')) {
      const [a, b] = [want('lebar')!, want('panjang')!].sort((x, y) => x - y);
      const [c, d] = [s.dim.lebar, s.dim.panjang].sort((x, y) => x - y);
      fits = a <= c && b <= d;
    }
    return {
      row: s,
      exact,
      fits,
      sameVariant: (s.variant || '') === variant,
      local: !!cab && Object.entries(s.locations).some(([loc, q]) => q > 0 && locCabang(loc) === cab),
    };
  };
  let out: StockMatch[];
  if (!size) out = pool.map((s) => build(s, false));
  else {
    out = pool.filter((s) => sizeOf(s) != null && Math.abs((sizeOf(s) as number) - size) < 0.01).map((s) => build(s, true));
    if (!out.length) {
      const bigger = pool.filter((s) => (sizeOf(s) ?? 0) > size && (sizeOf(s) as number) <= size * 1.25);
      const next = Math.min(...bigger.map((s) => sizeOf(s) as number));
      out = bigger.filter((s) => sizeOf(s) === next).map((s) => build(s, false));
    }
  }
  const rank = (m: StockMatch) => (m.fits === false ? 1 : 0) * 8 + (m.sameVariant ? 0 : 1) * 4 + (m.local ? 0 : 1) * 2;
  return out.sort((a, b) => rank(a) - rank(b) || b.row.qty - a.row.qty).slice(0, limit);
}

/** Varian grade yang ada di stok untuk grade ini (mis. ['', 'D', 'G']). */
export function stockVariants(grade: string, stock: StockRow[]): string[] {
  const { key } = stockGradeKey(grade);
  return Array.from(new Set(stock.filter((s) => s.gradeKey === key && s.qty > 0).map((s) => s.variant || ''))).sort();
}

export const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
export const unitShort = (u: string | null) => {
  const x = (u || '').toLowerCase();
  return x.startsWith('kg') ? 'kg' : x.startsWith('pc') ? 'pcs' : x || 'unit';
};
