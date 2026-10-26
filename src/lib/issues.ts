/**
 * Masalah Pipeline — definisi & aturan bersama (dipakai server dan browser).
 *
 * Alur: Sales mengajukan masalah ke BM ("usulan") -> BM membuat laporan resmi
 * ("open") dengan penanggung jawab (user) -> PJ menangani ("proses") -> PJ / BM
 * menutup dengan solusi & hasil ("selesai"). BM juga bisa langsung melapor.
 * Satu prospek hanya boleh punya satu masalah aktif.
 */
import { changeDate } from './filter';
import type { Prospect, Rfq } from './types';

export type IssueStatus = 'usulan' | 'open' | 'proses' | 'selesai' | 'ditolak' | 'diabaikan';
export type IssueHasil = 'deal' | 'jalan' | 'lose';

export interface PipelineIssue {
  id: string;
  prospectId: string;
  status: IssueStatus;
  kategori: string;
  urgensi: string;
  keterangan: string;
  targetDate: string | null;
  pjIds: string[];
  se: string | null;
  cabang: string | null;
  reg: number | null;
  customer: string;
  saran: string | null;
  diajukanOleh: string | null;
  diajukanNama: string | null;
  dilaporOleh: string | null;
  dilaporNama: string | null;
  dilaporAt: string | null;
  ditanganiAt: string | null;
  ditanganiNama: string | null;
  selesaiAt: string | null;
  selesaiNama: string | null;
  solusi: string | null;
  hasil: IssueHasil | null;
  alasanTolak: string | null;
  eskalasi: number;
  /** "purchasing" bila dilaporkan Purchasing; dokumen asal (RFQ / FUP A / PO). */
  sumber?: string | null;
  docJenis?: string | null;
  docId?: string | null;
  noDoc?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Kategori + role user yang diusulkan otomatis sebagai penanggung jawab. */
export const ISSUE_CATS: { key: string; label: string; pjRoles: string[]; purch?: boolean }[] = [
  { key: 'harga', label: 'Harga kalah', pjRoles: ['bm', 'kam'] },
  { key: 'kompetitor', label: 'Kompetitor', pjRoles: ['bm'] },
  { key: 'stok', label: 'Stok / indent / Kerjasama', pjRoles: ['purchasing'] },
  { key: 'leadtime', label: 'Lead time', pjRoles: ['purchasing'] },
  { key: 'spek', label: 'Spesifikasi / kualitas', pjRoles: [] },
  { key: 'bayar', label: 'Kredit / pembayaran', pjRoles: ['salesadmin'] },
  { key: 'tunda', label: 'Customer menunda', pjRoles: ['sales'] },
  { key: 'internal', label: 'Internal (dokumen / approval)', pjRoles: ['salesadmin'] },
  // Kategori khusus laporan Purchasing (dari detail RFQ / FUP A / PO Indent).
  { key: 'p_spek', label: 'Spesifikasi tidak jelas', pjRoles: ['sales'], purch: true },
  { key: 'p_noquote', label: 'Tidak ada vendor / No Quote', pjRoles: ['bm'], purch: true },
  { key: 'p_naik', label: 'Harga vendor naik', pjRoles: ['bm'], purch: true },
  { key: 'p_lead', label: 'Lead time lebih lama', pjRoles: ['purchasing'], purch: true },
  { key: 'p_telat', label: 'Barang terlambat / rusak', pjRoles: ['purchasing'], purch: true },
  { key: 'p_stok', label: 'Stok mill kosong', pjRoles: ['purchasing'], purch: true },
];
export const PURCH_ISSUE_CATS = ISSUE_CATS.filter((c) => c.purch);

/** Thread diskusi masalah: kartu prospek, atau dokumen RFQ / FUP A bila tanpa prospek. */
export function issueChat(i: Pick<PipelineIssue, 'prospectId'>): { entity: 'prospect' | 'rfq' | 'fupa'; id: string } {
  const m = /^doc:(rfq|fupa):(.+)$/.exec(i.prospectId || '');
  return m ? { entity: m[1] as 'rfq' | 'fupa', id: m[2] } : { entity: 'prospect', id: i.prospectId };
}
export const ISSUE_CAT_KEYS = ISSUE_CATS.map((c) => c.key);
export const issueCatLabel = (k: string) => ISSUE_CATS.find((c) => c.key === k)?.label || k;

export const URGENSI: { key: string; label: string; badge: string }[] = [
  { key: 'tinggi', label: 'Tinggi', badge: 'rust' },
  { key: 'sedang', label: 'Sedang', badge: 'amber' },
  { key: 'rendah', label: 'Rendah', badge: 'steel' },
];
export const urgensiLabel = (k: string) => URGENSI.find((u) => u.key === k)?.label || k;

export const ISSUE_STATUS_META: Record<IssueStatus, { label: string; badge: string }> = {
  usulan: { label: 'Diajukan ke BM', badge: 'violet' },
  open: { label: 'Terbuka', badge: 'rust' },
  proses: { label: 'Ditangani', badge: 'amber' },
  selesai: { label: 'Selesai', badge: 'green' },
  ditolak: { label: 'Ditolak BM', badge: 'slate' },
  diabaikan: { label: 'Saran diabaikan', badge: 'slate' },
};
export const HASIL_META: Record<IssueHasil, string> = { deal: 'Done/Deal', jalan: 'Masih berjalan', lose: 'Lose' };

/** Masalah yang masih aktif (memblok laporan baru di prospek yang sama). */
export const isActiveIssue = (i: Pick<PipelineIssue, 'status'>) => i.status === 'usulan' || i.status === 'open' || i.status === 'proses';
/** Laporan resmi yang belum selesai (dihitung di papan, badge, eskalasi). */
export const isOpenIssue = (i: Pick<PipelineIssue, 'status'>) => i.status === 'open' || i.status === 'proses';

/** Batas eskalasi: belum ditangani > 2 hari -> BM cabang; belum selesai > 4 hari -> RM regional + GM. */
export const ESKALASI_BM_HARI = 2;
export const ESKALASI_ATAS_HARI = 4;

export function daysSince(iso: string | null | undefined, today: string): number {
  if (!iso) return 0;
  const a = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${today}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Kode saran otomatis -> teks. */
export const SARAN_META: Record<string, { label: string; kategori: string }> = {
  stagnan: { label: 'mandek di tahap yang sama', kategori: 'tunda' },
  penawaran: { label: 'penawaran belum terkirim', kategori: 'internal' },
  rfq: { label: 'RFQ belum dijawab Purchasing', kategori: 'stok' },
};
export const SARAN_STAGNAN_HARI = 30;
export const SARAN_PENAWARAN_HARI = 7;
export const SARAN_RFQ_HARI = 3;
/** Saran yang diabaikan tidak muncul lagi selama ini (hari). */
export const SARAN_JEDA_HARI = 30;

export interface IssueSuggestion {
  key: string;
  prospect: Prospect;
  saran: 'stagnan' | 'penawaran' | 'rfq';
  why: string;
  kategori: string;
  days: number;
}

/**
 * Prospek terbuka (Permintaan–Negosiasi) yang berpotensi bermasalah:
 *  - mandek >= 30 hari di tahap yang sama;
 *  - penawaran belum terkirim >= 7 hari setelah prospek dibuat;
 *  - RFQ-nya belum dijawab Purchasing >= 3 hari.
 * Prospek yang sudah punya masalah aktif, atau sarannya diabaikan < 30 hari
 * lalu, tidak disarankan.
 */
export function issueSuggestions(prospects: Prospect[], rfqs: Rfq[], issues: PipelineIssue[], today: string): IssueSuggestion[] {
  const active = new Set(issues.filter(isActiveIssue).map((i) => i.prospectId));
  const muted = new Set(
    issues.filter((i) => i.status === 'diabaikan' && i.saran && daysSince(i.createdAt, today) < SARAN_JEDA_HARI).map((i) => `${i.prospectId}|${i.saran}`),
  );
  const rfqByProspect = new Map<string, Rfq[]>();
  rfqs.forEach((r) => {
    if (!r.prospectId) return;
    const l = rfqByProspect.get(r.prospectId) || [];
    l.push(r);
    rfqByProspect.set(r.prospectId, l);
  });
  const out: IssueSuggestion[] = [];
  prospects.forEach((p) => {
    const st = Number(p.status);
    if (!(st >= 1 && st <= 3) || active.has(p.id)) return;
    const push = (saran: IssueSuggestion['saran'], why: string, days: number) => {
      if (muted.has(`${p.id}|${saran}`)) return;
      out.push({ key: `${p.id}|${saran}`, prospect: p, saran, why, kategori: SARAN_META[saran].kategori, days });
    };
    const rfqLate = (rfqByProspect.get(p.id) || [])
      .filter((r) => r.status === 'Terkirim' && !r.purchJawaban && Number(r.purchStatus) < 2)
      .map((r) => ({ r, d: daysSince(r.tglRfq || r.createdAt, today) }))
      .filter((x) => x.d >= SARAN_RFQ_HARI)
      .sort((a, b) => b.d - a.d)[0];
    if (rfqLate) {
      push('rfq', `RFQ ${rfqLate.r.noRfq || ''} belum dijawab Purchasing ${rfqLate.d} hari`.replace('  ', ' '), rfqLate.d);
      return;
    }
    const age = daysSince(p.createdAt, today);
    if (!p.penawaranTerkirim && age >= SARAN_PENAWARAN_HARI) {
      push('penawaran', `penawaran belum terkirim ${age} hari setelah prospek dibuat`, age);
      return;
    }
    const still = daysSince(changeDate(p), today);
    if (still >= SARAN_STAGNAN_HARI) push('stagnan', `${still} hari di tahap yang sama tanpa perubahan`, still);
  });
  return out.sort((a, b) => b.days - a.days);
}

/** Validasi isian laporan/usulan; null = valid. */
export function issueInputError(b: { kategori?: unknown; keterangan?: unknown; urgensi?: unknown; targetDate?: unknown }, needPj: boolean, pjIds: string[]): string | null {
  if (!ISSUE_CAT_KEYS.includes(String(b.kategori || ''))) return 'Pilih kategori masalah.';
  if (String(b.keterangan || '').trim().length < 10) return 'Isi keterangan masalah (min. 10 karakter) supaya penanggung jawab paham konteksnya.';
  if (b.urgensi && !URGENSI.some((u) => u.key === b.urgensi)) return 'Urgensi tidak valid.';
  if (b.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.targetDate))) return 'Target selesai tidak valid.';
  if (needPj && pjIds.length === 0) return 'Pilih minimal satu penanggung jawab.';
  return null;
}
