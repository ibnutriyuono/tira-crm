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
export const fmtDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(8, 10))} ${BLN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '');

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
export function vrDefaultMessage(i: VrMessageInput): string {
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
