import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const [prospects, customers, rfqs, users] = await Promise.all([
    prisma.prospect.findMany(),
    prisma.customer.findMany(),
    prisma.rfq.findMany(),
    prisma.user.findMany(),
  ]);

  // A full export carries every password hash off the server — worth an audit
  // entry on its own, not just the mutations.
  await logActivity({
    user,
    action: 'export',
    entity: 'database',
    summary: `Mengunduh backup database (${prospects.length} prospek, ${customers.length} customer, ${rfqs.length} RFQ, ${users.length} user)`,
  });

  return NextResponse.json({
    app: 'CRM Prospect Steel Division',
    version: 1,
    exportedAt: new Date().toISOString(),
    prospects,
    customers,
    rfqs,
    users, // includes passwordHash so a restore doesn't lock everyone out — admin-only export.
  });
}
