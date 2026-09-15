import { NextResponse } from 'next/server';
import { budgetTargetScopeWhere, customerScopeWhere, docScopeWhere, prospectScopeWhere, salesPlanScopeWhere } from '@/lib/auth';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import type { PurchasingContact } from '@/lib/types';

// Single round-trip the client makes right after login / on page load —
// everything the dashboard needs to render before any modal is opened.
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const [prospects, customers, rfqs, fupas, vendors, budgetTargets, salesPlans, notifications, settingRow] = await Promise.all([
    prisma.prospect.findMany({ where: prospectScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.customer.findMany({ where: await customerScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.rfq.findMany({ where: await docScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.fupa.findMany({ where: await docScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    // Vendor deliberately stays company-wide read for every role — it has
    // no cabang/reg field at all (vendors quote nationally, not per branch),
    // and sales/managers need to see which vendors were asked to quote on
    // their own RFQs regardless of which branch originally added that
    // vendor. Only write is role-gated (see POST /api/vendors).
    prisma.vendor.findMany({ orderBy: { nama: 'asc' } }),
    prisma.budgetTarget.findMany({ where: await budgetTargetScopeWhere(user), orderBy: [{ periode: 'desc' }, { cabang: 'asc' }] }),
    // Unscoped by periode, same convention as budgetTargets above — the
    // client filters by month locally (see ForecastModal), so bootstrap just
    // hands over everything this role is allowed to see across all months.
    prisma.salesPlan.findMany({ where: await salesPlanScopeWhere(user), orderBy: [{ periode: 'desc' }, { se: 'asc' }] }),
    // Own notifications only — inherently personal, no role-based scope
    // function needed the way prospects/rfqs/salesPlans have.
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.setting.findUnique({ where: { key: 'purchasingContact' } }),
  ]);

  const purchasingContact = (settingRow?.value as unknown as PurchasingContact) || { wa: '', email: '' };

  return NextResponse.json({ user, prospects, customers, rfqs, fupas, vendors, budgetTargets, salesPlans, notifications, purchasingContact });
}
