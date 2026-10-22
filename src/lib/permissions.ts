/**
 * Kelola Role — hak per modul: Lihat (v), Tambah/Ubah (e), Hapus (d),
 * Download (x). Client-safe (dipakai server dan browser).
 *
 * Centang = menu/tombol tampil dan berfungsi. Hak yang memang tidak bisa
 * dijalankan tipe dasarnya (ROLE_LIMITS) dikunci; cakupan data (cabang /
 * regional / Kode SE) dan alur persetujuan tetap mengikuti tipe dasar. Role
 * tanpa pengaturan = semua hak yang tersedia untuk tipe dasarnya.
 */

export type PermAct = 'v' | 'e' | 'd' | 'x';
export type ModPerm = Record<PermAct, boolean>;

export interface ModuleDef {
  key: string;
  label: string;
  hint: string;
  group: string;
  acts: PermAct[];
}

export const PERM_MODULES: ModuleDef[] = [
  { key: 'prospek', label: 'Prospek & Pipeline', hint: 'Kanban, Edit Prospek, impor/ekspor prospek', group: 'PENJUALAN', acts: ['v', 'e', 'd', 'x'] },
  { key: 'aktivitas', label: 'Aktivitas Harian', hint: 'input & daftar aktivitas Sales', group: 'PENJUALAN', acts: ['v', 'e', 'd', 'x'] },
  { key: 'rencana', label: 'Rencana Penjualan', hint: 'rencana per SE per bulan', group: 'PENJUALAN', acts: ['v', 'e', 'd', 'x'] },
  { key: 'customer', label: 'Customer', hint: 'Kelola Customer, gabung duplikat', group: 'PENJUALAN', acts: ['v', 'e', 'd', 'x'] },
  { key: 'rfq', label: 'RFQ / FUP A', hint: 'permintaan harga & pengadaan', group: 'PENJUALAN', acts: ['v', 'e', 'd', 'x'] },
  { key: 'masalah', label: 'Masalah Pipeline', hint: 'lapor & tindak lanjut masalah prospek, papan Pareto', group: 'PENJUALAN', acts: ['v', 'e', 'x'] },
  { key: 'kam', label: 'Key Account', hint: 'grup, tier, tim akun, account plan', group: 'PENJUALAN', acts: ['v', 'e', 'd', 'x'] },
  { key: 'forecast', label: 'Forecast & Target', hint: 'target cabang, tahunan, per Sales', group: 'TARGET & ANALISA', acts: ['v', 'e', 'x'] },
  { key: 'kpi', label: 'KPI & KPI Aktivitas', hint: 'scorecard, target aktivitas', group: 'TARGET & ANALISA', acts: ['v', 'e', 'x'] },
  { key: 'analisa', label: 'Analisa Eksekutif', hint: 'Sales, Target, Product, Pipeline, PPT', group: 'TARGET & ANALISA', acts: ['v', 'x'] },
  { key: 'marketing', label: 'Marketing & Customer Intelligence', hint: 'reaktivasi, log kompetitor, hasil QCD', group: 'TARGET & ANALISA', acts: ['v', 'e', 'x'] },
  { key: 'faktur', label: 'Faktur & Antrian Admin', hint: 'status terfaktur, tgl/no faktur', group: 'OPERASIONAL', acts: ['v', 'e', 'x'] },
  { key: 'trip', label: 'Perjalanan Dinas', hint: 'rencana, persetujuan, realisasi', group: 'OPERASIONAL', acts: ['v', 'e', 'd', 'x'] },
  { key: 'purch', label: 'Purchasing', hint: 'jawab RFQ, vendor, penawaran harga', group: 'OPERASIONAL', acts: ['v', 'e', 'd', 'x'] },
  { key: 'log', label: 'Log Aktivitas', hint: 'jejak perubahan data', group: 'OPERASIONAL', acts: ['v', 'x'] },
];
export const PERM_KEYS = PERM_MODULES.map((m) => m.key);
export const ACT_LABEL: Record<PermAct, string> = { v: 'Lihat', e: 'Tambah/Ubah', d: 'Hapus', x: 'Download' };

export type Perms = Record<string, ModPerm>;

