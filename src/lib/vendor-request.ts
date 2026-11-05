import type { RfqItem } from './types';

/**
 * "Minta Harga ke Vendor" dari detail RFQ / FUP A (Purchasing).
 *
 * Satu baris Quotation per vendor per dokumen: saluran, tenggat, status
 * (menunggu | dibalas | noquote) dan harga per item yang dibalas vendor.
 * Pesan ke vendor TIDAK memuat nama customer. Harga balasan bisa dipakai
 * sebagai HPP di jawaban RFQ (lib/rfq-price.ts).
 */

export type VrStatus = 'menunggu' | 'dibalas' | 'noquote';
export type VrChannel = 'email' | 'wa' | 'both';

export const VR_STATUS_META: Record<VrStatus, { label: string; color: string }> = {
  menunggu: { label: 'Menunggu', color: 'amber' },
  dibalas: { label: 'Dibalas', color: 'green' },
  noquote: { label: 'Tidak ada harga', color: 'slate' },
};

export const VR_CHANNEL_LABEL: Record<string, string> = { email: 'Email', wa: 'WhatsApp', both: 'Email + WA', WhatsApp: 'WhatsApp' };

export interface VrItemPrice {
  idx: number;
  harga?: number;
  currency?: string;
  leadTime?: string;
  note?: string;
  noQuote?: boolean;
}

export interface VendorRequest {
  id: string;
  vendorId: string;
  vendorNama: string;
  vendorEmail: string | null;
  vendorWa: string | null;
  rfqId: string | null;
  fupaId: string | null;
  tglDiminta: string | null;
  channel: string | null;
  status: VrStatus;
  tenggat: string | null;
  items: VrItemPrice[];
  currency: string | null;
  sentAt: string | null;
  reminders: number;
  lastReminderAt: string | null;
  balasAt: string | null;
  requestedBy: string | null;
  catatan: string | null;
  lang: VrLang;
  createdAt: string;
}

export interface VrLine {
  idx: number;
  no: number;
  line: string;
  material: string;
  dimensi: string;
  pcs: string;
  beratKg: string;
  estimasi: string;
}

const s = (v: unknown) => String(v ?? '').trim();

