/**
 * Surat Penawaran -> PDF (A4), dibangun dari model yang sama dengan pratinjau
 * dan file Word (lib/quotation-doc.ts), jadi isinya selalu sama. Teks PDF asli
 * (bisa dicari / disalin), bukan gambar. Dimuat dinamis di browser.
 */
import { quoteColumns, quoteLabels, quoteTerms, quoteTexts, quoteTotals, terbilang, type QuoteData, type QuoteOpts } from './quotation-doc';
import type { LogoImage } from './quotation-docx';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const INK = hex('1A222B');
const STEEL = hex('456484');
const AMBER = hex('C47F2C');
const SOFT = hex('5B6573');
const GRID = hex('C9D3DD');
const ZEBRA = hex('F3F5F7');
const GRAND = hex('FBF1E4');
const WHITE: RGB = [255, 255, 255];

const PAGE_W = 210;
const PAGE_H = 297;
const ML = 20;
const MR = 20;
const CW = PAGE_W - ML - MR;
const BOTTOM = 278; // batas isi; footer di bawahnya
const TOP_NEXT = 24; // awal isi halaman 2 dst. (di bawah header ringkas)

/** Font standar PDF hanya memuat set Windows-1252; karakter lain diganti padanannya. */
const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const MAP: Record<string, string> = { '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '−': '-', '‑': '-', ' ': ' ', ' ': ' ', '✓': 'v', '≈': '~', '²': '²', '³': '³' };
function clean(s: string): string {
  let out = '';
  for (const ch of String(s ?? '')) {
    if (ch === '\n' || (ch.charCodeAt(0) < 256 && ch.length === 1) || WIN.has(ch)) out += ch;
    else out += MAP[ch] ?? '?';
  }
  return out;
}

function toDataUrl(img: LogoImage): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < img.data.length; i += chunk) bin += String.fromCharCode(...img.data.subarray(i, i + chunk));
  return `data:image/png;base64,${btoa(bin)}`;
}

