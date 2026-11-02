import { NextResponse } from 'next/server';
import { toSafeUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/**
 * Admin menjeda / mengaktifkan kembali akun user. Akun yang dijeda tidak bisa
 * login dan sesinya yang masih terbuka langsung ditolak, tetapi akunnya,
 * prospek, customer dan riwayatnya tetap ada (berbeda dengan Hapus).
 * Body: { paused: boolean, reason?: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const pause = body?.paused === true;
  const reason = String(body?.reason || '').trim().slice(0, 200);

  if (pause) {
    if (target.id === user.id) return NextResponse.json({ error: 'Tidak dapat menjeda akun yang sedang login.' }, { status: 400 });
    if (target.pausedAt) return NextResponse.json({ user: toSafeUser(target) });
    if (target.role === 'admin') {
      const activeAdmins = await prisma.user.count({ where: { role: 'admin', pausedAt: null } });
      if (activeAdmins <= 1) return NextResponse.json({ error: 'Tidak dapat menjeda admin aktif terakhir.' }, { status: 400 });
    }
  } else if (!target.pausedAt) {
    return NextResponse.json({ user: toSafeUser(target) });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: pause ? { pausedAt: new Date(), pausedReason: reason || null, pausedBy: user.name } : { pausedAt: null, pausedReason: null, pausedBy: null },
  });

  const safe = toSafeUser(updated);
  // Alasan jeda hanya untuk Admin (lewat respons & GET /api/users), tidak disiarkan.
  emitCrmEvent('user:updated', { ...safe, pausedReason: null, pausedBy: null });
  // Tab yang sedang dibuka user tersebut langsung keluar (lihat useCrmSocket).
  if (pause) emitCrmEvent('user:paused', { id });
  await logActivity({
    user,
    action: 'update',
    entity: 'user',
    entityId: id,
    summary: pause
      ? `Menjeda akun "${target.username}" (${target.name})${reason ? ` — ${reason}` : ''}`
      : `Mengaktifkan kembali akun "${target.username}" (${target.name})`,
    changes: { status: { label: 'Status akun', from: pause ? 'Aktif' : 'Dijeda', to: pause ? 'Dijeda' : 'Aktif' } },
  });
  return NextResponse.json({ user: safe });
}
