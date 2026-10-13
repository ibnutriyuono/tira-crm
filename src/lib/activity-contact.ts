/**
 * Aktivitas Harian — saluran, kontak wajib, hasil kontak. Client-safe: form dan
 * API memakai aturan yang sama.
 *
 * - Telepon / WA / Email (tipe "telepon") dan Kirim dokumen punya saluran.
 *   Saluran Telepon/WhatsApp mewajibkan No. HP/WA, Email mewajibkan email,
 *   untuk setiap PIC yang dicentang "dihubungi" (minimal satu).
 * - Hasil kontak wajib untuk saluran Telepon/WA/Email; selain "Tersambung"
 *   wajib tanggal follow-up (dibuat sebagai rencana).
 * - Meeting wajib langkah berikutnya.
 * Aturan hanya dipakai saat aktivitas dibuat / diubah; data lama tidak disentuh.
 */

export type Kanal = 'telepon' | 'wa' | 'email' | 'kurir';
export type Hasil = 'tersambung' | 'tidak_diangkat' | 'belum_dibalas' | 'minta_lagi';

export const KANAL_LABEL: Record<Kanal, string> = { telepon: 'Telepon', wa: 'WhatsApp', email: 'Email', kurir: 'Kurir / diantar langsung' };
export const KANAL_BY_TIPE: Record<string, Kanal[]> = { telepon: ['telepon', 'wa', 'email'], dokumen: ['wa', 'email', 'kurir'] };
export const HASIL_LABEL: Record<Hasil, string> = { tersambung: 'Tersambung', tidak_diangkat: 'Tidak diangkat', belum_dibalas: 'Belum dibalas', minta_lagi: 'Minta dihubungi lagi' };
export const HASIL_KEYS = Object.keys(HASIL_LABEL) as Hasil[];

export interface ContactPic {
  nama: string;
  jabatan: string;
  phone?: string;
  email?: string;
  /** Dicentang = PIC ini yang dihubungi pada aktivitas ini. */
  dihubungi?: boolean;
}

/** "+62 812-3456-7890" / "0812 3456 7890" -> "081234567890". */
export function normalizePhone(v: string | null | undefined): string {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('62')) d = '0' + d.slice(2);
  else if (d.startsWith('8')) d = '0' + d;
  return d;
}

/** '' bila valid, atau alasan singkat. */
export function phoneError(v: string | null | undefined): string {
  const d = normalizePhone(v);
  if (!d) return 'wajib diisi';
  if (!d.startsWith('08')) return 'harus diawali 08 / +62';
  if (d.length < 10 || d.length > 13) return 'panjang 10–13 digit';
  if (/^08(\d)\1{6,}/.test(d) || /^08(0{6,}|123456789)/.test(d)) return 'nomor tidak wajar';
  return '';
}

export function emailError(v: string | null | undefined): string {
  const s = String(v || '').trim();
  if (!s) return 'wajib diisi';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? '' : 'format email salah';
}

export const kanalNeeds = (kanal: string | null | undefined): 'phone' | 'email' | null =>
  kanal === 'telepon' || kanal === 'wa' ? 'phone' : kanal === 'email' ? 'email' : null;

/** Hasil kontak dipakai untuk tipe Telepon/WA/Email dan Dokumen via WA/Email. */
export const needsHasil = (tipe: string, kanal: string | null | undefined) => tipe === 'telepon' || (tipe === 'dokumen' && (kanal === 'wa' || kanal === 'email'));

export interface ContactInput {
  tipe: string;
  kanal?: string | null;
  hasil?: string | null;
  followUp?: string | null;
  langkah?: string | null;
  pics: ContactPic[];
}

/** Semua pelanggaran aturan (kosong = boleh disimpan). */
export function contactErrors(a: ContactInput): string[] {
  const errs: string[] = [];
  const kanals = KANAL_BY_TIPE[a.tipe];
  if (kanals && !kanals.includes(a.kanal as Kanal)) errs.push('Pilih saluran (Telepon / WhatsApp / Email / Kurir).');
  const need = kanals ? kanalNeeds(a.kanal) : null;
  const contacted = a.pics.filter((p) => p.dihubungi);
  if (need && contacted.length === 0) errs.push('Centang minimal satu PIC yang dihubungi.');
  a.pics.forEach((p, i) => {
    const who = p.nama || `PIC baris ${i + 1}`;
    const must = !!p.dihubungi && need;
    const pe = must === 'phone' || (p.phone || '').trim() ? phoneError(p.phone) : '';
    const ee = must === 'email' || (p.email || '').trim() ? emailError(p.email) : '';
    if (pe) errs.push(`${who}: No. HP/WA ${pe}.`);
    if (ee) errs.push(`${who}: Email ${ee}.`);
  });
  if (needsHasil(a.tipe, a.kanal)) {
    if (!HASIL_KEYS.includes(a.hasil as Hasil)) errs.push('Pilih hasil kontak.');
    else if (a.hasil !== 'tersambung' && !/^\d{4}-\d{2}-\d{2}$/.test(a.followUp || '')) errs.push('Isi tanggal follow-up (hasil belum tersambung).');
  }
  if (a.tipe === 'meeting' && !(a.langkah || '').trim()) errs.push('Meeting wajib mengisi langkah berikutnya.');
  return errs;
}

/** Link WhatsApp (wa.me) untuk nomor PIC; null bila nomor tidak valid. */
export function waLink(phone: string | null | undefined): string | null {
  if (phoneError(phone)) return null;
  return `https://wa.me/62${normalizePhone(phone).slice(1)}`;
}
