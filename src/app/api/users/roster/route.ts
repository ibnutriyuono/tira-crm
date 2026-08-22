import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

/**
 * Minimal team directory for the chat pickers. Separate from /api/users, which
 * is user *management* and stays admin-only — everyone needs to be able to see
 * who they can message, but nobody else needs the management surface.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const roster = await prisma.user.findMany({
    select: { id: true, username: true, name: true, role: true, cabang: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ roster });
}
