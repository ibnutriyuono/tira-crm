/**
 * Surat Penawaran — satu model untuk pratinjau (HTML) dan file Word (.docx,
 * lib/quotation-docx.ts), supaya yang terlihat di layar = isi file.
 * Murni (tanpa import server / browser API) agar mudah dipakai di klien.
 */
import { num } from './format';

export interface QuoteItem {
  line: string;
  uraian: string;
  grade: string;
  satuan: string;
  qty: number;
  /** Kg per pcs; 0 = tidak dihitung per kg. */
  beratPc: number;
  /** Rp per kg; 0 = harga flat. */
  hargaKg: number;
  /** Harga satuan (per pcs / unit). */
  harga: number;
}

export interface QuoteSigner {
  nama: string;
  jabatan: string;
  telp: string;
  email: string;
}

export type QuoteLang = 'id' | 'en';

export interface QuoteData {
  /** Bahasa surat: Indonesia (bawaan) atau Inggris. */
  lang?: QuoteLang;
  nomor: string;
  tanggal: string;
  kota: string;
  lampiran: string;
  perihal: string;
  kepada: string;
  pic: string;
  alamat: string;
  items: QuoteItem[];
  /** true = harga yang diisi sudah termasuk PPN. */
  ppnInclude: boolean;
  pembayaran: string;
  pengiriman: string;
  berlaku: string;
  kondisiStock: string;
  catatan: string;
  signer: QuoteSigner;
  /** Alamat / telepon kantor di bawah nama perusahaan pada kop. */
  kopText: string;
}

export type QuoteOptKey =
  | 'kop' | 'lampiran' | 'pic' | 'alamat'
  | 'colLine' | 'colGrade' | 'colSatuan' | 'colBerat' | 'colTotalBerat' | 'colHargaKg' | 'colHarga'
  | 'ppnRinci' | 'terbilang'
  | 'pembayaran' | 'pengiriman' | 'berlaku' | 'kondisiStock' | 'catatan' | 'kontak' | 'ttd' | 'ttdGambar';

export type QuoteOpts = Record<QuoteOptKey, boolean>;

export const QUOTE_OPT_GROUPS: { title: string; opts: { key: QuoteOptKey; label: string; def: boolean; hint?: string }[] }[] = [
  {
    title: 'Kepala surat',
    opts: [
      { key: 'kop', label: 'Logo & kop perusahaan', def: true },
      { key: 'lampiran', label: 'Baris Lampiran', def: false },
      { key: 'pic', label: 'PIC / Up.', def: true },
      { key: 'alamat', label: 'Alamat customer', def: true },
    ],
  },
  {
    title: 'Kolom tabel material',
    opts: [
      { key: 'colLine', label: 'Line', def: false },
      { key: 'colGrade', label: 'Grade', def: false, hint: 'grade sudah ada di uraian' },
      { key: 'colSatuan', label: 'Satuan', def: true },
      { key: 'colBerat', label: 'Berat / pcs (kg)', def: true, hint: 'hanya bila ada' },
      { key: 'colTotalBerat', label: 'Total berat (kg)', def: false, hint: 'hanya bila ada' },
      { key: 'colHargaKg', label: 'Harga / kg', def: true, hint: 'hanya bila ada' },
      { key: 'colHarga', label: 'Harga satuan', def: true },
    ],
  },
  {
    title: 'Harga',
    opts: [
      { key: 'ppnRinci', label: 'Rincian Subtotal + PPN 11%', def: true },
      { key: 'terbilang', label: 'Terbilang', def: true },
    ],
  },
  {
    title: 'Syarat & penutup',
    opts: [
      { key: 'pembayaran', label: 'Syarat pembayaran', def: true },
      { key: 'pengiriman', label: 'Syarat pengiriman', def: true },
      { key: 'berlaku', label: 'Masa berlaku', def: true },
      { key: 'kondisiStock', label: 'Kondisi stock', def: false },
      { key: 'catatan', label: 'Catatan tambahan', def: true },
      { key: 'kontak', label: 'Telepon & email penanda tangan', def: true },
      { key: 'ttdGambar', label: 'Tanda tangan saya (dari Akun Saya)', def: true, hint: 'dipasang otomatis bila sudah diisi' },
      { key: 'ttd', label: 'Ruang tanda tangan basah', def: true, hint: 'bila tanpa tanda tangan gambar' },
    ],
  },
];

