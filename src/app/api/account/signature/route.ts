import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { toSafeUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/** Batas ukuran PNG tanda tangan (sudah dipangkas & diperkecil di browser). */
const MAX_BYTES = 300 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Tanda tangan milik user yang login (Akun Saya), dipakai otomatis di surat
 * penawaran. Hanya pemiliknya yang bisa membaca / mengubah.
 * GET -> image/png · PUT { png: "data:image/png;base64,..." } · DELETE
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const row = await prisma.userSignature.findUnique({ where: { userId: user.id } });
  if (!row) return NextResponse.json({ error: 'Belum ada tanda tangan' }, { status: 404 });
  return new NextResponse(new Uint8Array(row.png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await req.json().catch(() => null);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.png || ''));
  if (!m) return NextResponse.json({ error: 'Format tanda tangan harus PNG' }, { status: 400 });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || PNG_MAGIC.some((b, i) => buf[i] !== b)) return NextResponse.json({ error: 'File tanda tangan tidak valid' }, { status: 400 });
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: 'Gambar tanda tangan terlalu besar (maks. 300 KB)' }, { status: 400 });

  const had = !!(await prisma.userSignature.findUnique({ where: { userId: user.id }, select: { userId: true } }));
  await prisma.userSignature.upsert({ where: { userId: user.id }, create: { userId: user.id, png: buf }, update: { png: buf } });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { signatureAt: new Date() } });
  const safe = toSafeUser(updated);
  emitCrmEvent('user:updated', safe);
  await logActivity({ user, action: 'update', entity: 'user', entityId: user.id, summary: `Akun Saya: ${user.name} ${had ? 'mengganti' : 'menambahkan'} tanda tangan` });
  return NextResponse.json({ user: safe });
}

export async function DELETE() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  await prisma.userSignature.deleteMany({ where: { userId: user.id } });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { signatureAt: null } });
  const safe = toSafeUser(updated);
  emitCrmEvent('user:updated', safe);
  await logActivity({ user, action: 'update', entity: 'user', entityId: user.id, summary: `Akun Saya: ${user.name} menghapus tanda tangan` });
  return NextResponse.json({ user: safe });
}
