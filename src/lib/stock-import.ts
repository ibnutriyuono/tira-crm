import { parseStockDesc } from './stock';

/**
 * Baca file Excel "Inventory Value Report" (Sage, Steel Division) menjadi
 * baris StockItem. Kolom dicari dari judulnya (Item No, Line, Description,
 * Size, Unit, Quantity, Ext. Cost, /kg, FSV, umur hari); semua kolom setelah
 * FSV yang judulnya terisi dianggap lokasi gudang. Baris tanpa Item No,
 * "Grand Total" dan qty ≤ 0 dilewati.
 */

export interface ParsedStock {
  itemNo: string;
  line: string | null;
  description: string;
  size: string | null;
  unit: string | null;
  qty: number;
  hpp: number | null;
  fsv: number | null;
  ageDays: number | null;
  locations: Record<string, number>;
  grade: string | null;
  gradeKey: string | null;
  variant: string | null;
  bentuk: string | null;
  dim: Record<string, number>;
}

export interface ParseResult {
  rows: ParsedStock[];
  asOf: string | null;
  sheet: string;
  locations: string[];
  skipped: number;
  noHpp: number;
}

const n = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const x = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown) => String(v ?? '').trim();
const ymd = (v: unknown): string | null => {
  // SheetJS kadang menggeser tanggal beberapa jam/detik ke belakang — bulatkan ke hari terdekat.
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Math.round(v.getTime() / 86400000) * 86400000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};

export async function parseStockWorkbook(buf: Buffer): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const hi = aoa.findIndex((r) => Array.isArray(r) && r.some((c) => /^item\s*no/i.test(s(c))) && r.some((c) => /^description/i.test(s(c))));
    if (hi < 0) continue;
    const head = (aoa[hi] as unknown[]).map((c) => s(c));
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const cItem = col(/^item\s*no/i);
    const cLine = col(/^line$/i);
    const cDesc = col(/^description/i);
    const cSize = col(/^size$/i);
    const cUnit = col(/^unit$/i);
    const cQty = col(/^quantity|^qty/i);
    const cCost = col(/^ext\.?\s*cost/i);
    const cKg = col(/^\/\s*kg$/i);
    const cFsv = col(/^fsv$/i);
    const cAge = col(/^day/i);
    if (cItem < 0 || cDesc < 0 || cQty < 0 || cCost < 0) continue;
    const locStart = cFsv >= 0 ? cFsv + 1 : Math.max(cCost, cAge) + 1;
    const locCols = head.map((h, i) => ({ h, i })).filter(({ h, i }) => i >= locStart && h);
    // "As of Date" di baris judul laporan.
    let asOf: string | null = null;
    for (const r of aoa.slice(0, hi)) {
      const k = (r || []).findIndex((c) => /as of date/i.test(s(c)));
      if (k >= 0) asOf = ymd((r as unknown[])[k + 1]);
    }
    const rows: ParsedStock[] = [];
    let skipped = 0;
    let noHpp = 0;
    for (const r of aoa.slice(hi + 1)) {
      const itemNo = s(r?.[cItem]);
      const qty = n(r?.[cQty]);
      if (!itemNo || /total/i.test(itemNo)) continue;
      if (!qty || qty <= 0) {
        skipped++;
        continue;
      }
      const cost = n(r[cCost]);
      const perKg = cKg >= 0 ? n(r[cKg]) : null;
      // Kolom /kg (bila diisi) menimpa Ext. Cost ÷ Qty. Biaya ≈ Rp 1 / satuan = belum ada HPP.
      let hpp = perKg && perKg > 50 ? perKg : cost != null ? cost / qty : null;
      if (hpp != null && hpp < 50) hpp = null;
      if (hpp == null) noHpp++;
      const locations: Record<string, number> = {};
      locCols.forEach(({ h, i }) => {
        const q = n(r[i]);
        if (q && q > 0) locations[h] = q;
      });
      const desc = s(r[cDesc]);
      const size = cSize >= 0 ? s(r[cSize]) || null : null;
      const p = size && /non\s*steel/i.test(size) ? null : parseStockDesc(desc);
      const fsv = cFsv >= 0 ? n(r[cFsv]) : null;
      const age = cAge >= 0 ? n(r[cAge]) : null;
      rows.push({
        itemNo,
        line: cLine >= 0 ? s(r[cLine]) || null : null,
        description: desc,
        size,
        unit: cUnit >= 0 ? s(r[cUnit]) || null : null,
        qty,
        hpp,
        fsv: fsv != null ? Math.round(fsv) : null,
        ageDays: age != null ? Math.round(age) : null,
        locations,
        grade: p?.grade || null,
        gradeKey: p?.gradeKey || null,
        variant: p?.variant || null,
        bentuk: p?.bentuk || null,
        dim: Object.fromEntries(Object.entries(p?.dim || {}).filter(([, v]) => v != null)) as Record<string, number>,
      });
    }
    return { rows, asOf, sheet: name, locations: locCols.map((c) => c.h), skipped, noHpp };
  }
  throw new Error('Format tidak dikenali: kolom "Item No", "Description", "Quantity" dan "Ext. Cost" tidak ditemukan.');
}
