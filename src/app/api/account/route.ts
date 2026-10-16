import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { toSafeUser } from '@/lib/auth';
import { passwordError, renameUsernameEverywhere, usernameError } from '@/lib/account-server';
import { validEmail } from '@/lib/notif-prefs';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/**
 * Akun Saya — setiap role mengubah akunnya sendiri: username, password, email.
 * Nama, role, cabang tetap diatur Admin. Wajib password saat ini, kecuali
 * baru direset Admin (mustChangePassword) dan yang diubah hanya password.
 * Setiap perubahan tercatat di Log Aktivitas (tanpa nilai password).
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const me = await prisma.user.findUnique({ where: { id: user.id } });
  if (!me) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? me.username).trim().toLowerCase();
  const email = String(body?.email ?? me.email ?? '').trim().toLowerCase();
  const newPassword = String(body?.newPassword || '');
  const current = String(body?.currentPassword || '');

  const forced = me.mustChangePassword;
  if (forced && !newPassword) return NextResponse.json({ error: 'Buat password baru terlebih dahulu' }, { status: 400 });
  const onlyPassword = username === me.username && email === (me.email || '');
  if (!(forced && onlyPassword)) {
    if (!current || !(await bcrypt.compare(current, me.passwordHash))) return NextResponse.json({ error: 'Password saat ini salah' }, { status: 400 });
  }

  const changes: Record<string, { label: string; from: unknown; to: unknown }> = {};
  const data: Record<string, unknown> = {};
  if (username !== me.username) {
    const err = usernameError(username);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    if (await prisma.user.findUnique({ where: { username } })) return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 });
    changes.username = { label: 'Username', from: me.username, to: username };
  }
  if (email !== (me.email || '')) {
    if (email && !validEmail(email)) return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
    data.email = email || null;
    changes.email = { label: 'Email', from: me.email || '-', to: email || '-' };
  }
  if (newPassword) {
    const err = passwordError(newPassword);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    if (await bcrypt.compare(newPassword, me.passwordHash)) return NextResponse.json({ error: 'Password baru tidak boleh sama dengan yang lama' }, { status: 400 });
    data.passwordHash = await bcrypt.hash(newPassword, 10);
    data.mustChangePassword = false;
    changes.password = { label: 'Password', from: '•••', to: forced ? 'diganti (setelah reset Admin)' : 'diganti' };
  }
  if (Object.keys(changes).length === 0) return NextResponse.json({ user: toSafeUser(me) });

  if (Object.keys(data).length) await prisma.user.update({ where: { id: me.id }, data });
  if (changes.username) await renameUsernameEverywhere(me.username, username, me.id);
  const updated = await prisma.user.findUnique({ where: { id: me.id } });
  const safe = toSafeUser(updated!);
  emitCrmEvent('user:updated', safe);
  await logActivity({
    user,
    action: 'update',
    entity: 'user',
    entityId: me.id,
    summary: `Akun Saya: ${me.name} mengubah ${Object.values(changes).map((c) => c.label.toLowerCase()).join(', ')}`,
    changes,
  });
  return NextResponse.json({ user: safe });
}
