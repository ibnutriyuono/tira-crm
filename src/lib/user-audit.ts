/**
 * Audit akun Kelola User (client-safe). Setiap user diperiksa terhadap aturan
 * di bawah; hasilnya dipakai untuk tanda di tabel, ringkasan "Perlu dicek"
 * dan filter per temuan.
 */
import { CABANG_LIST, cabangKey } from './constants';
import type { SafeUser } from './types';

export interface UserAuditInfo {
  id: string;
  createdAt: string;
  createdBy: string | null;
  createdByRole: string | null;
  lastLoginAt: string | null;
  logins30: number;
  failed30: number;
  lastActivityAt: string | null;
  prospects: number;
}

export type AuditKey =
  | 'asal'
  | 'seDup'
  | 'cabang'
  | 'reg'
  | 'email'
  | 'never'
  | 'idle'
  | 'pwd'
  | 'failed'
  | 'nameDup'
  | 'noEmail'
  | 'noSe'
  | 'pausedLong'
  | 'idleSales';

export const AUDIT_META: Record<AuditKey, { label: string; hint: string; level: 'merah' | 'kuning' | 'info' }> = {
  asal: { label: 'Tidak dibuat Admin', hint: 'Akun tidak tercatat dibuat lewat Kelola User oleh Admin (seed, impor database, langsung di database, atau oleh role lain). Pastikan pemiliknya sah.', level: 'merah' },
  seDup: { label: 'Kode SE dobel', hint: 'Kode SE dipakai lebih dari satu akun aktif — prospek & KPI bisa tercampur.', level: 'merah' },
  cabang: { label: 'Cabang kosong / tidak dikenal', hint: 'BM, Admin Sales & Sales wajib punya cabang yang ada di daftar cabang.', level: 'merah' },
  reg: { label: 'Regional tidak sesuai', hint: 'RM tanpa regional, atau regional akun berbeda dari regional mayoritas cabangnya.', level: 'merah' },
  email: { label: 'Email tidak valid', hint: 'Format email salah atau bukan domain perusahaan.', level: 'merah' },
  failed: { label: 'Login gagal berulang', hint: 'Lima kali atau lebih login gagal dalam 30 hari — cek apakah user lupa password atau ada percobaan masuk.', level: 'merah' },
  never: { label: 'Belum pernah login', hint: 'Akun aktif lebih dari 3 hari tetapi belum pernah login.', level: 'kuning' },
  idle: { label: 'Tidak login > 30 hari', hint: 'Akun aktif yang lama tidak dipakai — pertimbangkan Jeda.', level: 'kuning' },
  pwd: { label: 'Password sementara belum diganti', hint: 'Password direset Admin tetapi user belum membuat password baru.', level: 'kuning' },
  nameDup: { label: 'Nama sama dengan akun lain', hint: 'Dua akun bernama sama — kemungkinan akun ganda.', level: 'kuning' },
  noEmail: { label: 'Email kosong', hint: 'Tanpa email user tidak menerima notifikasi email.', level: 'kuning' },
  noSe: { label: 'Sales tanpa kode SE', hint: 'Prospek tidak bisa dihubungkan ke Sales ini.', level: 'kuning' },
  pausedLong: { label: 'Dijeda > 90 hari', hint: 'Akun lama dijeda — pertimbangkan dihapus bila orangnya sudah keluar.', level: 'info' },
  idleSales: { label: 'Sales tanpa prospek berjalan', hint: 'Sales aktif tanpa satu pun prospek berjalan (status 1–5).', level: 'info' },
};

export const COMPANY_DOMAIN = 'tiraaustenite.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86400000;
const ageDays = (iso: string | null | undefined, now: number) => (iso ? (now - new Date(iso).getTime()) / DAY : Infinity);