export function defaultQuoteOpts(): QuoteOpts {
  const o = {} as QuoteOpts;
  QUOTE_OPT_GROUPS.forEach((g) => g.opts.forEach((x) => (o[x.key] = x.def)));
  return o;
}

export function normalizeQuoteOpts(raw: unknown): QuoteOpts {
  const o = defaultQuoteOpts();
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(o) as QuoteOptKey[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') o[k] = v;
    }
  }
  return o;
}


/** Teks tetap surat per bahasa. */
const QL = {
  id: {
    nomor: 'Nomor', lampiran: 'Lampiran', perihal: 'Perihal', kepada: 'Kepada Yth.', up: 'Up.',
    pembuka: 'Dengan hormat,',
    intro: 'Menindaklanjuti permintaan Bapak/Ibu, bersama ini kami sampaikan penawaran harga dengan rincian sebagai berikut:',
    penutup: (to: string) => `Demikian penawaran ini kami sampaikan. Besar harapan kami dapat bekerja sama dengan ${to || 'Bapak/Ibu'}. Atas perhatian dan kepercayaan Bapak/Ibu, kami ucapkan terima kasih.`,
    hormat: 'Hormat kami,', telp: 'Telp/WA', email: 'Email',
    colNo: 'No', colLine: 'Line', colUraian: 'Uraian Material', colGrade: 'Grade', colQty: 'Qty', colSatuan: 'Satuan',
    colBerat: 'Berat/pcs (kg)', colTBerat: 'Total Berat (kg)', colHargaKg: 'Harga/kg', colHarga: 'Harga Satuan', colJumlah: 'Jumlah',
    dpp: 'Dasar Pengenaan Pajak (DPP)', ppn: 'PPN 11%', totalIncl: 'Total (termasuk PPN 11%)', totalExcl: 'Total (belum termasuk PPN 11%)', subtotal: 'Subtotal', total: 'Total',
    terbilang: 'Terbilang', syarat: 'Syarat & Ketentuan', catatan: 'Catatan',
    pembayaran: 'Pembayaran', pengiriman: 'Pengiriman', kondisiStock: 'Kondisi Stock', berlaku: 'Masa Berlaku', harga: 'Harga',
    hargaIncl: 'Sudah termasuk PPN 11%', hargaExcl: 'Belum termasuk PPN 11%',
    headerDoc: 'Surat Penawaran No.', halaman: 'Halaman', dari: 'dari', judulDoc: 'Surat Penawaran',
  },
  en: {
    nomor: 'Ref. No.', lampiran: 'Attachment', perihal: 'Subject', kepada: 'To:', up: 'Attn.',
    pembuka: 'Dear Sir/Madam,',
    intro: 'Following up on your inquiry, we are pleased to submit our price quotation as follows:',
    penutup: (to: string) => `We hope this quotation meets your requirements and look forward to working with ${to || 'you'}. Thank you for your attention and trust.`,
    hormat: 'Sincerely,', telp: 'Phone/WA', email: 'Email',
    colNo: 'No', colLine: 'Line', colUraian: 'Description', colGrade: 'Grade', colQty: 'Qty', colSatuan: 'Unit',
    colBerat: 'Weight/pcs (kg)', colTBerat: 'Total Weight (kg)', colHargaKg: 'Price/kg', colHarga: 'Unit Price', colJumlah: 'Amount',
    dpp: 'Tax Base (DPP)', ppn: 'VAT 11%', totalIncl: 'Total (incl. VAT 11%)', totalExcl: 'Total (excl. VAT 11%)', subtotal: 'Subtotal', total: 'Total',
    terbilang: 'In words', syarat: 'Terms & Conditions', catatan: 'Notes',
    pembayaran: 'Payment', pengiriman: 'Delivery', kondisiStock: 'Stock Condition', berlaku: 'Validity', harga: 'Price',
    hargaIncl: 'Including VAT 11%', hargaExcl: 'Excluding VAT 11%',
    headerDoc: 'Quotation No.', halaman: 'Page', dari: 'of', judulDoc: 'Quotation',
  },
};
export type QuoteLabels = (typeof QL)['id'];
export const quoteLabels = (lang?: QuoteLang): QuoteLabels => QL[lang === 'en' ? 'en' : 'id'];

