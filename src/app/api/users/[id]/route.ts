import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { toSafeUser } from '@/lib/auth';
import { diffFields, logActivity, USER_FIELD_LABELS } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { ActivityChanges } from '@/lib/types';

/**
 * The audit log is readable by more people than the user table is, so a
 * password change is recorded as *that it happened* and never as the hashes
 * themselves — those would otherwise sit in `changes` in plain view.
 */
function redactPassword(changes: ActivityChanges | null): ActivityChanges | null {
  if (!changes?.passwordHash) return changes;
  return { ...changes, passwordHash: { label: 'Password', from: '••••••', to: '•••••• (diubah)' } };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  const role = String(body?.role || target.role);
  if (!name) return NextResponse.json({ error: 'Nama wajib diisi' }, { status: 400 });

  if (target.role === 'admin' && role !== 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) return NextResponse.json({ error: 'Tidak dapat mengubah role admin terakhir' }, { status: 400 });
  }

  const password = String(body?.password || '');
  let passwordHash: string | undefined;
  if (password) {
    if (password.length < 4) return NextResponse.json({ error: 'Password minimal 4 karakter' }, { status: 400 });
    passwordHash = await bcrypt.hash(password, 10);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name,
      role: role as 'admin' | 'gm' | 'rm' | 'bm' | 'sales',
      se: String(body?.se || '').trim().toUpperCase(),
      cabang: String(body?.cabang || '').trim().toUpperCase(),
      reg: body?.reg ? Number(body.reg) : null,
      ...(passwordHash ? { passwordHash } : {}),
    },
  });

  const safe = toSafeUser(updated);
  emitCrmEvent('user:updated', safe);
  await logActivity({
    user,
    action: 'update',
    entity: 'user',
    entityId: safe.id,
    summary: `Mengubah user "${safe.username}" (${safe.name})`,
    changes: redactPassword(diffFields(target, updated, USER_FIELD_LABELS)),
  });
  return NextResponse.json({ user: safe });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { id } = await params;

  if (id === user.id) return NextResponse.json({ error: 'Tidak dapat menghapus akun yang sedang login.' }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
  if (target.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) return NextResponse.json({ error: 'Tidak dapat menghapus admin terakhir.' }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  emitCrmEvent('user:deleted', { id });
  await logActivity({
    user,
    action: 'delete',
    entity: 'user',
    entityId: id,
    summary: `Menghapus user "${target.username}" (${target.name})`,
  });
  return NextResponse.json({ ok: true });
}
