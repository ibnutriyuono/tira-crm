import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { itemsHaveLine } from '@/lib/doc-lines';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { notify, requesterUserIds } from '@/lib/notify';

/**
 * Membatalkan FUP A beserta alasannya. Dokumen TIDAK dihapus — statusnya
 * berubah jadi "Dibatalkan" (lihat workflowStage) dan tetap tampil di daftar,
 * supaya riwayat dan alasannya masih bisa ditelusuri.
 *
 * Kirim { reason } untuk membatalkan, atau { undo: true } untuk membatalkan
 * pembatalannya (mis. salah klik).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  // Sejalan dengan hak mengisi jawaban: yang mengerjakan dokumen ini pula
  // yang boleh menghentikannya.
  if (!['purchasing', 'purchasing05', 'admin', 'gm'].includes(user.role)) {
    return NextResponse.json({ error: 'Hanya Purchasing, GM, atau Admin yang dapat membatalkan FUP A.' }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.fupa.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });
  if (user.role === 'purchasing05' && !itemsHaveLine(existing.items)) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);

  if (body?.undo === true) {
    if (!existing.cancelledAt) return NextResponse.json({ error: 'FUP A ini tidak dalam status dibatalkan.' }, { status: 400 });
    const fupa = await prisma.fupa.update({
      where: { id },
      data: { cancelledAt: null, cancelledBy: null, cancelReason: null },
    });
    emitCrmEvent('fupa:updated', fupa);
    await logActivity({
      user,
      action: 'update',
      entity: 'fupa',
      entityId: id,
      summary: `Mengaktifkan kembali FUP A ${existing.noFupa || '(tanpa nomor)'} yang sebelumnya dibatalkan`,
    });
    return NextResponse.json({ fupa });
  }

  const reason = String(body?.reason || '').trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: 'Alasan pembatalan wajib diisi (minimal 5 karakter).' }, { status: 400 });
  }
  if (existing.cancelledAt) return NextResponse.json({ error: 'FUP A ini sudah dibatalkan.' }, { status: 400 });

  const fupa = await prisma.fupa.update({
    where: { id },
    data: { cancelledAt: new Date(), cancelledBy: user.name || user.username, cancelReason: reason },
  });

  emitCrmEvent('fupa:updated', fupa);
  await logActivity({
    user,
    action: 'update',
    entity: 'fupa',
    entityId: id,
    summary: `Membatalkan FUP A ${existing.noFupa || '(tanpa nomor)'} untuk "${existing.customer || '-'}" — alasan: ${reason}`,
  });
  await notify({
    userIds: await requesterUserIds(fupa.requestedBy),
    type: 'fupa_cancelled',
    entity: 'fupa',
    entityId: id,
    title: 'FUP A dibatalkan',
    message: `${fupa.noFupa || '(tanpa nomor)'} untuk "${fupa.customer || '-'}" — alasan: ${reason}`,
  });
  return NextResponse.json({ fupa });
}
