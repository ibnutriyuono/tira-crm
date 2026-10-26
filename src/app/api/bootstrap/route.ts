import { docForRole } from '@/lib/rfq-price';
import { canSeeVendors } from '@/lib/roles';
import { NextResponse } from 'next/server';
import { budgetTargetScopeWhere, seTargetScopeWhere, customerScopeWhere, docScopeWhere, prospectScopeWhere, salesPlanScopeWhere } from '@/lib/auth';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import type { PurchasingContact } from '@/lib/types';
import { effectivePerms, roleDefs } from '@/lib/permissions-server';
import { sweepFollowUpNotifications } from '@/lib/followup-notify';
import { issueScopeWhere, sweepIssueEscalation } from '@/lib/issues-server';

// Single round-trip the client makes right after login / on page load —
// everything the dashboard needs to render before any modal is opened.
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  // Notifikasi follow-up hari H / terlambat (tanpa penjadwal: dicek saat CRM dibuka).
  await sweepFollowUpNotifications();
  await sweepIssueEscalation();
  const [prospects, customers, rfqs, fupas, vendors, budgetTargets, salesPlans, notifications, settingRow, customerGroups, annualTargets, seTargets, issues] = await Promise.all([
    prisma.prospect.findMany({ where: prospectScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.customer.findMany({ where: await customerScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.rfq.findMany({ where: await docScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.fupa.findMany({ where: await docScopeWhere(user, { table: 'fupa' }), orderBy: { createdAt: 'desc' } }),
    // Vendor list is Purchasing data (lib/roles.ts#canSeeVendors): Sales,
    // Admin Sales, BM and RM get an empty list. Write stays role-gated too
    // (see POST /api/vendors).
    canSeeVendors(user.role) ? prisma.vendor.findMany({ orderBy: { nama: 'asc' } }) : Promise.resolve([]),
    prisma.budgetTarget.findMany({ where: await budgetTargetScopeWhere(user), orderBy: [{ periode: 'desc' }, { cabang: 'asc' }] }),
    // Unscoped by periode, same convention as budgetTargets above — the
    // client filters by month locally (see ForecastModal), so bootstrap just
    // hands over everything this role is allowed to see across all months.
    prisma.salesPlan.findMany({ where: await salesPlanScopeWhere(user), orderBy: [{ periode: 'desc' }, { se: 'asc' }] }),
    // Own notifications only — inherently personal, no role-based scope
    // function needed the way prospects/rfqs/salesPlans have.
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.setting.findUnique({ where: { key: 'purchasingContact' } }),
    // Key Account groups: read by every sales-side role for badges & routing.
    user.role === 'purchasing05' ? Promise.resolve([]) : prisma.customerGroup.findMany({ orderBy: [{ skor: 'desc' }, { name: 'asc' }] }),
    prisma.annualTarget.findMany({ where: await budgetTargetScopeWhere(user), orderBy: [{ year: 'desc' }, { cabang: 'asc' }] }),
    prisma.seTarget.findMany({ where: await seTargetScopeWhere(user), orderBy: [{ periode: 'desc' }, { se: 'asc' }] }),
    // Masalah pipeline: aktif + 12 bulan terakhir (badge kartu, papan, saran).
    prisma.prospectIssue.findMany({
      where: { AND: [issueScopeWhere(user), { OR: [{ status: { in: ['usulan', 'open', 'proses'] } }, { updatedAt: { gte: new Date(Date.now() - 365 * 86400000) } }] }] },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const purchasingContact = (settingRow?.value as unknown as PurchasingContact) || { wa: '', email: '' };

  // Kelola Role: modul tanpa hak Lihat tidak dikirim sama sekali.
  const perms = await effectivePerms(user);
  const purch = user.role === 'purchasing' || user.role === 'purchasing05';
  const see = (m: string) => perms[m]?.v !== false;
  // Nama role tambahan (Kelola Role) untuk badge di top bar.
  const customRoleLabel = user.customRole ? (await roleDefs()).get(user.customRole)?.label || null : null;
  return NextResponse.json({
    user: { ...user, customRoleLabel },
    perms,
    prospects: see('prospek') ? prospects : [],
    customers: see('customer') ? customers : [],
    // HPP / margin / vendor & catatan internal Purchasing hanya untuk role ber-hak (lib/rfq-price.ts).
    rfqs: see(purch ? 'purch' : 'rfq') ? rfqs.map((r) => docForRole(r, user.role)) : [],
    fupas: see(purch ? 'purch' : 'rfq') ? fupas.map((f) => docForRole(f, user.role)) : [],
    vendors,
    budgetTargets,
    salesPlans: see('rencana') ? salesPlans : [],
    notifications,
    purchasingContact,
    customerGroups: see('kam') ? customerGroups : [],
    annualTargets,
    seTargets,
    issues: see('masalah') ? issues : [],
  });
}