/** Role bawaan yang bisa dipakai sebagai tipe dasar role tambahan. */
export const BASE_ROLES: { key: string; label: string; scope: string; note: string }[] = [
  { key: 'sales', label: 'Sales', scope: 'Milik sendiri (Kode SE)', note: 'Melihat prospek/aktivitas dengan Kode SE miliknya; perjalanan dinas ke cabangnya disetujui BM.' },
  { key: 'salesadmin', label: 'Admin Sales', scope: 'Satu cabang', note: 'Seluruh data satu cabang; mengisi atas nama Sales, surat penawaran atas nama Sales/BM, faktur; notifikasi Antrian Admin.' },
  { key: 'bm', label: 'BM (Branch Manager)', scope: 'Satu cabang', note: 'Seluruh data satu cabang; membagi target ke Sales; perjalanan dinas; menyetujui perjalanan Sales cabangnya.' },
  { key: 'rm', label: 'RM (Regional Manager)', scope: 'Satu regional', note: 'Semua cabang di regionalnya; menyetujui perjalanan BM.' },
  { key: 'gm', label: 'GM (General Manager)', scope: 'Nasional', note: 'Seluruh data perusahaan; menetapkan target cabang.' },
  { key: 'purchasing', label: 'Purchasing', scope: 'Nasional — dokumen RFQ/FUP A', note: 'UI Purchasing; melihat semua RFQ/FUP A dan prospek.' },
];
export const BUILTIN_ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', gm: 'GM', rm: 'RM', bm: 'BM', salesadmin: 'Admin Sales', sales: 'Sales', purchasing: 'Purchasing', purchasing05: 'PIC Line 05',
};

/**
 * Batas tipe dasar: hak yang TIDAK PERNAH bisa dijalankan role bertipe dasar
 * tsb, karena aturan servernya (alur kerja / pemilik data) memang tidak
 * mengizinkan. Di Kelola Role sel ini dikunci dengan alasannya, dan hak
 * efektif selalu dipotong ke batas ini — jadi centang di Kelola Role = menu &
 * tombol benar-benar tampil dan berfungsi.
 *
 * Harus sejalan dengan: canDeleteProspect, canEditBudgetTarget, canManageKam,
 * canSeeAdminQueue, activityOwner, canEditSalesPlanFor, canEditPurchasing,
 * TRIP_ROLES.
 */
type Limit = { acts: PermAct[]; why: string };
const ALL: PermAct[] = ['v', 'e', 'd', 'x'];
const L = (acts: PermAct[], why: string): Limit => ({ acts, why });
const PROSPEK_D = L(['d'], 'Hapus prospek hanya GM & Admin');
const TARGET_E = L(['e'], 'Target ditetapkan GM / RM / BM');
const KAM_ED = L(['e', 'd'], 'Grup & tim Key Account diatur GM / RM');
const PURCH_ED = L(['e', 'd'], 'Vendor & penawaran dikerjakan Purchasing');
const NO_PLAN = L(['e', 'd'], 'Rencana diisi Sales sendiri / BM cabangnya / GM');
const NOT_IN_PURCH = L(ALL, 'Tidak ada di tampilan Purchasing');

export const ROLE_LIMITS: Record<string, Partial<Record<string, Limit>>> = {
  sales: { prospek: PROSPEK_D, forecast: TARGET_E, kpi: TARGET_E, kam: KAM_ED, faktur: L(ALL, 'Antrian Admin untuk Admin Sales, BM, RM, GM'), purch: PURCH_ED },
  salesadmin: { prospek: PROSPEK_D, rencana: NO_PLAN, forecast: TARGET_E, kpi: TARGET_E, kam: KAM_ED, trip: L(ALL, 'Perjalanan dinas untuk Sales, BM, RM, GM'), purch: PURCH_ED },
  bm: { prospek: PROSPEK_D, kam: KAM_ED, purch: PURCH_ED },
  rm: { prospek: PROSPEK_D, rencana: L(['e', 'd'], 'RM hanya melihat rencana penjualan'), kam: L(['d'], 'Hapus grup Key Account hanya GM & Admin'), purch: PURCH_ED },
  gm: { purch: PURCH_ED },
  purchasing: {
    rfq: L(ALL, 'Untuk Purchasing diatur lewat modul Purchasing'),
    rencana: NOT_IN_PURCH, forecast: NOT_IN_PURCH, kpi: NOT_IN_PURCH, analisa: NOT_IN_PURCH,
    marketing: NOT_IN_PURCH, faktur: NOT_IN_PURCH, trip: NOT_IN_PURCH, log: NOT_IN_PURCH,
  },
};
ROLE_LIMITS.purchasing05 = ROLE_LIMITS.purchasing;

