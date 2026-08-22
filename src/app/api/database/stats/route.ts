import { NextResponse } from 'next/server';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const [prospects, customers, rfqs, fupas, users] = await Promise.all([
    prisma.prospect.count(),
    prisma.customer.count(),
    prisma.rfq.count(),
    prisma.fupa.count(),
    prisma.user.count(),
  ]);

  return NextResponse.json({ prospects, customers, rfqs, fupas, users });
}
