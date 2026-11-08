/**
 * PDF modul Purchasing (dibuat di browser dengan jsPDF, A4 landscape):
 *  - rfqPdf: satu dokumen RFQ — identitas, alur & waktu respons (siapa yang
 *    membuka / menjawab), ringkasan, rincian material + jawaban Purchasing,
 *    catatan, dan permintaan harga ke vendor (hanya role yang boleh melihat
 *    vendor). HPP / margin hanya bila `showHpp` (data untuk role lain memang
 *    sudah dibuang server).
 *  - worklistPdf: laporan Permintaan Masuk sesuai filter — KPI per status,
 *    rekap per Line dan daftar dokumen.
 * Cetak = PDF yang sama dibuka di iframe lalu print, jadi hasil cetak dan
 * unduhan selalu identik.
 */
import type { jsPDF as JsPDF } from 'jspdf';
import { actualMargin, hasHpp, hppIdr } from './rfq-price';
import { WORKFLOW_META, rfqAsWorkflowDoc, workflowStage, type WorkflowStage } from './purchasing-workflow';
import { VR_CHANNEL_LABEL, VR_STATUS_META, type VendorRequest } from './vendor-request';
import type { Rfq, RfqItem } from './types';
import type { PrDoc } from './purchase-attachment';

type RGB = [number, number, number];
const NAVY: RGB = [27, 36, 48];
const AMBER: RGB = [196, 127, 44];
const STEEL: RGB = [69, 100, 132];
const MUTED: RGB = [91, 101, 115];
const LINE: RGB = [223, 229, 235];
const SOFT: RGB = [244, 246, 248];
const TEXT: RGB = [26, 34, 43];
const GREEN: RGB = [29, 110, 66];
const RUST: RGB = [160, 64, 40];
const STAGE_RGB: Record<string, RGB> = { slate: [100, 116, 139], steel: STEEL, amber: AMBER, green: GREEN, rust: RUST };

