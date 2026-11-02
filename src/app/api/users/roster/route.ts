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
    select: { id: true, username: true, name: true, role: true, cabang: true, se: true, pausedAt: true },
    orderBy: { name: 'asc' },
  });
  // Akun dijeda tetap ada di daftar (nama di riwayat tetap terbaca) dan
  // ditandai `paused` supaya tidak dipilih untuk tugas / chat baru.
  return NextResponse.json({ roster: roster.map(({ pausedAt, ...u }) => ({ ...u, paused: !!pausedAt })) });
}
