import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_OPTIONS, PAUSED_MESSAGE, SESSION_COOKIE, signSessionToken, toSafeUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { prisma } from '@/lib/prisma';
import { clearFails, lockedFor, recordFail } from '@/lib/rate-limit';

// Tebak password otomatis: 5 gagal per username atau 20 gagal per alamat IP
// dalam 15 menit → dikunci 15 menit (server.js mengisi x-client-ip).
const PER_USER = { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
const PER_IP = { max: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
// Hash palsu supaya waktu jawab sama untuk username yang tidak ada.
const DUMMY_HASH = '$2b$10$ifGx6x9ldYOKpM4y.cq1t.myv0E2gagVqQNhK33Hj30tMnHB89Ta6';

function tooMany(sec: number) {
  const menit = Math.max(1, Math.ceil(sec / 60));
  return NextResponse.json(
    { error: `Terlalu banyak percobaan login yang gagal. Coba lagi dalam ${menit} menit.` },
    { status: 429, headers: { 'Retry-After': String(sec) } },
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!username || !password) {
    return NextResponse.json({ error: 'Username dan password wajib diisi.' }, { status: 400 });
  }

  const ip = req.headers.get('x-client-ip') || 'unknown';
  const userKey = `login:u:${username}`;
  const ipKey = `login:ip:${ip}`;
  const wait = Math.max(lockedFor(userKey), lockedFor(ipKey));
  if (wait) return tooMany(wait);

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) {
    const lock = Math.max(recordFail(userKey, PER_USER), recordFail(ipKey, PER_IP));
    await logActivity({
      user: null,
      username,
      action: 'login_failed',
      entity: 'session',
      summary: `Percobaan login gagal untuk username "${username}"${lock ? ' — dikunci sementara' : ''}`,
    });
    if (lock) return tooMany(lock);
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

  clearFails(userKey);
  const token = await signSessionToken(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, COOKIE_OPTIONS);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
  const safe = toSafeUser(user);
  await logActivity({ user: safe, action: 'login', entity: 'session', summary: `${safe.name} login ke sistem` });
  return NextResponse.json({ user: safe });
}