const W = 297;
const H = 210;
const M = 12;

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad = (n: number) => String(n).padStart(2, '0');
function fDate(v: string | null | undefined): string {
  if (!v) return '-';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${Number(s.slice(8))} ${BLN[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const j = new Date(d.getTime() + 7 * 3600000); // WIB
  return `${j.getUTCDate()} ${BLN[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
}
function fDateTime(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return fDate(v);
  const j = new Date(d.getTime() + 7 * 3600000);
  return `${j.getUTCDate()} ${BLN[j.getUTCMonth()]} ${j.getUTCFullYear()} ${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
}
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const idr = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const qty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
/** Selisih hari (desimal) antara dua waktu ISO. */
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < x) return null;
  return (y - x) / 86400000;
}
const fDays = (d: number | null) => (d == null ? '-' : d < 1 ? `${Math.max(1, Math.round(d * 24))} jam` : `${d.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`);

export function itemSize(it: Partial<RfqItem>): string {
  const parts = [it.dia && `Ø${it.dia}`, it.thick && `${it.thick}`, it.width && `${it.width}`, it.length && `${it.length}`].filter(Boolean);
  return parts.length ? parts.join(' x ') : '-';
}
const cleanText = (s: unknown) =>
  String(s ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '');

// ---------------------------------------------------------------------------
// Layout kecil di atas jsPDF.

class Pdf {
  doc: JsPDF;
  y = 0;
  constructor(doc: JsPDF, private title: string, private subtitle: string, private right: string) {
    this.doc = doc;
  }
  color(c: RGB) {
    this.doc.setTextColor(c[0], c[1], c[2]);
  }
  fill(c: RGB) {
    this.doc.setFillColor(c[0], c[1], c[2]);
  }
  draw(c: RGB) {
    this.doc.setDrawColor(c[0], c[1], c[2]);
  }
  font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', c: RGB = TEXT) {
    this.doc.setFont('helvetica', style).setFontSize(size);
    this.color(c);
  }
  text(t: string | string[], x: number, y: number, opts?: { align?: 'left' | 'right' | 'center' }) {
    this.doc.text(Array.isArray(t) ? t.map(cleanText) : cleanText(t), x, y, opts);
  }
  split(t: string, w: number): string[] {
    return this.doc.splitTextToSize(cleanText(t) || '-', w) as string[];
  }
  /** Kepala halaman: pita navy + garis amber. */
  header() {
    this.fill(NAVY);
    this.doc.rect(0, 0, W, 21, 'F');
    this.fill(AMBER);
    this.doc.rect(0, 21, W, 1.2, 'F');
    this.font(13, 'bold', [255, 255, 255]);
    this.text('PT. TIRA AUSTENITE, Tbk', M, 9.5);
    this.font(7.5, 'bold', [232, 178, 104]);
    this.text('STEEL DIVISION  ·  PURCHASING', M, 15);
    this.font(14, 'bold', [255, 255, 255]);
    this.text(this.title, W - M, 9.5, { align: 'right' });
    this.font(8.5, 'normal', [205, 213, 223]);
    this.text(this.subtitle, W - M, 15, { align: 'right' });
    this.y = 29;
  }
  newPage() {
    this.doc.addPage();
    this.header();
  }
  ensure(h: number) {
    if (this.y + h > H - 14) this.newPage();
  }
  section(t: string, note?: string) {
    this.y += 3.5;
    this.ensure(14);
    this.fill(AMBER);
    this.doc.rect(M, this.y - 3.6, 1.4, 4.6, 'F');
    this.font(10.5, 'bold', NAVY);
    this.text(t, M + 3.5, this.y);
    if (note) {
      const tw = this.doc.getTextWidth(cleanText(t));
      this.font(7.5, 'normal', MUTED);
      this.text(note, M + 6 + tw, this.y);
    }
    this.y += 4.5;
  }
  chip(t: string, x: number, y: number, c: RGB, align: 'left' | 'right' = 'left'): number {
    this.font(8, 'bold', [255, 255, 255]);
    const w = this.doc.getTextWidth(cleanText(t)) + 6;
    const x0 = align === 'right' ? x - w : x;
    this.fill(c);
    this.doc.roundedRect(x0, y - 4, w, 5.6, 2.6, 2.6, 'F');
    this.text(t, x0 + 3, y);
    return w;
  }
  /** Kotak label/nilai, `cols` kolom per baris. */
  infoGrid(cells: [string, string][], cols: number) {
    const cw = (W - 2 * M) / cols;
    const rows: [string, string][][] = [];
    for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols));
    rows.forEach((row) => {
      const lines = row.map(([, v]) => this.split(v, cw - 6).slice(0, 3));
      const h = 6.5 + Math.max(...lines.map((l) => l.length)) * 4.1;
      this.ensure(h + 1);
      this.fill(SOFT);
      this.draw(LINE);
      this.doc.setLineWidth(0.2);
      this.doc.rect(M, this.y, W - 2 * M, h, 'FD');
      row.forEach(([label], i) => {
        const x = M + i * cw + 3;
        if (i) this.doc.line(M + i * cw, this.y + 1.5, M + i * cw, this.y + h - 1.5);
        this.font(6.6, 'bold', MUTED);
        this.text(label.toUpperCase(), x, this.y + 4);
        this.font(9, 'bold', TEXT);
        this.text(lines[i], x, this.y + 8.4);
      });
      this.y += h + 1.5;
    });
    this.y += 2;
  }
  /** Ubin angka ringkas. */
  tiles(list: { label: string; value: string; foot?: string; c?: RGB }[]) {
    const gap = 3;
    const tw = (W - 2 * M - gap * (list.length - 1)) / list.length;
    const h = 17;
    this.ensure(h + 2);
    list.forEach((t, i) => {
      const x = M + i * (tw + gap);
      this.fill([255, 255, 255]);
      this.draw(LINE);
      this.doc.setLineWidth(0.25);
      this.doc.roundedRect(x, this.y, tw, h, 1.5, 1.5, 'FD');
      this.fill(t.c || STEEL);
      this.doc.rect(x, this.y + 1.5, 1.1, h - 3, 'F');
      this.font(6.5, 'bold', MUTED);
      this.text(t.label.toUpperCase(), x + 4, this.y + 4.6);
      this.font(13, 'bold', t.c || NAVY);
      this.text(t.value, x + 4, this.y + 11.2);
      if (t.foot) {
        this.font(6.8, 'normal', MUTED);
        this.text(this.split(t.foot, tw - 6)[0], x + 4, this.y + 15);
      }
    });
    this.y += h + 5;
  }
  /** Tabel dengan pembungkus teks, zebra, dan kepala tabel berulang tiap halaman. */
  table(cols: { h: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: { cells: string[]; color?: (RGB | null)[]; bold?: boolean[]; fill?: RGB }[], fs = 7.6) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const scale = (W - 2 * M) / total;
    const ws = cols.map((c) => c.w * scale);
    const lh = fs * 0.43;
    const head = () => {
      const hl = cols.map((c, i) => this.split(c.h, ws[i] - 3));
      const hh = Math.max(...hl.map((l) => l.length)) * lh + 3;
      this.fill(NAVY);
      this.doc.rect(M, this.y, W - 2 * M, hh, 'F');
      this.font(fs - 0.6, 'bold', [255, 255, 255]);
      let x = M;
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? x + ws[i] - 1.5 : c.align === 'center' ? x + ws[i] / 2 : x + 1.5;
        this.text(hl[i], tx, this.y + 2.6 + lh * 0.7, { align: c.align || 'left' });
        x += ws[i];
      });
      this.y += hh;
    };
    this.ensure(14);
    head();
    rows.forEach((r, ri) => {
      this.font(fs);
      const cl = r.cells.map((c, i) => this.split(c, ws[i] - 3));
      const h = Math.max(...cl.map((l) => l.length)) * lh + 2.6;
      if (this.y + h > H - 14) {
        this.newPage();
        head();
      }
      if (r.fill || ri % 2) {
        this.fill(r.fill || SOFT);
        this.doc.rect(M, this.y, W - 2 * M, h, 'F');
      }
      let x = M;
      cols.forEach((c, i) => {
        this.font(fs, r.bold?.[i] ? 'bold' : 'normal', r.color?.[i] || TEXT);
        const tx = c.align === 'right' ? x + ws[i] - 1.5 : c.align === 'center' ? x + ws[i] / 2 : x + 1.5;
        this.text(cl[i], tx, this.y + 1.3 + lh * 0.8, { align: c.align || 'left' });
        x += ws[i];
      });
      this.y += h;
      this.draw(LINE);
      this.doc.setLineWidth(0.15);
      this.doc.line(M, this.y, W - M, this.y);
    });
    this.y += 5;
  }
  /** Kotak teks bebas (catatan). */
  note(label: string, body: string, c: RGB = STEEL) {
    const lines = this.split(body, W - 2 * M - 8);
    const h = 7 + lines.length * 3.9;
    this.ensure(Math.min(h, 60) + 2);
    this.fill([255, 255, 255]);
    this.draw(LINE);
    this.doc.setLineWidth(0.25);
    this.doc.rect(M, this.y, W - 2 * M, h, 'FD');
    this.fill(c);
    this.doc.rect(M, this.y, 1.1, h, 'F');
    this.font(6.8, 'bold', c);
    this.text(label.toUpperCase(), M + 4, this.y + 4.2);
    this.font(8.4, 'normal', TEXT);
    this.text(lines, M + 4, this.y + 8.4);
    this.y += h + 3;
  }
  /** Kaki semua halaman. */
  footer(printedBy: string, extra: string) {
    const n = this.doc.getNumberOfPages();
    const now = fDateTime(new Date().toISOString());
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.draw(LINE);
      this.doc.setLineWidth(0.3);
      this.doc.line(M, H - 9, W - M, H - 9);
      this.font(6.8, 'normal', MUTED);
      this.text(`Dicetak oleh ${printedBy} · ${now} WIB · ${extra}`, M, H - 5.2);
      this.text(`Halaman ${i} / ${n}`, W - M, H - 5.2, { align: 'right' });
    }
  }
}