export async function buildQuotePdf(d: QuoteData, o: QuoteOpts, logo: LogoImage | null, signature: LogoImage | null = null): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const tx = quoteTexts(d);
  const L = quoteLabels(d.lang);
  const cols = quoteColumns(d, o);
  const tot = quoteTotals(d, o);
  const terms = quoteTerms(d, o);
  const items = d.items.filter((it) => it.uraian.trim());

  doc.setProperties({ title: clean(`${L.judulDoc} ${d.nomor}`), subject: clean(d.perihal), author: clean(d.signer.nama), creator: 'CRM TIRA' });

  const LH = 4.6; // tinggi baris teks 10pt
  let y = 0;

  const font = (size: number, style: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'normal', color: RGB = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const wrap = (text: string, w: number): string[] => doc.splitTextToSize(clean(text), w) as string[];
  const newPage = () => {
    doc.addPage();
    y = TOP_NEXT;
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };
  /** Paragraf terbungkus; justify untuk teks panjang. */
  const para = (text: string, opt: { size?: number; style?: 'normal' | 'bold' | 'italic'; color?: RGB; after?: number; justify?: boolean; x?: number; w?: number } = {}) => {
    const size = opt.size ?? 10;
    font(size, opt.style ?? 'normal', opt.color ?? INK);
    const x = opt.x ?? ML;
    const w = opt.w ?? CW;
    const lh = (size / 10) * LH;
    for (const block of clean(text).split('\n')) {
      const lines = wrap(block || ' ', w);
      lines.forEach((ln, i) => {
        ensure(lh);
        const last = i === lines.length - 1;
        doc.text(ln, x, y + lh * 0.75, opt.justify && !last ? { maxWidth: w, align: 'justify' } : undefined);
        y += lh;
      });
    }
    y += opt.after ?? 2;
  };

  // ------------------------------------------------------------------ kop (halaman 1)
  if (o.kop) {
    const top = 13;
    let textX = ML;
    let logoBottom = top;
    if (logo) {
      const h = 15;
      const w = (h * logo.width) / Math.max(1, logo.height);
      doc.addImage(toDataUrl(logo), 'PNG', ML, top, w, h);
      textX = ML + w + 4;
      logoBottom = top + h;
    }
    font(16, 'bold', INK);
    doc.text(tx.company, textX, top + 6);
    font(8.5, 'bold', STEEL);
    doc.setCharSpace(0.6);
    doc.text(tx.division, textX, top + 10.5);
    doc.setCharSpace(0);
    let ty = top + 10.5;
    if (d.kopText.trim()) {
      font(7.5, 'normal', SOFT);
      for (const ln of clean(d.kopText.trim()).split('\n')) {
        ty += 3.4;
        doc.text(wrap(ln, PAGE_W - MR - textX)[0] || '', textX, ty);
      }
    }
    const lineY = Math.max(logoBottom, ty) + 3;
    doc.setDrawColor(...AMBER);
    doc.setLineWidth(0.8);
    doc.line(ML, lineY, PAGE_W - MR, lineY);
    y = lineY + 7;
  } else {
    y = 20;
  }

  // ------------------------------------------------------------------ nomor / perihal / tanggal
  const meta: [string, string, boolean][] = [[L.nomor, d.nomor, false], ...(o.lampiran ? ([[L.lampiran, d.lampiran || '-', false]] as [string, string, boolean][]) : []), [L.perihal, d.perihal, true]];
  font(10, 'normal', INK);
  doc.text(clean(tx.tempatTanggal), PAGE_W - MR, y + LH * 0.75, { align: 'right' });
  const labelW = 24;
  for (const [k, v, b] of meta) {
    font(10, 'normal', INK);
    doc.text(clean(k), ML, y + LH * 0.75);
    font(10, b ? 'bold' : 'normal', INK);
    const lines = wrap(`: ${v}`, 108);
    lines.forEach((ln, i) => {
      doc.text(ln, ML + labelW, y + LH * 0.75);
      if (i < lines.length - 1) y += LH;
    });
    y += LH + 0.6;
  }
  y += 4;

  // ------------------------------------------------------------------ tujuan
  para(L.kepada, { after: 0 });
  para(d.kepada, { style: 'bold', after: 0 });
  if (o.alamat && d.alamat.trim()) para(d.alamat.trim(), { after: 0 });
  if (o.pic && d.pic.trim()) para(`${L.up} ${d.pic.trim()}`, { after: 0 });
  y += 4;
  para(tx.pembuka, { after: 2 });
  para(tx.intro, { justify: true, after: 3 });

  // ------------------------------------------------------------------ tabel material
  const PAD = 1.6;
  const cellLH = 3.9;
  const wsum = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => (CW * c.w) / wsum);
  // Angka (harga, berat, qty) tidak boleh terpotong ke baris baru: kolom
  // selain uraian / grade minimal selebar isi terpanjangnya; kelebihannya
  // diambil dari kolom uraian.
  {
    const textW = (t: string, size: number, bold: boolean) => {
      font(size, bold ? 'bold' : 'normal', INK);
      return doc.getTextWidth(clean(t));
    };
    const iU = cols.findIndex((c) => c.key === 'uraian');
    let need = 0;
    cols.forEach((c, i) => {
      if (c.key === 'uraian' || c.key === 'grade') return;
      const cells = items.map((it, r) => c.cell(it, r));
      if (i === cols.length - 1) tot.rows.forEach((t) => cells.push(t.value));
      const head = Math.max(...String(c.label).split(/\s+/).map((w) => textW(w, 8.5, true)));
      const min = Math.max(head, ...cells.map((t) => textW(t, 9, i === cols.length - 1))) + PAD * 2 + 0.6;
      if (min > widths[i]) {
        need += min - widths[i];
        widths[i] = min;
      }
    });
    if (need > 0 && iU >= 0) widths[iU] = Math.max(28, widths[iU] - need);
    const scale = CW / widths.reduce((a, b) => a + b, 0);
    if (scale < 1) widths.forEach((_, i) => (widths[i] *= scale));
  }
  const xs = widths.reduce<number[]>((a, w, i) => [...a, i === 0 ? ML : a[i - 1] + widths[i - 1]], []);

  const drawRow = (cells: string[], opt: { head?: boolean; fill?: RGB; bold?: boolean; aligns: ('left' | 'center' | 'right')[]; spans?: number[] }) => {
    const size = opt.head ? 8.5 : 9;
    font(size, opt.head || opt.bold ? 'bold' : 'normal', opt.head ? WHITE : INK);
    // Lebar tiap sel (mempertimbangkan colspan).
    const spans = opt.spans ?? cells.map(() => 1);
    let ci = 0;
    const geo = cells.map((_, i) => {
      const w = widths.slice(ci, ci + spans[i]).reduce((s, v) => s + v, 0);
      const g = { x: xs[ci], w };
      ci += spans[i];
      return g;
    });
    const wrapped = cells.map((c, i) => wrap(c, geo[i].w - PAD * 2));
    const h = Math.max(...wrapped.map((l) => l.length)) * cellLH + PAD * 2;
    if (y + h > BOTTOM) return { h, fits: false };
    if (opt.head || opt.fill) {
      doc.setFillColor(...(opt.head ? INK : opt.fill!));
      doc.rect(ML, y, CW, h, 'F');
    }
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.2);
    wrapped.forEach((lines, i) => {
      const { x, w } = geo[i];
      doc.rect(x, y, w, h);
      const a = opt.head ? 'center' : opt.aligns[i];
      const tx0 = a === 'center' ? x + w / 2 : a === 'right' ? x + w - PAD : x + PAD;
      const top = y + (h - lines.length * cellLH) / 2 + cellLH * 0.78;
      lines.forEach((ln, j) => doc.text(ln, tx0, top + j * cellLH, { align: a }));
    });
    y += h;
    return { h, fits: true };
  };
  const header = () => drawRow(cols.map((c) => c.label), { head: true, aligns: cols.map(() => 'center') });

  ensure(20);
  header();
  items.forEach((it, r) => {
    const cells = cols.map((c) => c.cell(it, r));
    const opt = { aligns: cols.map((c) => c.align), fill: r % 2 === 1 ? ZEBRA : undefined };
    if (!drawRow(cells, opt).fits) {
      newPage();
      header();
      drawRow(cells, opt);
    }
  });
  for (const t of tot.rows) {
    const opt = { aligns: ['right', 'right'] as ('left' | 'center' | 'right')[], spans: [cols.length - 1, 1], bold: t.bold, fill: t.bold ? GRAND : undefined };
    if (!drawRow([t.label, t.value], opt).fits) {
      newPage();
      drawRow([t.label, t.value], opt);
    }
  }
  y += 2;
  if (o.terbilang) {
    ensure(LH * 2);
    font(9.5, 'normal', SOFT);
    const lbl = `${L.terbilang}: `;
    const lw = doc.getTextWidth(lbl);
    doc.text(lbl, ML, y + LH * 0.75);
    font(9.5, 'italic', INK);
    const lines = wrap(terbilang(tot.grand, d.lang), CW - lw);
    lines.forEach((ln, i) => {
      ensure(LH);
      doc.text(ln, ML + lw, y + LH * 0.75);
      if (i < lines.length - 1) y += LH;
    });
    y += LH;
  }
  y += 4;

  // ------------------------------------------------------------------ syarat & ketentuan
  ensure(LH * 3);
  para(L.syarat, { style: 'bold', after: 1 });
  const termKW = 36;
  for (const [k, v] of terms) {
    font(10, 'normal', INK);
    const lines = wrap(`: ${v}`, CW - termKW);
    ensure(LH * lines.length);
    doc.text(clean(k), ML, y + LH * 0.75);
    lines.forEach((ln, i) => doc.text(ln, ML + termKW, y + LH * 0.75 + i * LH));
    y += LH * lines.length + 0.6;
  }
  if (o.catatan && d.catatan.trim()) {
    y += 3;
    ensure(LH * 3);
    para(L.catatan, { style: 'bold', after: 1 });
    para(d.catatan.trim(), { justify: true });
  }

  // ------------------------------------------------------------------ penutup & tanda tangan
  y += 3;
  para(tx.penutup, { justify: true, after: 4 });
  const sig = o.ttdGambar ? signature : null;
  const sigH = sig ? 17 : o.ttd ? 20 : 4;
  ensure(LH * 2 + sigH + LH * 4);
  para(L.hormat, { after: 0 });
  para(tx.company, { after: 1 });
  if (sig) {
    let h = 16;
    let w = (h * sig.width) / Math.max(1, sig.height);
    if (w > 55) {
      w = 55;
      h = (w * sig.height) / Math.max(1, sig.width);
    }
    doc.addImage(toDataUrl(sig), 'PNG', ML, y, w, h);
    y += h + 1;
  } else {
    y += sigH;
  }
  font(10, 'bold', INK);
  const nama = clean(d.signer.nama);
  doc.text(nama, ML, y + LH * 0.75);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.25);
  doc.line(ML, y + LH * 0.75 + 0.8, ML + doc.getTextWidth(nama), y + LH * 0.75 + 0.8);
  y += LH;
  if (d.signer.jabatan.trim()) para(d.signer.jabatan.trim(), { after: 0 });
  if (o.kontak) {
    if (d.signer.telp.trim()) para(`${L.telp}: ${d.signer.telp.trim()}`, { size: 8.5, color: SOFT, after: 0 });
    if (d.signer.email.trim()) para(`${L.email}: ${d.signer.email.trim()}`, { size: 8.5, color: SOFT, after: 0 });
  }

  // ------------------------------------------------------------------ header ringkas & footer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (p > 1 || !o.kop) {
      if (p > 1) {
        font(9, 'bold', INK);
        doc.text(tx.company, ML, 13);
        const cw = doc.getTextWidth(tx.company);
        font(8, 'normal', STEEL);
        doc.text(`  ·  ${tx.division}`, ML + cw, 13);
        font(8, 'normal', SOFT);
        doc.text(clean(`${L.headerDoc} ${d.nomor}`), PAGE_W - MR, 13, { align: 'right' });
        doc.setDrawColor(...AMBER);
        doc.setLineWidth(0.4);
        doc.line(ML, 15.5, PAGE_W - MR, 15.5);
      }
    }
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.2);
    doc.line(ML, PAGE_H - 13, PAGE_W - MR, PAGE_H - 13);
    font(7.5, 'normal', SOFT);
    doc.text(clean(`${tx.company} · ${tx.division}`), ML, PAGE_H - 9);
    doc.text(clean(`${d.nomor}  ·  ${L.halaman} ${p} ${L.dari} ${pages}`), PAGE_W - MR, PAGE_H - 9, { align: 'right' });
  }

  return doc.output('blob');
}