/** Isian bawaan per bahasa (perihal, syarat). */
export const QUOTE_DEFAULTS: Record<QuoteLang, { perihal: string; pembayaran: string; pengiriman: string; berlaku: string }> = {
  id: { perihal: 'Penawaran Harga', pembayaran: '30 hari setelah invoice diterima', pengiriman: '2-4 minggu setelah PO diterima / sesuai kondisi stock', berlaku: '14 hari kerja sejak tanggal penawaran' },
  en: { perihal: 'Price Quotation', pembayaran: '30 days after receipt of invoice', pengiriman: '2-4 weeks after receipt of PO / subject to stock availability', berlaku: '14 working days from the quotation date' },
};

export const PPN_RATE = 0.11;

export const unitPrice = (it: QuoteItem) => (it.beratPc > 0 && it.hargaKg > 0 ? it.beratPc * it.hargaKg : num(it.harga));
export const lineTotal = (it: QuoteItem) => num(it.qty) * unitPrice(it);

/** Spasi tak terputus setelah "Rp" supaya angka tidak terpecah ke baris baru. */
export const rupiah = (n: number) => 'Rp\u00A0' + Math.round(num(n)).toLocaleString('id-ID');
export const kg = (n: number) => num(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const qtyFmt = (n: number) => num(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });

export interface QuoteCol {
  key: string;
  label: string;
  /** Lebar relatif (dipakai .docx dan HTML). */
  w: number;
  align: 'left' | 'center' | 'right';
  cell: (it: QuoteItem, i: number) => string;
}

/** Kolom tabel sesuai opsi; berat & harga/kg hanya muncul bila ada material yang dihitung per kg. */
export function quoteColumns(d: QuoteData, o: QuoteOpts): QuoteCol[] {
  const perKg = d.items.some((it) => it.beratPc > 0 && it.hargaKg > 0);
  const L = quoteLabels(d.lang);
  const cols: QuoteCol[] = [{ key: 'no', label: L.colNo, w: 5, align: 'center', cell: (_it, i) => String(i + 1) }];
  if (o.colLine) cols.push({ key: 'line', label: L.colLine, w: 6, align: 'center', cell: (it) => it.line || '-' });
  cols.push({ key: 'uraian', label: L.colUraian, w: 30, align: 'left', cell: (it) => it.uraian });
  if (o.colGrade) cols.push({ key: 'grade', label: L.colGrade, w: 12, align: 'left', cell: (it) => it.grade || '-' });
  cols.push({ key: 'qty', label: L.colQty, w: 6, align: 'center', cell: (it) => qtyFmt(it.qty) });
  if (o.colSatuan) cols.push({ key: 'satuan', label: L.colSatuan, w: 8, align: 'center', cell: (it) => it.satuan || 'pcs' });
  if (o.colBerat && perKg) cols.push({ key: 'berat', label: L.colBerat, w: 10, align: 'right', cell: (it) => (it.beratPc > 0 ? kg(it.beratPc) : '-') });
  if (o.colTotalBerat && perKg) cols.push({ key: 'tberat', label: L.colTBerat, w: 10, align: 'right', cell: (it) => (it.beratPc > 0 ? kg(it.beratPc * it.qty) : '-') });
  if (o.colHargaKg && perKg) cols.push({ key: 'hkg', label: L.colHargaKg, w: 11, align: 'right', cell: (it) => (it.hargaKg > 0 && it.beratPc > 0 ? rupiah(it.hargaKg) : '-') });
  if (o.colHarga) cols.push({ key: 'harga', label: L.colHarga, w: 15, align: 'right', cell: (it) => rupiah(unitPrice(it)) });
  cols.push({ key: 'jumlah', label: L.colJumlah, w: 17, align: 'right', cell: (it) => rupiah(lineTotal(it)) });
  return cols;
}

export interface QuoteTotals {
  rows: { label: string; value: string; bold?: boolean }[];
  grand: number;
}