async function newDoc(): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf');
  return new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
}

// ---------------------------------------------------------------------------
// RFQ satu dokumen.

export interface RfqPdfInput {
  rfq: Rfq;
  vendorRequests?: VendorRequest[];
  printedBy: string;
  showHpp: boolean;
  showVendor: boolean;
  /** FUP A memakai bentuk data yang sama (noRfq/tglRfq/jawabanRfqAt diisi dari kolom FUP A). */
  jenis?: 'RFQ' | 'FUPA';
}

export async function rfqPdf({ rfq, vendorRequests = [], printedBy, showHpp, showVendor, jenis = 'RFQ' }: RfqPdfInput): Promise<JsPDF> {
  const doc = await newDoc();
  const J = jenis === 'FUPA' ? 'FUP A' : 'RFQ';
  const no = rfq.noRfq || '(tanpa nomor)';
  doc.setProperties({ title: `${J} ${no}`, subject: `${J} — Purchasing`, creator: 'CRM TIRA' });
  const p = new Pdf(doc, /^(rfq|fup)/i.test(no) ? no : `${J} ${no}`, `${rfq.cabang || '-'} · ${rfq.customer || '-'}`, '');
  p.header();

  const stage = workflowStage(jenis === 'FUPA' ? { ...rfqAsWorkflowDoc(rfq), jenis: 'FUPA', jawabanFupaDikirim: rfq.jawabanRfqDikirim } : rfqAsWorkflowDoc(rfq)) as WorkflowStage;
  const meta = WORKFLOW_META[stage];
  const items = (rfq.items || []) as (RfqItem & Record<string, unknown>)[];

  // Judul + status
  p.font(15, 'bold', NAVY);
  p.text(jenis === 'FUPA' ? 'FUP A' : 'Permintaan Harga (RFQ)', M, p.y + 2);
  p.chip(meta.label.replace(/^\d+\.\s*/, '').toUpperCase(), W - M, p.y + 2, STAGE_RGB[meta.color] || STEEL, 'right');
  p.y += 8;

  if (rfq.cancelledAt) p.note(`Dibatalkan ${fDateTime(rfq.cancelledAt)}${rfq.cancelledBy ? ` oleh ${rfq.cancelledBy}` : ''}`, rfq.cancelReason || '-', RUST);

  const lokal = Array.from(new Set(items.map((it) => (it.lokal || '').trim()).filter(Boolean)));
  p.infoGrid(
    [
      [`No. ${J}`, no],
      [`Tanggal ${J}`, fDate(rfq.tglRfq)],
      ['Cabang / Regional', `${rfq.cabang || '-'}${rfq.reg ? ` · Regional ${rfq.reg}` : ''}`],
      ['Diminta oleh (Sales)', rfq.requestedBy || '-'],
      ['Customer', rfq.customer || '-'],
      ['Status dokumen', `${rfq.status}${rfq.jawabanRfqDikirim ? ' · jawaban terkirim ke Sales' : ''}`],
      ['Sumber barang', lokal.length ? lokal.join(', ') : '-'],
      ['Terhubung ke prospek', rfq.prospectId ? 'Ya (pipeline)' : 'Belum'],
    ],
    4,
  );

  // Alur & waktu respons
  p.section('Alur dokumen & waktu respons', 'siapa dan kapan dokumen ini ditangani');
  const steps = [
    // Data impor bisa tercatat dibuat sesudah dikirim — pakai tanggal RFQ bila begitu.
    { label: 'Dibuat', at: rfq.sentToPurchasingAt && rfq.createdAt > rfq.sentToPurchasingAt ? rfq.tglRfq || rfq.sentToPurchasingAt : rfq.createdAt, who: rfq.requestedBy || '' },
    { label: 'Dikirim ke Purchasing', at: rfq.sentToPurchasingAt, who: '' },
    { label: 'Diterima (dibuka)', at: rfq.openedByPurchasingAt, who: rfq.openedByName || '' },
    { label: 'Dijawab', at: rfq.jawabanRfqAt, who: rfq.jawabanByName || '' },
    { label: 'Selesai', at: rfq.status === 'Selesai' ? rfq.updatedAt : null, who: '' },
  ];
  p.ensure(30);
  const x0 = M + 18;
  const x1 = W - M - 18;
  const step = (x1 - x0) / (steps.length - 1);
  const cy = p.y + 5;
  p.draw(LINE);
  doc.setLineWidth(0.8);
  doc.line(x0, cy, x1, cy);
  steps.forEach((s, i) => {
    const x = x0 + i * step;
    const done = !!s.at;
    if (done && i > 0 && steps[i - 1].at) {
      p.draw(GREEN);
      doc.setLineWidth(0.8);
      doc.line(x - step, cy, x, cy);
    }
    p.fill(done ? GREEN : [255, 255, 255]);
    p.draw(done ? GREEN : [170, 180, 192]);
    doc.setLineWidth(0.5);
    doc.circle(x, cy, 2.4, 'FD');
    p.font(8, 'bold', done ? TEXT : MUTED);
    p.text(s.label, x, cy + 7, { align: 'center' });
    p.font(7.2, 'normal', MUTED);
    p.text(s.at ? fDateTime(s.at) : '—', x, cy + 10.8, { align: 'center' });
    if (s.who) {
      p.font(7.4, 'bold', STEEL);
      p.text(s.who, x, cy + 14.4, { align: 'center' });
    }
    if (i > 0 && s.at && steps[i - 1].at) {
      const d = daysBetween(steps[i - 1].at, s.at);
      if (d != null) {
        p.font(6.8, 'italic', MUTED);
        p.text(`+${fDays(d)}`, x - step / 2, cy - 2.5, { align: 'center' });
      }
    }
  });
  p.y = cy + 20;

  // Ringkasan
  const priced = items.filter((it) => num(it.hargaPurchasing) > 0 && !it.noQuote);
  const nq = items.filter((it) => it.noQuote).length;
  const totPcs = items.reduce((s, it) => s + num(it.pcs), 0);
  const totKg = items.reduce((s, it) => s + num(it.berat), 0);
  const value = priced.reduce((s, it) => {
    if ((it.currency || 'IDR') !== 'IDR') return s;
    const u = String(it.uom || 'KG').toUpperCase();
    const q = u === 'KG' || u === 'MT' ? num(it.berat) * (u === 'MT' ? 0.001 : 1) : num(it.pcs);
    return s + num(it.hargaPurchasing) * q;
  }, 0);
  const respon = daysBetween(rfq.sentToPurchasingAt || rfq.createdAt, rfq.jawabanRfqAt);
  p.tiles([
    { label: 'Item material', value: String(items.length), foot: `${qty(totPcs)} pcs · ${qty(totKg)} kg` },
    { label: 'Sudah ada harga', value: `${priced.length} / ${items.length}`, foot: items.length ? `${Math.round((priced.length / items.length) * 100)}% item terjawab` : '', c: GREEN },
    { label: 'No Quote', value: String(nq), foot: nq ? 'tidak bisa diberi harga' : 'semua bisa diberi harga', c: nq ? RUST : MUTED },
    { label: 'Estimasi nilai jawaban', value: value ? idr(value) : '-', foot: 'harga jawaban x qty (IDR)', c: AMBER },
    { label: 'Waktu jawab', value: respon == null ? '-' : fDays(respon), foot: 'sejak dikirim ke Purchasing', c: STEEL },
  ]);

  // Rincian material
  p.section('Rincian material & jawaban Purchasing', showHpp ? 'termasuk HPP, margin & vendor (internal Purchasing)' : '');
  const cols: { h: string; w: number; align?: 'left' | 'right' | 'center' }[] = [
    { h: 'No', w: 7, align: 'center' },
    { h: 'Line', w: 9, align: 'center' },
    { h: 'Material', w: 44 },
    { h: 'Ukuran (mm)', w: 25 },
    { h: 'Pcs', w: 9, align: 'right' },
    { h: 'Berat (kg)', w: 15, align: 'right' },
    { h: 'Lokal / Import', w: 16 },
    { h: 'Dibutuhkan', w: 20 },
    { h: 'Harga jawaban', w: 25, align: 'right' },
    { h: 'COO', w: 18 },
    { h: 'Delivery', w: 18 },
    { h: 'Keterangan', w: 28 },
  ];
  if (showHpp) cols.push({ h: 'HPP (IDR)', w: 18, align: 'right' }, { h: 'Margin', w: 14, align: 'right' }, { h: 'Vendor', w: 24 });
  p.table(
    cols,
    items.map((it, i) => {
      const nqi = !!it.noQuote;
      const cur = it.currency && it.currency !== 'IDR' ? `${it.currency} ` : 'Rp ';
      const price = nqi ? 'NO QUOTE' : num(it.hargaPurchasing) > 0 ? `${cur}${Math.round(num(it.hargaPurchasing)).toLocaleString('id-ID')}${it.uom ? ` /${String(it.uom).toLowerCase()}` : ''}` : 'belum';
      const cells = [
        String(i + 1),
        it.line || '-',
        [it.grade && !String(it.material || '').toUpperCase().includes(String(it.grade).toUpperCase()) ? it.grade : '', it.material].filter(Boolean).join(' · ') || '-',
        itemSize(it),
        num(it.pcs) ? qty(num(it.pcs)) : '-',
        num(it.berat) ? qty(num(it.berat)) : '-',
        it.lokal || '-',
        it.estimasi ? fDate(it.estimasi) : '-',
        price,
        it.coo || '-',
        it.deliveryTime || '-',
        it.note || '-',
      ];
      const color: (RGB | null)[] = cells.map(() => null);
      color[8] = nqi ? RUST : num(it.hargaPurchasing) > 0 ? GREEN : MUTED;
      if (showHpp) {
        const m = actualMargin(it);
        cells.push(hasHpp(it) ? Math.round(hppIdr(it)).toLocaleString('id-ID') : '-', m == null ? '-' : `${m.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`, String(it.vendorNama || '-'));
        color.push(null, m != null && m < 10 ? RUST : null, null);
      }
      const bold = cells.map((_, k) => k === 8);
      return { cells, color, bold, fill: nqi ? [252, 238, 234] : undefined };
    }),
  );

  // Catatan
  if (rfq.catatan) p.note('Catatan dari Sales', rfq.catatan, STEEL);
  if (rfq.purchJawaban) p.note(`Jawaban Purchasing${rfq.jawabanByName ? ` · ${rfq.jawabanByName}` : ''}`, rfq.purchJawaban, GREEN);
  if (showHpp && rfq.purchNotes) p.note('Catatan internal Purchasing (tidak terlihat Sales)', rfq.purchNotes, AMBER);

  // Vendor
  if (showVendor && vendorRequests.length) {
    p.section('Permintaan harga ke vendor', `${vendorRequests.length} vendor · ${vendorRequests.filter((r) => r.status === 'dibalas').length} sudah membalas`);
    p.table(
      [
        { h: 'Vendor', w: 50 },
        { h: 'Saluran', w: 20 },
        { h: 'Diminta', w: 22 },
        { h: 'Tenggat', w: 22 },
        { h: 'Status', w: 22 },
        { h: 'Harga balasan per item', w: 95 },
        { h: 'Pengingat', w: 16, align: 'center' },
        { h: 'Bahasa', w: 14, align: 'center' },
      ],
      vendorRequests.map((r) => {
        const prices = (r.items || [])
          .filter((x) => x.harga || x.noQuote)
          .map((x) => `#${x.idx + 1} ${x.noQuote ? 'tidak ada' : `${x.currency || r.currency || 'IDR'} ${num(x.harga).toLocaleString('id-ID', { maximumFractionDigits: (x.currency || r.currency || 'IDR') === 'IDR' ? 0 : 2 })}`}${x.leadTime ? ` (${x.leadTime})` : ''}`)
          .join('; ');
        const late = r.status === 'menunggu' && r.tenggat && r.tenggat < new Date().toISOString().slice(0, 10);
        return {
          cells: [r.vendorNama, VR_CHANNEL_LABEL[r.channel || ''] || r.channel || '-', fDate(r.tglDiminta), `${fDate(r.tenggat)}${late ? ' (lewat)' : ''}`, VR_STATUS_META[r.status]?.label || r.status, prices || '-', r.reminders ? `${r.reminders}x` : '-', r.lang === 'en' ? 'EN' : 'ID'],
          color: [null, null, null, late ? RUST : null, r.status === 'dibalas' ? GREEN : r.status === 'noquote' ? MUTED : AMBER, null, null, null],
          bold: [true],
        };
      }),
    );
  }

  p.footer(printedBy, showHpp || showVendor ? 'Dokumen internal Purchasing — memuat data rahasia, jangan dikirim ke customer / vendor' : 'Dokumen internal — jangan dikirim ke customer / vendor');
  return doc;
}

