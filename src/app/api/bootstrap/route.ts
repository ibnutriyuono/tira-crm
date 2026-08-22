import { NextResponse } from 'next/server';
import { docScopeWhere, prospectScopeWhere } from '@/lib/auth';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import type { PurchasingContact } from '@/lib/types';

// Single round-trip the client makes right after login / on page load —
// everything the dashboard needs to render before any modal is opened.
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const [prospects, customers, rfqs, fupas, vendors, budgetTargets, settingRow] = await Promise.all([
    prisma.prospect.findMany({ where: prospectScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.customer.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.rfq.findMany({ where: docScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.fupa.findMany({ where: docScopeWhere(user), orderBy: { createdAt: 'desc' } }),
    prisma.vendor.findMany({ orderBy: { nama: 'asc' } }),
    prisma.budgetTarget.findMany({ orderBy: [{ periode: 'desc' }, { cabang: 'asc' }] }),
    prisma.setting.findUnique({ where: { key: 'purchasingContact' } }),
  ]);

  const purchasingContact = (settingRow?.value as unknown as PurchasingContact) || { wa: '', email: '' };

  return NextResponse.json({ user, prospects, customers, rfqs, fupas, vendors, budgetTargets, purchasingContact });
}
