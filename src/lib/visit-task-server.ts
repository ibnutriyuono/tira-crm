import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';
import { notify } from './notify';
import { customerKey } from './reports';
import { isBranchRole } from './roles';
import { jakartaToday } from './followup-notify';
import { addDays } from './visit-task';
import type { SafeUser } from './types';

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/** Tugas / rencana yang boleh dilihat: Sales miliknya, BM & Admin Sales cabangnya, RM regionalnya, GM & Admin semua. */
export function visitScopeWhere(user: SafeUser): Record<string, unknown> {
  if (user.role === 'gm' || user.role === 'admin') return {};
  if (isBranchRole(user.role)) return { cabang: { equals: user.cabang || '__none__', mode: 'insensitive' } };
  if (user.role === 'rm') return { reg: user.reg ?? -1 };
  return { id: '__none__' };
}
export const taskScopeWhere = (user: SafeUser): Prisma.VisitTaskWhereInput =>
  (user.role === 'sales' || user.role === 'purchasing' || user.role === 'purchasing05' ? { assigneeId: user.id } : visitScopeWhere(user)) as Prisma.VisitTaskWhereInput;
export const planScopeWhere = (user: SafeUser): Prisma.VisitPlanWhereInput =>
  (user.role === 'sales' ? { userId: user.id } : user.role === 'purchasing' || user.role === 'purchasing05' ? { userId: '__none__' } : visitScopeWhere(user)) as Prisma.VisitPlanWhereInput;

/** BM hanya menugaskan Sales di cabangnya; GM (dan Admin) semua Sales. */
export function canAssignTo(user: SafeUser, assignee: { role: string; cabang: string | null; se: string | null }): boolean {
  if (!assignee.se && assignee.role !== 'sales') return false;
  if (user.role === 'gm' || user.role === 'admin') return true;
  return user.role === 'bm' && !!user.cabang && up(user.cabang) === up(assignee.cabang);
}

/** BM cabang menyetujui rencana; GM / Admin juga boleh. */
export function canReviewPlan(user: SafeUser, plan: { cabang: string | null }): boolean {
  if (user.role === 'gm' || user.role === 'admin') return true;
  return user.role === 'bm' && !!user.cabang && up(user.cabang) === up(plan.cabang);
}