export function quoteTotals(d: QuoteData, o: QuoteOpts): QuoteTotals {
  const sum = d.items.reduce((s, it) => s + lineTotal(it), 0);
  const L = quoteLabels(d.lang);
  if (d.ppnInclude) {
    const dpp = Math.round(sum / (1 + PPN_RATE));
    const rows = o.ppnRinci
      ? [
          { label: L.dpp, value: rupiah(dpp) },
          { label: L.ppn, value: rupiah(sum - dpp) },
          { label: L.totalIncl, value: rupiah(sum), bold: true },
        ]
      : [{ label: L.totalIncl, value: rupiah(sum), bold: true }];
    return { rows, grand: sum };
  }
  const ppn = Math.round(sum * PPN_RATE);
  if (!o.ppnRinci) return { rows: [{ label: L.totalExcl, value: rupiah(sum), bold: true }], grand: sum };
  return {
    rows: [
      { label: L.subtotal, value: rupiah(sum) },
      { label: L.ppn, value: rupiah(ppn) },
      { label: L.total, value: rupiah(sum + ppn), bold: true },
    ],
    grand: sum + ppn,
  };
}

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function words(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${words(n - 10)} belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} puluh ${words(n % 10)}`;
  if (n < 200) return `seratus ${words(n - 100)}`;
  if (n < 1000) return `${words(Math.floor(n / 100))} ratus ${words(n % 100)}`;
  if (n < 2000) return `seribu ${words(n - 1000)}`;
  if (n < 1e6) return `${words(Math.floor(n / 1000))} ribu ${words(n % 1000)}`;
  if (n < 1e9) return `${words(Math.floor(n / 1e6))} juta ${words(n % 1e6)}`;
  if (n < 1e12) return `${words(Math.floor(n / 1e9))} miliar ${words(n % 1e9)}`;
  return `${words(Math.floor(n / 1e12))} triliun ${words(n % 1e12)}`;
}

/** 23429952 -> "Dua puluh tiga juta empat ratus dua puluh sembilan ribu sembilan ratus lima puluh dua rupiah" */
const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function wordsEn(n: number): string {
  if (n < 20) return EN_ONES[n];
  if (n < 100) return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${EN_ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${wordsEn(n % 100)}` : ''}`;
  const scales: [number, string][] = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  for (const [v, w] of scales) if (n >= v) return `${wordsEn(Math.floor(n / v))} ${w}${n % v ? ` ${wordsEn(n % v)}` : ''}`;
  return '';
}

/** 23429952 -> "Twenty-three million four hundred twenty-nine thousand nine hundred fifty-two rupiah" */
export function terbilangEn(n: number): string {
  const v = Math.round(Math.abs(num(n)));
  const s = v === 0 ? 'zero' : wordsEn(v);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} rupiah`;
}

