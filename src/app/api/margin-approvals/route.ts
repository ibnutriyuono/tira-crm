import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { canSeeHpp } from '@/lib/roles';
import { approvalView } from '@/lib/margin-server';
import { canApproveMargin } from '@/lib/margin-check';

/** Daftar persetujuan margin untuk VP / Admin (GM ikut melihat; menyetujui hanya bila belum ada VP): menunggu + 60 hari terakhir. */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const approver = await canApproveMargin(user.role);
  if (!approver && user.role !== 'gm') return NextResponse.json({ approvals: [], canApprove: false });
  const rows = await prisma.marginApproval.findMany({
    where: { OR: [{ status: 'menunggu' }, { updatedAt: { gte: new Date(Date.now() - 60 * 86400000) } }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ approvals: rows.map((a) => approvalView(a, canSeeHpp(user.role))), canApprove: approver });
}