// ---------------------------------------------------------------------------
// Laporan Permintaan Masuk.

export interface WorklistRow {
  jenis?: 'RFQ' | 'FUPA';
  noDoc: string;
  tglDoc: string;
  cabang: string;
  customer: string;
  requestedBy: string;
  items: Partial<RfqItem>[];
  stage: WorkflowStage;
  sentAt: string;
  openedAt: string | null;
  openedByName: string | null;
  answeredAt: string | null;
  jawabanByName: string | null;
}

export async function worklistPdf({ rows, filterLabel, printedBy }: { rows: WorklistRow[]; filterLabel: string; printedBy: string }): Promise<JsPDF> {
  const doc = await newDoc();
  doc.setProperties({ title: 'Laporan Permintaan Masuk', subject: 'Purchasing — RFQ & FUP A', creator: 'CRM TIRA' });
  const p = new Pdf(doc, 'Laporan Permintaan Masuk', filterLabel || 'Semua RFQ & FUP A', '');
  p.header();
  p.font(15, 'bold', NAVY);
  p.text('Permintaan Masuk Purchasing (RFQ & FUP A)', M, p.y + 2);
  p.font(8.5, 'normal', MUTED);
  p.text(`${rows.length} dokumen · ${filterLabel || 'tanpa filter'}`, W - M, p.y + 2, { align: 'right' });
  p.y += 9;

  const count = (st: WorkflowStage) => rows.filter((r) => r.stage === st).length;
  const resp = rows.map((r) => daysBetween(r.sentAt, r.answeredAt)).filter((d): d is number => d != null);
  const avg = resp.length ? resp.reduce((s, d) => s + d, 0) / resp.length : null;
  const waiting = rows.filter((r) => r.stage === 1 || r.stage === 2);
  const oldest = waiting.map((r) => daysBetween(r.sentAt, new Date().toISOString()) || 0).sort((a, b) => b - a)[0];
  p.tiles([
    { label: 'Total dokumen', value: String(rows.length), foot: `${rows.filter((r) => r.jenis !== 'FUPA').length} RFQ · ${rows.filter((r) => r.jenis === 'FUPA').length} FUP A · ${rows.reduce((s, r) => s + r.items.length, 0)} item` },
    { label: 'Baru', value: String(count(1)), foot: 'belum dibuka Purchasing', c: STAGE_RGB.slate },
    { label: 'Diterima', value: String(count(2)), foot: 'dibuka, belum dijawab', c: STEEL },
    { label: 'Dijawab', value: String(count(3)), foot: 'harga sudah diisi', c: AMBER },
    { label: 'Selesai', value: String(count(4)), foot: `No Quote ${count(5)} · Batal ${count(6)}`, c: GREEN },
    { label: 'Rata-rata waktu jawab', value: avg == null ? '-' : fDays(avg), foot: waiting.length ? `${waiting.length} menunggu · terlama ${fDays(oldest ?? null)}` : 'tidak ada yang menunggu', c: STEEL },
  ]);

  // Rekap per Line
  const lines = new Map<string, WorklistRow[]>();
  rows.forEach((r) => {
    const ls = Array.from(new Set(r.items.map((it) => String(it.line || '').trim() || '(tanpa Line)')));
    (ls.length ? ls : ['(tanpa Line)']).forEach((l) => lines.set(l, [...(lines.get(l) || []), r]));
  });
  if (lines.size > 1 || rows.length > 0) {
    p.section('Rekap per Line', 'dokumen berisi beberapa Line dihitung di tiap Line');
    p.table(
      [
        { h: 'Line', w: 22 },
        { h: 'Dokumen', w: 14, align: 'right' },
        { h: 'Baru', w: 14, align: 'right' },
        { h: 'Diterima', w: 14, align: 'right' },
        { h: 'Dijawab', w: 14, align: 'right' },
        { h: 'Selesai', w: 14, align: 'right' },
        { h: 'No Quote', w: 14, align: 'right' },
        { h: 'Dibatalkan', w: 14, align: 'right' },
        { h: 'Rata-rata waktu jawab', w: 24, align: 'right' },
        { h: 'Terjawab / selesai', w: 24, align: 'right' },
      ],
      [...lines.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([l, list]) => {
          const c = (st: WorkflowStage) => list.filter((r) => r.stage === st).length;
          const rs = list.map((r) => daysBetween(r.sentAt, r.answeredAt)).filter((d): d is number => d != null);
          const done = c(3) + c(4);
          return {
            cells: [/^\d+$/.test(l) ? `Line ${l}` : l, String(list.length), String(c(1)), String(c(2)), String(c(3)), String(c(4)), String(c(5)), String(c(6)), rs.length ? fDays(rs.reduce((s, d) => s + d, 0) / rs.length) : '-', `${Math.round((done / Math.max(1, list.length - c(6))) * 100)}%`],
            bold: [true],
          };
        }),
    );
  }

  // Daftar dokumen
  p.section('Daftar dokumen', 'urut terbaru · PIC Purchasing yang membuka & menjawab');
  p.table(
    [
      { h: 'Jenis', w: 11 },
      { h: 'No. dokumen', w: 24 },
      { h: 'Tanggal', w: 18 },
      { h: 'Cabang', w: 13 },
      { h: 'Customer', w: 40 },
      { h: 'Material', w: 45 },
      { h: 'Item', w: 9, align: 'center' },
      { h: 'Diminta oleh', w: 24 },
      { h: 'Status', w: 18 },
      { h: 'Dibuka oleh', w: 26 },
      { h: 'Dijawab oleh', w: 26 },
      { h: 'Waktu jawab', w: 16, align: 'right' },
    ],
    rows.map((r) => {
      const m = WORKFLOW_META[r.stage];
      const first = r.items[0];
      const mat = first ? `${[first.line && `L${first.line}`, first.material || first.grade].filter(Boolean).join(' ')}${r.items.length > 1 ? ` (+${r.items.length - 1})` : ''}` : '-';
      const d = daysBetween(r.sentAt, r.answeredAt);
      const waitD = r.stage <= 2 ? daysBetween(r.sentAt, new Date().toISOString()) : null;
      return {
        cells: [
          r.jenis === 'FUPA' ? 'FUP A' : 'RFQ',
          r.noDoc || '-',
          fDate(r.tglDoc),
          r.cabang || '-',
          r.customer || '-',
          mat,
          String(r.items.length),
          r.requestedBy || '-',
          m.label.replace(/^\d+\.\s*/, ''),
          r.openedByName ? `${r.openedByName}\n${fDateTime(r.openedAt)}` : r.openedAt ? fDateTime(r.openedAt) : '-',
          r.jawabanByName ? `${r.jawabanByName}\n${fDateTime(r.answeredAt)}` : r.answeredAt ? fDateTime(r.answeredAt) : '-',
          d != null ? fDays(d) : waitD != null ? `menunggu ${fDays(waitD)}` : '-',
        ],
        color: [r.jenis === 'FUPA' ? AMBER : STEEL, null, null, null, null, null, null, null, STAGE_RGB[m.color] || STEEL, null, null, waitD != null && waitD > 2 ? RUST : null],
        bold: [true, true, false, false, false, false, false, false, true],
      };
    }),
    7.2,
  );
  p.footer(printedBy, 'Dokumen internal Purchasing');
  return doc;
}