/** Asal akun untuk pengelompokan. */
export function originOf(a: UserAuditInfo | undefined): 'admin' | 'lain' | 'tidak' {
  if (!a || !a.createdBy) return 'tidak';
  return a.createdByRole === 'admin' ? 'admin' : 'lain';
}
export const ORIGIN_LABEL = { admin: 'Dibuat Admin (Kelola User)', lain: 'Dibuat role lain', tidak: 'Tidak tercatat dibuat Admin (seed / impor / langsung di database)' };

export function auditUsers(users: SafeUser[], info: Map<string, UserAuditInfo>, now = Date.now()): Map<string, AuditKey[]> {
  const active = users.filter((u) => !u.pausedAt);
  const seCount = new Map<string, number>();
  active.forEach((u) => {
    const k = String(u.se || '').trim().toUpperCase();
    if (k) seCount.set(k, (seCount.get(k) || 0) + 1);
  });
  const nameCount = new Map<string, number>();
  users.forEach((u) => {
    const k = u.name.trim().toLowerCase().replace(/\s+/g, ' ');
    nameCount.set(k, (nameCount.get(k) || 0) + 1);
  });
  // Regional mayoritas per cabang dari akun aktif.
  const regTally = new Map<string, Map<number, number>>();
  active.forEach((u) => {
    const c = cabangKey(u.cabang);
    if (!c || u.reg == null) return;
    const t = regTally.get(c) || new Map<number, number>();
    t.set(u.reg, (t.get(u.reg) || 0) + 1);
    regTally.set(c, t);
  });
  const regOf = (c: string) => {
    const t = regTally.get(c);
    if (!t) return null;
    return [...t.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const out = new Map<string, AuditKey[]>();
  users.forEach((u) => {
    const a = info.get(u.id);
    const f: AuditKey[] = [];
    const paused = !!u.pausedAt;
    const branchRole = u.role === 'sales' || u.role === 'bm' || u.role === 'salesadmin';
    if (a && originOf(a) !== 'admin') f.push('asal');
    const se = String(u.se || '').trim().toUpperCase();
    if (!paused && se && (seCount.get(se) || 0) > 1) f.push('seDup');
    const cab = cabangKey(u.cabang);
    if (branchRole && (!cab || !CABANG_LIST.includes(cab))) f.push('cabang');
    if (u.role === 'rm' && u.reg == null) f.push('reg');
    else if (branchRole && cab && u.reg != null) {
      const r = regOf(cab);
      if (r != null && r !== u.reg) f.push('reg');
    }
    const email = String(u.email || '').trim().toLowerCase();
    if (email && (!EMAIL_RE.test(email) || !email.endsWith(`@${COMPANY_DOMAIN}`))) f.push('email');
    if (!email && !paused) f.push('noEmail');
    if (a && a.failed30 >= 5) f.push('failed');
    if (!paused && a) {
      if (!a.lastLoginAt && ageDays(a.createdAt, now) > 3) f.push('never');
      else if (a.lastLoginAt && ageDays(a.lastLoginAt, now) > 30) f.push('idle');
    }
    if (u.mustChangePassword && !paused) f.push('pwd');
    if ((nameCount.get(u.name.trim().toLowerCase().replace(/\s+/g, ' ')) || 0) > 1) f.push('nameDup');
    if (u.role === 'sales' && !se) f.push('noSe');
    if (paused && ageDays(u.pausedAt, now) > 90) f.push('pausedLong');
    if (u.role === 'sales' && !paused && se && a && a.prospects === 0 && ageDays(a.createdAt, now) > 30) f.push('idleSales');
    out.set(u.id, f);
  });
  return out;
}

export type GroupBy = '' | 'role' | 'cabang' | 'reg' | 'asal' | 'login';

export function loginBucket(a: UserAuditInfo | undefined, now = Date.now()): string {
  if (!a?.lastLoginAt) return '4 · Belum pernah login';
  const d = ageDays(a.lastLoginAt, now);
  if (d <= 7) return '1 · Login 7 hari terakhir';
  if (d <= 30) return '2 · Login 8–30 hari lalu';
  return '3 · Tidak login > 30 hari';
}