/** Alasan bila aksi ini tidak tersedia untuk tipe dasar `base`, atau null. */
export function limitReason(base: string | null | undefined, mod: string, act: PermAct): string | null {
  const l = ROLE_LIMITS[base || '']?.[mod];
  return l && l.acts.includes(act) ? l.why : null;
}

/** Potong hak ke batas tipe dasar (Admin / tipe tak dikenal: tidak dipotong). */
export function clampPerms(p: Perms, base: string | null | undefined): Perms {
  const lim = ROLE_LIMITS[base || ''];
  if (!lim) return p;
  const out: Perms = {};
  PERM_MODULES.forEach((m) => {
    const cur = p[m.key] || { v: true, e: true, d: true, x: true };
    const off = lim[m.key]?.acts || [];
    const v = cur.v && !off.includes('v');
    out[m.key] = { v, e: v && cur.e && !off.includes('e'), d: v && cur.d && !off.includes('d'), x: v && cur.x && !off.includes('x') };
  });
  return out;
}

export function fullPerms(): Perms {
  const p: Perms = {};
  PERM_MODULES.forEach((m) => (p[m.key] = { v: true, e: true, d: true, x: true }));
  return p;
}

/** Hak bawaan tipe dasar: semua yang memang bisa dijalankan tipe tsb. */
export function basePerms(base: string | null | undefined): Perms {
  return clampPerms(fullPerms(), base);
}

export function viewOnlyPerms(p: Perms): Perms {
  const out: Perms = {};
  PERM_MODULES.forEach((m) => (out[m.key] = { v: !!p[m.key]?.v, e: false, d: false, x: false }));
  return out;
}

/**
 * Bersihkan isi perms dari database/request: modul yang tidak disebut =
 * diizinkan (supaya modul baru di masa depan tidak tiba-tiba tertutup),
 * aksi yang tidak berlaku untuk modulnya = false, dan tanpa Lihat tidak ada
 * aksi lain.
 */
export function normalizePerms(raw: unknown): Perms {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, Partial<Record<PermAct, unknown>>>) : {};
  const out: Perms = {};
  PERM_MODULES.forEach((m) => {
    const r = src[m.key];
    const pick = (a: PermAct) => (m.acts.includes(a) ? (r && a in r ? !!r[a] : true) : false);
    const v = pick('v');
    out[m.key] = { v, e: v && pick('e'), d: v && pick('d'), x: v && pick('x') };
  });
  return out;
}

export function can(perms: Perms | null | undefined, mod: string, act: PermAct): boolean {
  if (!perms) return true;
  const p = perms[mod];
  if (!p) return true;
  return !!p[act];
}

/** Jumlah sel yang berbeda dari perms acuan (untuk penanda "n perubahan"). */
export function permDiff(a: Perms, b: Perms): number {
  let n = 0;
  PERM_MODULES.forEach((m) => m.acts.forEach((x) => { if (!!a[m.key]?.[x] !== !!b[m.key]?.[x]) n++; }));
  return n;
}

/** Key role tambahan dari nama: huruf kecil, angka, tanda hubung. */
export function roleKeyFromLabel(label: string): string {
  return ('r-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 40);
}

export const DENIED_MSG: Record<PermAct, string> = {
  v: 'Role Anda tidak memiliki hak melihat modul ini.',
  e: 'Role Anda tidak memiliki hak menambah/mengubah data di modul ini.',
  d: 'Role Anda tidak memiliki hak menghapus data di modul ini.',
  x: 'Role Anda tidak memiliki hak download di modul ini.',
};