export function terbilang(n: number, lang?: QuoteLang): string {
  if (lang === 'en') return terbilangEn(n);
  const v = Math.round(Math.abs(num(n)));
  const s = v === 0 ? 'nol' : words(v).replace(/\s+/g, ' ').trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} rupiah`;
}

export function formatTanggalSurat(iso: string, lang?: QuoteLang): string {
  const bulan = lang === 'en' ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] : ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const d = new Date(`${iso}T00:00:00`);
  if (!iso || Number.isNaN(d.getTime())) return iso || '';
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

/** Teks tetap surat (dipakai pratinjau & .docx). */
export function quoteTexts(d: QuoteData) {
  const L = quoteLabels(d.lang);
  return {
    company: 'PT. TIRA AUSTENITE, Tbk',
    division: 'STEEL DIVISION',
    tempatTanggal: [d.kota.trim(), formatTanggalSurat(d.tanggal, d.lang)].filter(Boolean).join(', '),
    pembuka: L.pembuka,
    intro: L.intro,
    penutup: L.penutup(d.kepada.trim()),
  };
}

/** Baris Syarat & Ketentuan yang tampil (label, isi). */
export function quoteTerms(d: QuoteData, o: QuoteOpts): [string, string][] {
  const L = quoteLabels(d.lang);
  const t: [string, string][] = [];
  if (o.pembayaran && d.pembayaran.trim()) t.push([L.pembayaran, d.pembayaran.trim()]);
  if (o.pengiriman && d.pengiriman.trim()) t.push([L.pengiriman, d.pengiriman.trim()]);
  if (o.kondisiStock && d.kondisiStock.trim()) t.push([L.kondisiStock, d.kondisiStock.trim()]);
  if (o.berlaku && d.berlaku.trim()) t.push([L.berlaku, d.berlaku.trim()]);
  t.push([L.harga, d.ppnInclude ? L.hargaIncl : L.hargaExcl]);
  return t;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const br = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Pratinjau surat (HTML) — tata letak sama dengan file .docx. */
export function quoteHtml(d: QuoteData, o: QuoteOpts, logoSrc: string, signatureSrc = ''): string {
  const tx = quoteTexts(d);
  const L = quoteLabels(d.lang);
  const cols = quoteColumns(d, o);
  const tot = quoteTotals(d, o);
  const wsum = cols.reduce((s, c) => s + c.w, 0);
  const items = d.items.filter((it) => it.uraian.trim());
  const terms = quoteTerms(d, o);
  const head = o.kop
    ? `<table class="qp-kop"><tr><td style="width:70px"><img src="${esc(logoSrc)}" alt=""></td><td><div class="qp-co">${tx.company}</div><div class="qp-div">${tx.division}</div>${d.kopText.trim() ? `<div class="qp-kt">${br(d.kopText.trim())}</div>` : ''}</td></tr></table>`
    : '';
  const meta = [
    [L.nomor, d.nomor],
    ...(o.lampiran ? [[L.lampiran, d.lampiran || '-']] : []),
    [L.perihal, d.perihal],
  ];
  return `<div class="qp">
  ${head}
  <table class="qp-meta"><tr><td>${meta.map(([k, v]) => `<div><span class="qp-k">${k}</span>: ${k === L.perihal ? `<b>${esc(v)}</b>` : esc(v)}</div>`).join('')}</td><td class="qp-date">${esc(tx.tempatTanggal)}</td></tr></table>
  <p>${L.kepada}<br><b>${esc(d.kepada)}</b>${o.alamat && d.alamat.trim() ? `<br>${br(d.alamat.trim())}` : ''}${o.pic && d.pic.trim() ? `<br>${L.up} ${esc(d.pic.trim())}` : ''}</p>
  <p>${tx.pembuka}</p>
  <p>${tx.intro}</p>
  <table class="qp-tbl"><thead><tr>${cols.map((c) => `<th style="width:${((c.w / wsum) * 100).toFixed(1)}%;text-align:${c.align}">${c.label}</th>`).join('')}</tr></thead>
  <tbody>${items.map((it, i) => `<tr>${cols.map((c) => `<td style="text-align:${c.align}">${esc(c.cell(it, i))}</td>`).join('')}</tr>`).join('')}
  ${tot.rows.map((r) => `<tr class="${r.bold ? 'qp-grand' : 'qp-sub'}"><td colspan="${cols.length - 1}" style="text-align:right">${esc(r.label)}</td><td style="text-align:right">${esc(r.value)}</td></tr>`).join('')}
  </tbody></table>
  ${o.terbilang ? `<p class="qp-terb">${L.terbilang}: <i>${esc(terbilang(tot.grand, d.lang))}</i></p>` : ''}
  <p class="qp-h">${esc(L.syarat)}</p>
  <table class="qp-terms">${terms.map(([k, v]) => `<tr><td class="qp-k">${k}</td><td>: ${esc(v)}</td></tr>`).join('')}</table>
  ${o.catatan && d.catatan.trim() ? `<p class="qp-h">${L.catatan}</p><p>${br(d.catatan.trim())}</p>` : ''}
  <p>${esc(tx.penutup)}</p>
  <p>${L.hormat}<br>${tx.company}</p>
  ${o.ttdGambar && signatureSrc ? `<div class="qp-sig"><img src="${esc(signatureSrc)}" alt=""></div>` : o.ttd ? '<div class="qp-ttd"></div>' : ''}
  <p><b><u>${esc(d.signer.nama)}</u></b>${d.signer.jabatan.trim() ? `<br>${esc(d.signer.jabatan.trim())}` : ''}${o.kontak ? [d.signer.telp.trim() && `${L.telp}: ${esc(d.signer.telp.trim())}`, d.signer.email.trim() && `${L.email}: ${esc(d.signer.email.trim())}`].filter(Boolean).map((x) => `<br><span class="qp-small">${x}</span>`).join('') : ''}</p>
</div>`;
}