export function vrLines(items: RfqItem[], idxs?: number[]): VrLine[] {
  const pick = idxs && idxs.length ? new Set(idxs) : null;
  return items
    .map((it, idx) => ({ it, idx }))
    .filter(({ idx }) => !pick || pick.has(idx))
    .map(({ it, idx }, k) => ({
      idx,
      no: k + 1,
      line: s(it.line),
      material: [s(it.grade) && !s(it.material).toLowerCase().includes(s(it.grade).toLowerCase()) ? s(it.grade) : '', s(it.material)].filter(Boolean).join(' · '),
      dimensi: [it.dia && `Ø${it.dia}`, it.thick && `T${it.thick}`, it.width && `W${it.width}`, it.length && `L${it.length}`].filter(Boolean).join(' × '),
      pcs: s(it.pcs),
      beratKg: s(it.berat),
      estimasi: s(it.estimasi),
    }));
}

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Bahasa permintaan harga ke vendor: Indonesia (default) atau Inggris (vendor / mill luar negeri). */
export type VrLang = 'id' | 'en';
export const asVrLang = (v: unknown): VrLang => (v === 'en' ? 'en' : 'id');
export const fmtDate = (d: string | null | undefined, lang: VrLang = 'id') =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(8, 10))} ${(lang === 'en' ? MON : BLN)[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '';

/** Teks tetap untuk pesan, lampiran PDF/Excel, WhatsApp dan pengingat. */
export const VR_TEXT = {
  id: {
    subject: (no: string) => `Permintaan penawaran harga — ${no}`,
    reminderSubject: (no: string) => `Pengingat: permintaan penawaran harga — ${no}`,
    title: 'Permintaan Penawaran Harga (Request for Quotation)',
    xlsTitle: 'PT. TIRA AUSTENITE, Tbk — Permintaan Penawaran Harga',
    ref: 'Ref.',
    dueBy: 'Mohon dibalas paling lambat',
    lokasi: 'Lokasi kirim',
    kontak: 'Kontak',
    cols: ['No', 'Line', 'Material', 'Dimensi (mm)', 'Pcs', 'Berat (kg)', 'Harga / satuan'],
    xlsCols: ['NO', 'LINE', 'MATERIAL', 'DIMENSI (MM)', 'PCS', 'BERAT (KG)', 'HARGA / SATUAN', 'MATA UANG', 'LEAD TIME', 'ASAL', 'CATATAN'],
    pdfNote: 'Mohon cantumkan harga per satuan, mata uang, lead time / ketersediaan stok, negara asal dan masa berlaku penawaran.',
    attachments: 'Lampiran',
    waPdf: 'Daftar item (PDF)',
    waXlsx: 'Daftar item (Excel)',
    waGambar: 'Gambar kerja',
  },
  en: {
    subject: (no: string) => `Request for quotation — ${no}`,
    reminderSubject: (no: string) => `Reminder: request for quotation — ${no}`,
    title: 'Request for Quotation',
    xlsTitle: 'PT. TIRA AUSTENITE, Tbk — Request for Quotation',
    ref: 'Ref.',
    dueBy: 'Please reply by',
    lokasi: 'Delivery to',
    kontak: 'Contact',
    cols: ['No', 'Line', 'Material', 'Dimension (mm)', 'Pcs', 'Weight (kg)', 'Unit price'],
    xlsCols: ['NO', 'LINE', 'MATERIAL', 'DIMENSION (MM)', 'PCS', 'WEIGHT (KG)', 'UNIT PRICE', 'CURRENCY', 'LEAD TIME', 'ORIGIN', 'REMARKS'],
    pdfNote: 'Please state the unit price, currency, lead time / stock availability, country of origin and quotation validity.',
    attachments: 'Attachments',
    waPdf: 'Item list (PDF)',
    waXlsx: 'Item list (Excel)',
    waGambar: 'Drawing',
  },
} as const;

/** Nama PIC tanpa sapaan yang sudah tertulis di data vendor ("Pak Herman" → "Herman"), supaya tidak dobel. */
export const picName = (pic: string | null | undefined) => String(pic || '').trim().replace(/^(bapak|pak|bpk\.?|ibu|bu|mr\.?|mrs\.?|ms\.?)\s+/i, '');

/** Ganti sapaan {pic} dengan nama PIC vendor — atau sapaan umum bila PIC kosong. */
export function vrGreet(message: string, rawPic: string | null | undefined, vendorNama: string): string {
  const pic = picName(rawPic);
  return message
    .replace(/ Bapak\/Ibu \{pic\}/g, pic ? ` Bapak/Ibu ${pic}` : '')
    .replace(/Dear Mr\.\/Ms\. \{pic\}/g, pic ? `Dear Mr./Ms. ${pic}` : 'Dear Sir/Madam')
    .replace(/\{pic\}/g, pic || '')
    .replace(/\{vendor\}/g, vendorNama);
}

/** Pesan pengingat ke vendor. */
export function vrReminderText(lang: VrLang, raw: { pic?: string | null; docNo: string; tglDiminta: string | null; tenggat: string | null; sender: string }): string {
  const i = { ...raw, pic: picName(raw.pic) };
  if (lang === 'en')
    return `${i.pic ? `Dear Mr./Ms. ${i.pic}` : 'Dear Sir/Madam'},\n\nThis is a friendly reminder of our request for quotation (ref. ${i.docNo}) dated ${fmtDate(i.tglDiminta, 'en')}${i.tenggat ? `, due ${fmtDate(i.tenggat, 'en')}` : ''}. We look forward to receiving your price and lead time.\n\nBest regards,\n${i.sender}\nPurchasing – PT. TIRA AUSTENITE, Tbk (Steel Division)`;
  return `Dengan hormat${i.pic ? ` Bapak/Ibu ${i.pic}` : ''},\n\nMengingatkan permintaan penawaran harga kami (ref. ${i.docNo}) tanggal ${fmtDate(i.tglDiminta)}${i.tenggat ? ` dengan tenggat ${fmtDate(i.tenggat)}` : ''}. Mohon kabar harga dan lead time-nya.\n\nTerima kasih,\n${i.sender}\nPurchasing – PT. TIRA AUSTENITE, Tbk`;
}

export interface VrMessageInput {
  vendorPic?: string;
  docNo: string;
  lines: VrLine[];
  tenggat: string;
  lokasi: string;
  catatan: string;
  sender: string;
}

/** Pesan default (bisa diedit Purchasing sebelum dikirim). */
export function vrDefaultMessage(i: VrMessageInput, lang: VrLang = 'id'): string {
  if (lang === 'en') {
    const head = `Dear ${i.vendorPic ? `Mr./Ms. ${i.vendorPic}` : 'Sir/Madam'},\n\nPlease send us your best quotation for the following material (ref. ${i.docNo}):`;
    const rows = i.lines.map((l) => `${l.no}. ${l.material}${l.dimensi ? ` — ${l.dimensi}` : ''} · ${l.pcs || '-'} pcs${l.beratKg ? ` (${l.beratKg} kg)` : ''}`).join('\n');
    const tail = [
      i.lokasi ? `Delivery to: ${i.lokasi}` : '',
      i.tenggat ? `Please reply by ${fmtDate(i.tenggat, 'en')}.` : '',
      'Kindly state the unit price, currency, lead time / stock availability and country of origin.',
      i.catatan,
    ]
      .filter(Boolean)
      .join('\n');
    return `${head}\n${rows}\n\n${tail}\n\nBest regards,\n${i.sender}\nPurchasing – PT. TIRA AUSTENITE, Tbk (Steel Division)`;
  }
  const head = `Dengan hormat${i.vendorPic ? ` Bapak/Ibu ${i.vendorPic}` : ''},\n\nMohon penawaran harga terbaik untuk material berikut (ref. ${i.docNo}):`;
  const rows = i.lines.map((l) => `${l.no}. ${l.material}${l.dimensi ? ` — ${l.dimensi}` : ''} · ${l.pcs || '-'} pcs${l.beratKg ? ` (${l.beratKg} kg)` : ''}`).join('\n');
  const tail = [
    i.lokasi ? `Lokasi kirim: ${i.lokasi}` : '',
    i.tenggat ? `Mohon dibalas paling lambat ${fmtDate(i.tenggat)}.` : '',
    'Mohon cantumkan harga per satuan, mata uang, lead time / ketersediaan stok, dan negara asal.',
    i.catatan,
  ]
    .filter(Boolean)
    .join('\n');
  return `${head}\n${rows}\n\n${tail}\n\nTerima kasih,\n${i.sender}\nPurchasing – PT. TIRA AUSTENITE, Tbk (Steel Division)`;
}

/** Nomor WA ke format 62… untuk wa.me. */
export function waNumber(raw: string | null | undefined): string {
  let d = String(raw || '').replace(/\D+/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return d;
}

export function waUrl(num: string, text: string): string {
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export function vrFromRow(q: Record<string, unknown> & { vendor?: { nama: string; email: string | null; wa: string | null } }): VendorRequest {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return {
    id: String(q.id),
    vendorId: String(q.vendorId),
    vendorNama: q.vendor?.nama || '',
    vendorEmail: q.vendor?.email || null,
    vendorWa: q.vendor?.wa || null,
    rfqId: (q.rfqId as string) || null,
    fupaId: (q.fupaId as string) || null,
    tglDiminta: (q.tglDiminta as string) || null,
    channel: (q.channel as string) || null,
    status: (['menunggu', 'dibalas', 'noquote'].includes(String(q.status)) ? q.status : 'menunggu') as VrStatus,
    tenggat: (q.tenggat as string) || null,
    items: Array.isArray(q.items) ? (q.items as VrItemPrice[]) : [],
    currency: (q.currency as string) || null,
    sentAt: iso(q.sentAt),
    reminders: Number(q.reminders) || 0,
    lastReminderAt: iso(q.lastReminderAt),
    balasAt: iso(q.balasAt),
    requestedBy: (q.requestedBy as string) || null,
    catatan: (q.catatan as string) || null,
    lang: asVrLang(q.lang),
    createdAt: iso(q.createdAt) || '',
  };
}

export function cleanVrItems(v: unknown): VrItemPrice[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === 'object' && Number.isInteger(Number((x as VrItemPrice).idx)))
    .slice(0, 200)
    .map((x) => {
      const o = x as Record<string, unknown>;
      const h = Number(o.harga);
      return {
        idx: Number(o.idx),
        ...(Number.isFinite(h) && h > 0 ? { harga: h } : {}),
        currency: String(o.currency || 'IDR').toUpperCase().slice(0, 5),
        leadTime: String(o.leadTime || '').slice(0, 60),
        note: String(o.note || '').slice(0, 200),
        ...(o.noQuote ? { noQuote: true } : {}),
      };
    });
}

/** Rata-rata lama balas (hari) & persentase dibalas untuk scorecard vendor. */
export function vrStats(rows: Pick<VendorRequest, 'status' | 'sentAt' | 'balasAt' | 'createdAt'>[]) {
  const done = rows.filter((r) => r.status !== 'menunggu');
  const days = done
    .map((r) => (r.balasAt && (r.sentAt || r.createdAt) ? (Date.parse(r.balasAt) - Date.parse(r.sentAt || r.createdAt)) / 86400000 : null))
    .filter((x): x is number => x != null && x >= 0);
  return {
    total: rows.length,
    dibalas: rows.filter((r) => r.status === 'dibalas').length,
    noquote: rows.filter((r) => r.status === 'noquote').length,
    menunggu: rows.filter((r) => r.status === 'menunggu').length,
    avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
  };
}