export async function bmIdsOf(cabang: string | null | undefined): Promise<string[]> {
  if (!cabang) return [];
  const rows = await prisma.user.findMany({ where: { role: 'bm', cabang: { equals: cabang, mode: 'insensitive' } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Kunjungan yang dicatat Sales di Aktivitas Harian otomatis menyelesaikan
 * tugas kunjungan yang masih terbuka untuk customer yang sama (laporan kembali
 * otomatis ke penugas).
 */
export async function completeTasksFromActivity(act: { id: string; tanggal: string; customer: string; tipe: string; status?: string | null; keterangan?: string | null }, user: SafeUser): Promise<number> {
  if (act.tipe !== 'kunjungan' || (act.status && act.status !== 'selesai')) return 0;
  const key = customerKey(act.customer);
  const open = await prisma.visitTask.findMany({ where: { assigneeId: user.id, status: 'ditugaskan' } });
  const hits = open.filter((t) => customerKey(t.customer) === key && act.tanggal >= addDays(t.createdAt.toISOString().slice(0, 10), -1));
  for (const t of hits) {
    const done = await prisma.visitTask.update({
      where: { id: t.id },
      data: { status: 'dilaporkan', activityId: act.id, hasil: (act.keterangan || '').slice(0, 500) || 'Kunjungan tercatat di Aktivitas Harian', reportedAt: new Date(`${act.tanggal}T12:00:00+07:00`) },
    });
    emitCrmEvent('visitTask:updated', { id: done.id });
    await notify({
      userIds: [t.assignedById],
      type: 'visit_update',
      entity: 'visitTask',
      entityId: t.id,
      title: `Kunjungan dilaporkan: ${t.customer}`,
      message: `${user.name} mengunjungi ${t.customer} (${act.tanggal})${act.keterangan ? ` — ${act.keterangan}` : ''}`.slice(0, 300),
    });
  }
  return hits.length;
}

export interface VisitSuggestion {
  key: string;
  saran: 'dingin' | 'prospek' | 'masalah' | 'kam';
  customer: string;
  customerId: string | null;
  prospectId: string | null;
  se: string | null;
  cabang: string | null;
  why: string;
  tujuan: string;
}

/**
 * Saran tugas kunjungan untuk BM / GM: customer > 60 hari tidak dikunjungi
 * (yang masih punya transaksi 12 bulan), prospek besar tanpa kontak > 14 hari,
 * masalah pipeline terbuka, dan Key Account (strategic 14 hari / key 30 hari).
 * Customer yang sudah punya tugas terbuka tidak disarankan lagi.
 */
export async function visitSuggestions(user: SafeUser, cabangFilter?: string): Promise<VisitSuggestion[]> {
  const today = jakartaToday();
  const branchOnly = user.role === 'bm' ? up(user.cabang) : cabangFilter ? up(cabangFilter) : '';
  const regOnly = user.role === 'rm' ? user.reg : null;
  const inScope = (c: string | null, reg?: number | null) => (!branchOnly || up(c) === branchOnly) && (regOnly == null || reg === regOnly);
  const since365 = addDays(today, -365);
  const [prospects, acts, issues, groups, openTasks] = await Promise.all([
    prisma.prospect.findMany({ select: { id: true, customer: true, se: true, cabang: true, reg: true, status: true, value: true, tglPenawaran: true, statusChangedAt: true, createdAt: true } }),
    prisma.salesActivity.findMany({ where: { status: 'selesai', tanggal: { gte: since365 } }, select: { customer: true, tanggal: true, tipe: true, prospectId: true } }),
    prisma.prospectIssue.findMany({ where: { status: { in: ['open', 'proses'] } }, select: { id: true, prospectId: true, customer: true, se: true, cabang: true, reg: true, kategori: true } }),
    prisma.customerGroup.findMany({ where: { tier: { in: ['strategic', 'key'] } }, select: { name: true, tier: true, entities: true, homeCabang: true } }),
    prisma.visitTask.findMany({ where: { status: 'ditugaskan' }, select: { customer: true } }),
  ]);
  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  const custId = new Map(customers.map((c) => [customerKey(c.name), c.id]));
  const taken = new Set(openTasks.map((t) => customerKey(t.customer)));
  const lastVisit = new Map<string, string>();
  const lastContact = new Map<string, string>();
  acts.forEach((a) => {
    const k = customerKey(a.customer);
    if (a.tipe === 'kunjungan' && (lastVisit.get(k) || '') < a.tanggal) lastVisit.set(k, a.tanggal);
    if ((lastContact.get(k) || '') < a.tanggal) lastContact.set(k, a.tanggal);
  });
  const out: VisitSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: VisitSuggestion) => {
    const k = customerKey(s.customer);
    if (taken.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  const days = (d: string | undefined) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 86400000) : null);

  // Masalah terbuka
  issues.forEach((i) => {
    if (!inScope(i.cabang, i.reg) || i.prospectId.startsWith('doc:')) return;
    push({ key: `masalah:${i.id}`, saran: 'masalah', customer: i.customer, customerId: custId.get(customerKey(i.customer)) || null, prospectId: i.prospectId, se: i.se, cabang: i.cabang, why: 'Masalah pipeline masih terbuka', tujuan: 'Tangani masalah / komplain' });
  });
  // Prospek besar tanpa kontak > 14 hari
  const open = prospects.filter((p) => p.status >= 1 && p.status <= 3 && inScope(p.cabang, p.reg));
  const sorted = [...open].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, Math.max(5, Math.ceil(sorted.length * 0.25)));
  top.forEach((p) => {
    const k = customerKey(p.customer);
    const last = lastContact.get(k);
    const d = days(last) ?? days(p.statusChangedAt.toISOString().slice(0, 10));
    if (d == null || d <= 14) return;
    push({ key: `prospek:${p.id}`, saran: 'prospek', customer: p.customer, customerId: custId.get(k) || null, prospectId: p.id, se: p.se, cabang: p.cabang, why: `Prospek besar tanpa kontak ${d} hari`, tujuan: 'Follow-up penawaran' });
  });
  // Key Account jatuh tempo
  groups.forEach((g) => {
    if (branchOnly && up(g.homeCabang) !== branchOnly) return;
    const freq = g.tier === 'strategic' ? 14 : 30;
    const names = [g.name, ...((Array.isArray(g.entities) ? g.entities : []) as string[])];
    const last = names.map((n) => lastVisit.get(customerKey(n)) || '').sort().pop() || '';
    const d = days(last || undefined);
    if (d != null && d <= freq) return;
    const p = prospects.find((x) => names.some((n) => customerKey(n) === customerKey(x.customer)));
    push({ key: `kam:${g.name}`, saran: 'kam', customer: p?.customer || g.name, customerId: custId.get(customerKey(p?.customer || g.name)) || null, prospectId: null, se: p?.se || null, cabang: g.homeCabang || p?.cabang || null, why: `Key Account ${g.tier === 'strategic' ? 'Strategic' : 'Key'} — ${d == null ? 'belum ada kunjungan' : `terakhir dikunjungi ${d} hari lalu`} (jadwal tiap ${freq} hari)`, tujuan: 'Jaga hubungan (customer lama)' });
  });
  // Customer dingin: ada transaksi 12 bulan, > 60 hari tidak dikunjungi
  const byCust = new Map<string, (typeof prospects)[number]>();
  prospects.forEach((p) => {
    if (!inScope(p.cabang, p.reg)) return;
    const ref = p.tglPenawaran || p.createdAt.toISOString().slice(0, 10);
    if (ref < since365) return;
    const k = customerKey(p.customer);
    const prev = byCust.get(k);
    if (!prev || (prev.tglPenawaran || '') < (p.tglPenawaran || '')) byCust.set(k, p);
  });
  byCust.forEach((p, k) => {
    const d = days(lastVisit.get(k));
    if (d != null && d <= 60) return;
    push({ key: `dingin:${k}`, saran: 'dingin', customer: p.customer, customerId: custId.get(k) || null, prospectId: null, se: p.se, cabang: p.cabang, why: d == null ? 'Belum pernah dikunjungi (12 bulan)' : `Tidak dikunjungi ${d} hari`, tujuan: 'Jaga hubungan (customer lama)' });
  });
  return out.slice(0, 80);
}