// ---------------------------------------------------------------------------
// Lampiran FUP A (dari satu prospek).

export async function purchaseRequestPdf(d: PrDoc, printedBy: string): Promise<JsPDF> {
  const doc = await newDoc();
  doc.setProperties({ title: `Lampiran FUP A - ${d.customer}`, subject: 'Lampiran FUP A', creator: 'CRM TIRA' });
  const p = new Pdf(doc, 'Lampiran FUP A', `${d.cabang} · ${d.customer}`, '');
  p.header();
  p.font(15, 'bold', NAVY);
  p.text('Lampiran FUP A', M, p.y + 2);
  p.chip(d.status.toUpperCase(), W - M, p.y + 2, d.noPo ? GREEN : STEEL, 'right');
  p.y += 8;

  p.infoGrid(
    [
      ['Customer', d.customer],
      ['Cabang / Regional', `${d.cabang}${d.reg ? ` · Regional ${d.reg}` : ''}`],
      ['Sales Engineer', d.sales || '-'],
      ['Status pipeline', d.status],
      ['No. PO customer', d.noPo || 'belum ada PO'],
      ['Tanggal PO', fDate(d.tglPO)],
      ['Target kirim ke customer', fDate(d.tglDelivery)],
      ['Tanggal penawaran', fDate(d.tglPenawaran)],
    ],
    4,
  );

  const kg = d.lines.reduce((s, l) => s + l.kg, 0);
  const nilai = d.lines.reduce((s, l) => s + l.nilai, 0);
  const hppTot = d.lines.reduce((s, l) => s + (l.rfq?.hppKg != null ? l.rfq.hppKg * l.kg : 0), 0);
  const nilaiWithHpp = d.lines.reduce((s, l) => s + (l.rfq?.hppKg != null ? l.nilai : 0), 0);
  const fromStock = d.lines.filter((l) => l.gudangKg > 0).length;
  const tiles: { label: string; value: string; foot?: string; c?: RGB }[] = [
    { label: 'Item barang', value: String(d.lines.length), foot: `${qty(d.lines.reduce((s, l) => s + (l.pcsPo ?? l.pcsOffer), 0))} pcs/unit` },
    { label: 'Total berat', value: `${qty(kg)} kg`, foot: d.noPo ? 'sesuai qty PO' : 'sesuai qty penawaran', c: STEEL },
    { label: 'Nilai jual ke customer', value: nilai ? idr(nilai) : '-', foot: 'harga/kg x berat', c: GREEN },
    { label: 'Ada di stok gudang', value: `${fromStock} / ${d.lines.length}`, foot: d.stockAsOf ? `item cocok · stok per ${fDate(d.stockAsOf)}` : 'data stok belum diunggah', c: fromStock ? AMBER : MUTED },
  ];
  if (d.showHpp) tiles.push({ label: 'Estimasi HPP (dari RFQ)', value: hppTot ? idr(hppTot) : '-', foot: hppTot && nilaiWithHpp ? `margin ±${(((nilaiWithHpp - hppTot) / nilaiWithHpp) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari harga jual` : 'belum ada HPP di jawaban RFQ', c: AMBER });
  p.tiles(tiles);

  p.section('Barang yang diajukan', d.noPo ? 'qty mengikuti PO customer' : 'qty mengikuti penawaran — belum ada PO');
  const cols: { h: string; w: number; align?: 'left' | 'right' | 'center' }[] = [
    { h: 'No', w: 7, align: 'center' },
    { h: 'Line', w: 9, align: 'center' },
    { h: 'Material / grade', w: 40 },
    { h: 'Ukuran (mm)', w: 24 },
    { h: 'Qty', w: 13, align: 'right' },
    { h: 'Berat (kg)', w: 15, align: 'right' },
    { h: 'Harga jual /kg', w: 18, align: 'right' },
    { h: 'Nilai jual', w: 22, align: 'right' },
    { h: 'Kondisi stok (Sales)', w: 22 },
    { h: 'Stok gudang (Sage)', w: 36 },
    { h: 'Jawaban RFQ', w: 26 },
    { h: 'COO / Delivery', w: 22 },
  ];
  if (d.showHpp) cols.push({ h: 'HPP /kg', w: 15, align: 'right' }, { h: 'Margin', w: 14, align: 'right' }, { h: 'Vendor', w: 22 });
  p.table(
    cols,
    d.lines.map((l) => {
      const q = l.pcsPo != null ? `${qty(l.pcsPo)} ${l.satuan}${l.pcsPo !== l.pcsOffer ? `\n(tawar ${qty(l.pcsOffer)})` : ''}` : `${qty(l.pcsOffer)} ${l.satuan}`;
      const cells = [
        String(l.no),
        l.line,
        l.uraian,
        l.ukuran,
        q,
        l.kg ? qty(l.kg) : '-',
        l.hargaKg ? Math.round(l.hargaKg).toLocaleString('id-ID') : '-',
        l.nilai ? Math.round(l.nilai).toLocaleString('id-ID') : '-',
        `${l.stok}${l.eta ? `\nTiba: ${l.eta}` : ''}`,
        l.gudang,
        l.rfq ? `${l.rfq.harga}\n${l.rfq.no}` : '-',
        l.rfq ? [l.rfq.coo, l.rfq.delivery].filter(Boolean).join(' · ') || '-' : '-',
      ];
      const color: (RGB | null)[] = cells.map(() => null);
      color[9] = l.gudangKg > 0 ? GREEN : MUTED;
      color[10] = l.rfq ? (l.rfq.noQuote ? RUST : l.rfq.harga.startsWith('belum') ? MUTED : GREEN) : MUTED;
      if (d.showHpp) {
        cells.push(l.rfq?.hppKg != null ? Math.round(l.rfq.hppKg).toLocaleString('id-ID') : '-', l.rfq?.margin != null ? `${l.rfq.margin.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '-', l.rfq?.vendor || '-');
        color.push(null, l.rfq?.margin != null && l.rfq.margin < 10 ? RUST : null, null);
      }
      return { cells, color, bold: [false, false, true, false, true, false, false, true] };
    }),
    7.3,
  );
  p.font(7, 'italic', MUTED);
  p.ensure(5);
  p.text('Stok gudang: item dengan grade & tebal/diameter sama (semua varian -D/-G) dari data stok yang diunggah Admin — cek subsystem sebelum memutuskan beli. Jawaban RFQ dicocokkan dari RFQ yang terhubung ke prospek ini.', M, p.y - 2);
  p.y += 2;

  if (d.rfqs.length) {
    p.section('RFQ terkait prospek ini', `${d.rfqs.length} dokumen`);
    p.table(
      [
        { h: 'No. RFQ', w: 30 },
        { h: 'Tanggal', w: 22 },
        { h: 'Status', w: 22 },
        { h: 'Item terjawab', w: 22, align: 'center' },
        { h: 'Dibuka oleh', w: 40 },
        { h: 'Dijawab oleh', w: 40 },
        { h: 'Dijawab pada', w: 30 },
      ],
      d.rfqs.map((r) => ({
        cells: [r.no, fDate(r.tgl), r.status, `${r.priced} / ${r.total}`, r.openedBy || '-', r.answeredBy || '-', fDateTime(r.answeredAt)],
        bold: [true],
        color: [null, null, null, r.priced < r.total ? AMBER : GREEN],
      })),
    );
  }

  const notes = [d.keterangan && `Keterangan prospek: ${d.keterangan}`, d.kondisiStock && `Kondisi stok (ringkas): ${d.kondisiStock}`, d.lead && `Sumber lead: ${d.lead}`, d.phone && `Kontak customer: ${d.phone}`].filter(Boolean) as string[];
  if (notes.length) p.note('Catatan', notes.join('\n'), STEEL);

  // Kolom persetujuan
  p.section('Persetujuan');
  const boxes = ['Diajukan oleh (Purchasing)', 'Diperiksa oleh (GM Operation)', 'Disetujui oleh (VP / Direksi)'];
  const bw = (W - 2 * M - 8) / boxes.length;
  const bh = 30;
  p.ensure(bh + 4);
  boxes.forEach((t, i) => {
    const x = M + i * (bw + 4);
    p.draw(LINE);
    doc.setLineWidth(0.3);
    doc.rect(x, p.y, bw, bh);
    p.font(7.5, 'bold', MUTED);
    p.text(t.toUpperCase(), x + 3, p.y + 4.5);
    p.draw([170, 180, 192]);
    doc.line(x + 3, p.y + bh - 9, x + bw - 3, p.y + bh - 9);
    p.font(7.3, 'normal', MUTED);
    p.text('Nama:', x + 3, p.y + bh - 5);
    p.text('Tanggal:', x + bw / 2, p.y + bh - 5);
  });
  p.y += bh + 3;

  p.footer(printedBy, d.showHpp ? 'Dokumen internal — memuat HPP & vendor, jangan dikirim ke customer / vendor' : 'Dokumen internal — jangan dikirim ke customer / vendor');
  return doc;
}

// ---------------------------------------------------------------------------

export function pdfDownload(doc: JsPDF, fileName: string) {
  doc.save(fileName.replace(/[^\w.-]+/g, '_'));
}

/** Cetak: buka PDF di iframe tersembunyi lalu panggil dialog print browser. */
export function pdfPrint(doc: JsPDF) {
  const url = URL.createObjectURL(doc.output('blob'));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  };
  document.body.appendChild(frame);
}
