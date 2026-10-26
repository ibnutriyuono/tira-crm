/**
 * Tugas Kunjungan (BM / GM → Sales) dan Rencana Kunjungan Mingguan (Sales →
 * disetujui BM). Dipakai server dan browser.
 *
 * Alur tugas: ditugaskan → dilaporkan (Sales melaporkan kunjungan; tercatat
 * sebagai Aktivitas Harian "kunjungan"), atau dibatalkan. Sales tidak bisa
 * menolak, tetapi boleh menjadwal ulang dengan alasan (penugas diberi tahu).
 * "Terlambat" = belum dilaporkan dan tenggat sudah lewat.
 *
 * Rencana mingguan: Sales menyusun daftar kunjungan Senin–Sabtu, mengajukan
 * ke BM; disetujui → tiap baris menjadi tugas kunjungan (asal "rencana").
 */

export type VisitStatus = 'ditugaskan' | 'dilaporkan' | 'dibatalkan';

export interface VisitReschedule {
  at: string;
  from: string;
  to: string;
  alasan: string;
  by: string;
}

export interface VisitTask {
  id: string;
  customer: string;
  customerId: string | null;
  prospectId: string | null;
  assigneeId: string;
  assigneeName: string;
  se: string | null;
  cabang: string | null;
  reg: number | null;
  assignedById: string;
  assignedByName: string;
  assignedByRole: string;
  tujuan: string;
  catatan: string | null;
  dueDate: string;
  status: VisitStatus;
  reschedules: VisitReschedule[];
  activityId: string | null;
  hasil: string | null;
  reportedAt: string | null;
  cancelReason: string | null;
  saran: string | null;
  planId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisitPlanItem {
  id: string;
  date: string;
  customer: string;
  customerId?: string | null;
  prospectId?: string | null;
  tujuan: string;
}

export type PlanStatus = 'draft' | 'diajukan' | 'disetujui' | 'ditolak';

export interface VisitPlan {
  id: string;
  userId: string;
  userName: string;
  se: string | null;
  cabang: string | null;
  reg: number | null;
  weekStart: string;
  items: VisitPlanItem[];
  status: PlanStatus;
  submittedAt: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PLAN_STATUS_META: Record<PlanStatus, { label: string; color: string }> = {
  draft: { label: 'Draf', color: 'slate' },
  diajukan: { label: 'Menunggu BM', color: 'amber' },
  disetujui: { label: 'Disetujui', color: 'green' },
  ditolak: { label: 'Dikembalikan', color: 'rust' },
};

export const TUJUAN_PRESET = ['Follow-up penawaran', 'Perkenalan produk', 'Penagihan / dokumen', 'Survei kebutuhan', 'Jaga hubungan (customer lama)', 'Tangani masalah / komplain'];

export const SARAN_VISIT: Record<string, string> = {
  dingin: 'Lama tidak dikunjungi',
  prospek: 'Prospek besar tanpa kontak',
  masalah: 'Masalah terbuka',
  kam: 'Key Account jatuh tempo',
};

export const isOpenTask = (t: Pick<VisitTask, 'status'>) => t.status === 'ditugaskan';
export const isLate = (t: Pick<VisitTask, 'status' | 'dueDate'>, today: string) => isOpenTask(t) && t.dueDate < today;

export type VisitView = 'terlambat' | 'dijadwal_ulang' | 'ditugaskan' | 'dilaporkan' | 'dibatalkan';
export const VISIT_VIEW_META: Record<VisitView, { label: string; color: string }> = {
  ditugaskan: { label: 'Ditugaskan', color: 'steel' },
  dijadwal_ulang: { label: 'Dijadwal ulang', color: 'violet' },
  terlambat: { label: 'Terlambat', color: 'rust' },
  dilaporkan: { label: 'Dilaporkan', color: 'green' },
  dibatalkan: { label: 'Dibatalkan', color: 'slate' },
};

export function visitView(t: Pick<VisitTask, 'status' | 'dueDate' | 'reschedules'>, today: string): VisitView {
  if (t.status === 'dilaporkan') return 'dilaporkan';
  if (t.status === 'dibatalkan') return 'dibatalkan';
  if (t.dueDate < today) return 'terlambat';
  if ((t.reschedules || []).length) return 'dijadwal_ulang';
  return 'ditugaskan';
}

/** Dilaporkan tepat waktu = laporan pada / sebelum tenggat ASLI (sebelum jadwal ulang). */
export function onTime(t: Pick<VisitTask, 'status' | 'dueDate' | 'reportedAt' | 'reschedules'>): boolean {
  if (t.status !== 'dilaporkan' || !t.reportedAt) return false;
  const original = (t.reschedules || [])[0]?.from || t.dueDate;
  return t.reportedAt.slice(0, 10) <= original;
}

/** Kepatuhan per Sales (papan BM / GM & KPI). */
export function compliance(tasks: VisitTask[], today: string) {
  const by = new Map<string, { id: string; name: string; cabang: string; total: number; done: number; tepat: number; late: number; open: number; ulang: number }>();
  tasks.forEach((t) => {
    if (t.status === 'dibatalkan') return;
    const e = by.get(t.assigneeId) || { id: t.assigneeId, name: t.assigneeName, cabang: t.cabang || '', total: 0, done: 0, tepat: 0, late: 0, open: 0, ulang: 0 };
    e.total++;
    if (t.status === 'dilaporkan') e.done++;
    if (onTime(t)) e.tepat++;
    if (isLate(t, today)) e.late++;
    if (isOpenTask(t)) e.open++;
    if ((t.reschedules || []).length) e.ulang++;
    by.set(t.assigneeId, e);
  });
  return Array.from(by.values())
    .map((e) => ({ ...e, pct: e.total ? Math.round((e.tepat / e.total) * 100) : null }))
    .sort((a, b) => b.late - a.late || (a.pct ?? 0) - (b.pct ?? 0));
}

/** Senin minggu dari tanggal (YYYY-MM-DD). */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BLN[d.getUTCMonth()]}`;
}
export function weekLabel(monday: string): string {
  const end = addDays(monday, 5);
  const a = new Date(`${monday}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  return `${a.getUTCDate()} ${BLN[a.getUTCMonth()]} – ${b.getUTCDate()} ${BLN[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

export function cleanPlanItems(v: unknown, weekStart: string): VisitPlanItem[] {
  const end = addDays(weekStart, 6);
  return (Array.isArray(v) ? v : [])
    .map((x, i) => {
      const o = (x || {}) as Record<string, unknown>;
      return {
        id: String(o.id || `p${Date.now().toString(36)}${i}`).slice(0, 40),
        date: String(o.date || ''),
        customer: String(o.customer || '').trim().slice(0, 160),
        customerId: o.customerId ? String(o.customerId).slice(0, 40) : null,
        prospectId: o.prospectId ? String(o.prospectId).slice(0, 40) : null,
        tujuan: String(o.tujuan || '').trim().slice(0, 200),
      };
    })
    .filter((x) => x.customer && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= weekStart && x.date <= end)
    .slice(0, 60);
}
