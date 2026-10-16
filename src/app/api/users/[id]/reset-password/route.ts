import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { tempPassword } from '@/lib/account-server';
import { prisma } from '@/lib/prisma';

/**
 * Admin mereset password user: dibuat password sementara (dikembalikan SEKALI
 * di respons ini, tidak disimpan terbaca), user wajib menggantinya saat login.
 * Password user tidak pernah bisa dilihat, termasuk oleh Admin.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });

  const password = tempPassword();
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: target.id !== user.id } });
  await logActivity({
    user,
    action: 'update',
    entity: 'user',
    entityId: id,
    summary: `Reset password ${target.name} (${target.username}) — password sementara, wajib diganti saat login`,
    changes: { password: { label: 'Password', from: '•••', to: 'direset (sementara)' } },
  });
  return NextResponse.json({ password, username: target.username, name: target.name });
}
