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

export interface QuoteData {
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
  const cols: QuoteCol[] = [{ key: 'no', label: 'No', w: 5, align: 'center', cell: (_it, i) => String(i + 1) }];
  if (o.colLine) cols.push({ key: 'line', label: 'Line', w: 6, align: 'center', cell: (it) => it.line || '-' });
  cols.push({ key: 'uraian', label: 'Uraian Material', w: 30, align: 'left', cell: (it) => it.uraian });
  if (o.colGrade) cols.push({ key: 'grade', label: 'Grade', w: 12, align: 'left', cell: (it) => it.grade || '-' });
  cols.push({ key: 'qty', label: 'Qty', w: 6, align: 'center', cell: (it) => qtyFmt(it.qty) });
  if (o.colSatuan) cols.push({ key: 'satuan', label: 'Satuan', w: 8, align: 'center', cell: (it) => it.satuan || 'pcs' });
  if (o.colBerat && perKg) cols.push({ key: 'berat', label: 'Berat/pcs (kg)', w: 10, align: 'right', cell: (it) => (it.beratPc > 0 ? kg(it.beratPc) : '-') });
  if (o.colTotalBerat && perKg) cols.push({ key: 'tberat', label: 'Total Berat (kg)', w: 10, align: 'right', cell: (it) => (it.beratPc > 0 ? kg(it.beratPc * it.qty) : '-') });
  if (o.colHargaKg && perKg) cols.push({ key: 'hkg', label: 'Harga/kg', w: 11, align: 'right', cell: (it) => (it.hargaKg > 0 && it.beratPc > 0 ? rupiah(it.hargaKg) : '-') });
  if (o.colHarga) cols.push({ key: 'harga', label: 'Harga Satuan', w: 15, align: 'right', cell: (it) => rupiah(unitPrice(it)) });
  cols.push({ key: 'jumlah', label: 'Jumlah', w: 17, align: 'right', cell: (it) => rupiah(lineTotal(it)) });
  return cols;
}

export interface QuoteTotals {
  rows: { label: string; value: string; bold?: boolean }[];
  grand: number;
}

