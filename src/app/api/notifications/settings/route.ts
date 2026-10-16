import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { mailStatus, sendTestEmail } from '@/lib/email-notify';
import { normalizePrefs, validEmail } from '@/lib/notif-prefs';

/** Pengaturan notifikasi email milik user yang login (+ status server email untuk Admin). */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, notifPrefs: true } });
  const status = await mailStatus();
  return NextResponse.json({
    email: row?.email || '',
    prefs: normalizePrefs(row?.notifPrefs),
    mail: user.role === 'admin' ? status : { configured: status.configured, cap: status.cap },
  });
}

/** Simpan email & pengaturan: { email, prefs }. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email && !validEmail(email)) return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
  const prefs = normalizePrefs(body?.prefs);
  await prisma.user.update({ where: { id: user.id }, data: { email: email || null, notifPrefs: prefs as never } });
  return NextResponse.json({ email, prefs });
}

/** Kirim email uji ke alamat yang tersimpan: { test: true }. */
export async function POST() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
  const to = (row?.email || '').trim();
  if (!validEmail(to)) return NextResponse.json({ error: 'Simpan alamat email yang valid terlebih dahulu' }, { status: 400 });
  const r = await sendTestEmail(user, to);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, to });
}
