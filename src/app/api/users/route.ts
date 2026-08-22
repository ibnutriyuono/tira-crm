import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { toSafeUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Role } from '@/lib/types';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ users: users.map(toSafeUser) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const body = await req.json().catch(() => null);
  const username = String(body?.username || '').trim().toLowerCase();
  const name = String(body?.name || '').trim();
  const role = String(body?.role || 'sales');
  const password = String(body?.password || '');

  if (!username || !name) return NextResponse.json({ error: 'Username dan nama wajib diisi' }, { status: 400 });
  if (!password || password.length < 4) return NextResponse.json({ error: 'Password wajib diisi (minimal 4 karakter)' }, { status: 400 });

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 });

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: {
      username,
      name,
      role: role as Role,
      se: String(body?.se || '').trim().toUpperCase(),
      cabang: String(body?.cabang || '').trim().toUpperCase(),
      reg: body?.reg ? Number(body.reg) : null,
      passwordHash,
    },
  });

  const safe = toSafeUser(created);
  emitCrmEvent('user:created', safe);
  await logActivity({
    user,
    action: 'create',
    entity: 'user',
    entityId: safe.id,
    summary: `Menambah user "${safe.username}" (${safe.name}) dengan role ${safe.role}`,
  });
  return NextResponse.json({ user: safe }, { status: 201 });
}