export function quoteTotals(d: QuoteData, o: QuoteOpts): QuoteTotals {
  const sum = d.items.reduce((s, it) => s + lineTotal(it), 0);
  if (d.ppnInclude) {
    const dpp = Math.round(sum / (1 + PPN_RATE));
    const rows = o.ppnRinci
      ? [
          { label: 'Dasar Pengenaan Pajak (DPP)', value: rupiah(dpp) },
          { label: 'PPN 11%', value: rupiah(sum - dpp) },
          { label: 'Total (termasuk PPN 11%)', value: rupiah(sum), bold: true },
        ]
      : [{ label: 'Total (termasuk PPN 11%)', value: rupiah(sum), bold: true }];
    return { rows, grand: sum };
  }
  const ppn = Math.round(sum * PPN_RATE);
  if (!o.ppnRinci) return { rows: [{ label: 'Total (belum termasuk PPN 11%)', value: rupiah(sum), bold: true }], grand: sum };
  return {
    rows: [
      { label: 'Subtotal', value: rupiah(sum) },
      { label: 'PPN 11%', value: rupiah(ppn) },
      { label: 'Total', value: rupiah(sum + ppn), bold: true },
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
export function terbilang(n: number): string {
  const v = Math.round(Math.abs(num(n)));
  const s = v === 0 ? 'nol' : words(v).replace(/\s+/g, ' ').trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} rupiah`;
}

export function formatTanggalSurat(iso: string): string {
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const d = new Date(`${iso}T00:00:00`);
  if (!iso || Number.isNaN(d.getTime())) return iso || '';
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

/** Teks tetap surat (dipakai pratinjau & .docx). */
export function quoteTexts(d: QuoteData) {
  return {
    company: 'PT. TIRA AUSTENITE, Tbk',
    division: 'STEEL DIVISION',
    tempatTanggal: [d.kota.trim(), formatTanggalSurat(d.tanggal)].filter(Boolean).join(', '),
    pembuka: 'Dengan hormat,',
    intro: 'Menindaklanjuti permintaan Bapak/Ibu, bersama ini kami sampaikan penawaran harga dengan rincian sebagai berikut:',
    penutup: `Demikian penawaran ini kami sampaikan. Besar harapan kami dapat bekerja sama dengan ${d.kepada.trim() || 'Bapak/Ibu'}. Atas perhatian dan kepercayaan Bapak/Ibu, kami ucapkan terima kasih.`,
  };
}

/** Baris Syarat & Ketentuan yang tampil (label, isi). */
export function quoteTerms(d: QuoteData, o: QuoteOpts): [string, string][] {
  const t: [string, string][] = [];
  if (o.pembayaran && d.pembayaran.trim()) t.push(['Pembayaran', d.pembayaran.trim()]);
  if (o.pengiriman && d.pengiriman.trim()) t.push(['Pengiriman', d.pengiriman.trim()]);
  if (o.kondisiStock && d.kondisiStock.trim()) t.push(['Kondisi Stock', d.kondisiStock.trim()]);
  if (o.berlaku && d.berlaku.trim()) t.push(['Masa Berlaku', d.berlaku.trim()]);
  t.push(['Harga', d.ppnInclude ? 'Sudah termasuk PPN 11%' : 'Belum termasuk PPN 11%']);
  return t;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const br = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Pratinjau surat (HTML) — tata letak sama dengan file .docx. */
export function quoteHtml(d: QuoteData, o: QuoteOpts, logoSrc: string, signatureSrc = ''): string {
  const tx = quoteTexts(d);
  const cols = quoteColumns(d, o);
  const tot = quoteTotals(d, o);
  const wsum = cols.reduce((s, c) => s + c.w, 0);
  const items = d.items.filter((it) => it.uraian.trim());
  const terms = quoteTerms(d, o);
  const head = o.kop
    ? `<table class="qp-kop"><tr><td style="width:70px"><img src="${esc(logoSrc)}" alt=""></td><td><div class="qp-co">${tx.company}</div><div class="qp-div">${tx.division}</div>${d.kopText.trim() ? `<div class="qp-kt">${br(d.kopText.trim())}</div>` : ''}</td></tr></table>`
    : '';
  const meta = [
    ['Nomor', d.nomor],
    ...(o.lampiran ? [['Lampiran', d.lampiran || '-']] : []),
    ['Perihal', d.perihal],
  ];
  return `<div class="qp">
  ${head}
  <table class="qp-meta"><tr><td>${meta.map(([k, v]) => `<div><span class="qp-k">${k}</span>: ${k === 'Perihal' ? `<b>${esc(v)}</b>` : esc(v)}</div>`).join('')}</td><td class="qp-date">${esc(tx.tempatTanggal)}</td></tr></table>
  <p>Kepada Yth.<br><b>${esc(d.kepada)}</b>${o.alamat && d.alamat.trim() ? `<br>${br(d.alamat.trim())}` : ''}${o.pic && d.pic.trim() ? `<br>Up. ${esc(d.pic.trim())}` : ''}</p>
  <p>${tx.pembuka}</p>
  <p>${tx.intro}</p>
  <table class="qp-tbl"><thead><tr>${cols.map((c) => `<th style="width:${((c.w / wsum) * 100).toFixed(1)}%;text-align:${c.align}">${c.label}</th>`).join('')}</tr></thead>
  <tbody>${items.map((it, i) => `<tr>${cols.map((c) => `<td style="text-align:${c.align}">${esc(c.cell(it, i))}</td>`).join('')}</tr>`).join('')}
  ${tot.rows.map((r) => `<tr class="${r.bold ? 'qp-grand' : 'qp-sub'}"><td colspan="${cols.length - 1}" style="text-align:right">${esc(r.label)}</td><td style="text-align:right">${esc(r.value)}</td></tr>`).join('')}
  </tbody></table>
  ${o.terbilang ? `<p class="qp-terb">Terbilang: <i>${esc(terbilang(tot.grand))}</i></p>` : ''}
  <p class="qp-h">Syarat &amp; Ketentuan</p>
  <table class="qp-terms">${terms.map(([k, v]) => `<tr><td class="qp-k">${k}</td><td>: ${esc(v)}</td></tr>`).join('')}</table>
  ${o.catatan && d.catatan.trim() ? `<p class="qp-h">Catatan</p><p>${br(d.catatan.trim())}</p>` : ''}
  <p>${esc(tx.penutup)}</p>
  <p>Hormat kami,<br>${tx.company}</p>
  ${o.ttdGambar && signatureSrc ? `<div class="qp-sig"><img src="${esc(signatureSrc)}" alt=""></div>` : o.ttd ? '<div class="qp-ttd"></div>' : ''}
  <p><b><u>${esc(d.signer.nama)}</u></b>${d.signer.jabatan.trim() ? `<br>${esc(d.signer.jabatan.trim())}` : ''}${o.kontak ? [d.signer.telp.trim() && `Telp/WA: ${esc(d.signer.telp.trim())}`, d.signer.email.trim() && `Email: ${esc(d.signer.email.trim())}`].filter(Boolean).map((x) => `<br><span class="qp-small">${x}</span>`).join('') : ''}</p>
</div>`;
}
