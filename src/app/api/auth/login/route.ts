import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_OPTIONS, SESSION_COOKIE, signSessionToken, toSafeUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!username || !password) {
    return NextResponse.json({ error: 'Username dan password wajib diisi.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: 'Username atau password salah.' }, { status: 401 });
  }

  const token = await signSessionToken(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, COOKIE_OPTIONS);

  return NextResponse.json({ user: toSafeUser(user) });
}
