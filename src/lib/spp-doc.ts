/**
 * Isi form SPP (Surat Penerimaan Pesanan) FUP A — dipakai bersama oleh layar
 * Form SPP (bisa diedit / ditambah manual), file Excel, file Word dan email.
 * Disimpan di Fupa.spp sehingga isian manual tidak hilang.
 */

export interface SppLine {
  qty: number;
  satuan: string;
  keterangan: string;
  /** Harga per satuan (per KG untuk material berat; per unit untuk fabrikasi). */
  harga: number;
}

export interface SppDoc {
  jenis: 'A' | 'B';
  noSpp: string;
  noFupa: string;
  tgl: string; // YYYY-MM-DD
  cabang: string;
  customer: string;
  npwp: string;
  bumn: '' | 'ya' | 'tidak';
  noPo: string;
  noOe: string;
  disetujuiLangganan: string;
  lines: SppLine[];
  instruksi: string;
  tglKirim: string; // YYYY-MM-DD atau teks bebas
  jangkaBayar: string;
  dibuatOleh: string;
  tglDibuat: string;
  diperiksaOleh: string;
  tglDiperiksa: string;
  disetujuiOleh: string;
  tglDisetujui: string;
  /** Persen PPN (default 11). */
  ppn: number;
}

/** Baris item per halaman form (baris 23..42 template Excel). */
export const SPP_ROWS_PER_PAGE = 20;
export const SPP_PPN_DEFAULT = 11;

export const emptySppLine = (): SppLine => ({ qty: 0, satuan: '', keterangan: '', harga: 0 });

const round2 = (n: number) => Math.round(n * 100) / 100;
export const lineJumlah = (l: SppLine) => round2((Number(l.qty) || 0) * (Number(l.harga) || 0));
export const filledLines = (d: Pick<SppDoc, 'lines'>) => d.lines.filter((l) => String(l.keterangan || '').trim() || Number(l.qty) || Number(l.harga));

export function sppTotals(d: Pick<SppDoc, 'lines' | 'ppn'>): { sub: number; ppn: number; grand: number } {
  const sub = round2(filledLines(d).reduce((s, l) => s + lineJumlah(l), 0));
  const ppn = round2((sub * (Number(d.ppn) || 0)) / 100);
  return { sub, ppn, grand: round2(sub + ppn) };
}

/** Bersihkan kiriman dari browser (tipe, panjang, jumlah baris). */
export function cleanSppDoc(x: unknown, fallback: SppDoc): SppDoc {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const s = (k: keyof SppDoc, max = 200) => (o[k] === undefined ? String(fallback[k] ?? '') : String(o[k] ?? '')).slice(0, max);
  const lines = (Array.isArray(o.lines) ? o.lines : fallback.lines).slice(0, 200).map((l) => {
    const r = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    return {
      qty: Math.max(0, Number(r.qty) || 0),
      satuan: String(r.satuan ?? '').slice(0, 20),
      keterangan: String(r.keterangan ?? '').slice(0, 400),
      harga: Math.max(0, Number(r.harga) || 0),
    };
  });
  const ppnRaw = o.ppn === undefined ? fallback.ppn : Number(o.ppn);
  return {
    jenis: o.jenis === 'B' ? 'B' : o.jenis === 'A' ? 'A' : fallback.jenis,
    noSpp: s('noSpp', 40),
    noFupa: s('noFupa', 60),
    tgl: s('tgl', 20),
    cabang: s('cabang', 20).toUpperCase(),
    customer: s('customer', 200),
    npwp: s('npwp', 30),
    bumn: o.bumn === 'ya' || o.bumn === 'tidak' ? o.bumn : o.bumn === '' ? '' : fallback.bumn,
    noPo: s('noPo', 80),
    noOe: s('noOe', 80),
    disetujuiLangganan: s('disetujuiLangganan', 120),
    lines,
    instruksi: s('instruksi', 1000),
    tglKirim: s('tglKirim', 40),
    jangkaBayar: s('jangkaBayar', 120),
    dibuatOleh: s('dibuatOleh', 80),
    tglDibuat: s('tglDibuat', 20),
    diperiksaOleh: s('diperiksaOleh', 80),
    tglDiperiksa: s('tglDiperiksa', 20),
    disetujuiOleh: s('disetujuiOleh', 80),
    tglDisetujui: s('tglDisetujui', 20),
    ppn: Number.isFinite(ppnRaw) && ppnRaw >= 0 && ppnRaw <= 100 ? ppnRaw : SPP_PPN_DEFAULT,
  };
}

/** Halaman-halaman baris item (minimal satu halaman). */
export function sppPages(d: Pick<SppDoc, 'lines'>): SppLine[][] {
  const list = filledLines(d);
  const pages: SppLine[][] = [];
  for (let i = 0; i < list.length; i += SPP_ROWS_PER_PAGE) pages.push(list.slice(i, i + SPP_ROWS_PER_PAGE));
  return pages.length ? pages : [[]];
}

export const sppFileBase = (d: Pick<SppDoc, 'noFupa'>) => `SPP_${(d.noFupa || 'FUPA').replace(/[^A-Za-z0-9]+/g, '_')}`;
