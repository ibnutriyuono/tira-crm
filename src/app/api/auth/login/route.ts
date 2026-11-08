import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_OPTIONS, PAUSED_MESSAGE, SESSION_COOKIE, signSessionToken, toSafeUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
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
    await logActivity({
      user: null,
      username,
      action: 'login_failed',
      entity: 'session',
      summary: `Percobaan login gagal untuk username "${username}"`,
    });
    return NextResponse.json({ error: 'Username atau password salah.' }, { status: 401 });
  }

  // Akun dijeda: password benar pun tidak bisa masuk. Pesan ini hanya muncul
  // setelah password cocok, jadi tidak membocorkan status akun ke orang lain.
  if (user.pausedAt) {
    await logActivity({
      user: null,
      username,
      action: 'login_failed',
      entity: 'session',
      summary: `Login ditolak — akun "${username}" sedang dijeda`,
    });
    return NextResponse.json({ error: PAUSED_MESSAGE, paused: true }, { status: 403 });
  }

  const token = await signSessionToken(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, COOKIE_OPTIONS);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
  const safe = toSafeUser(user);
  await logActivity({ user: safe, action: 'login', entity: 'session', summary: `${safe.name} login ke sistem` });
  return NextResponse.json({ user: safe });
}
