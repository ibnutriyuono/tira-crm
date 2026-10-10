import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import type { SafeUser } from './types';

/** Loads a prospect and checks the caller may change it (own SE / cabang / regional). */
export async function assertProspectInScope(user: SafeUser, id: string) {
  const existing = await prisma.prospect.findUnique({ where: { id } });
  if (!existing) return { error: NextResponse.json({ error: 'Prospek tidak ditemukan' }, { status: 404 }) };
  if (user.role === 'sales' && (existing.se || '').toUpperCase() !== (user.se || '').toUpperCase()) {
    return { error: NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 }) };
  }
  if (user.role === 'bm' && (existing.cabang || '').toUpperCase() !== (user.cabang || '').toUpperCase()) {
    return { error: NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 }) };
  }
  if (user.role === 'rm' && String(existing.reg || '') !== String(user.reg || '')) {
    return { error: NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 }) };
  }
  return { existing };
}
