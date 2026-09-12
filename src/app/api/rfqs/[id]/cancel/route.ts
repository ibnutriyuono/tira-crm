import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { notify, requesterUserIds } from '@/lib/notify';

/**
 * Membatalkan RFQ beserta alasannya. Dokumen TIDAK dihapus — statusnya
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
  if (!['purchasing', 'admin', 'gm'].includes(user.role)) {
    return NextResponse.json({ error: 'Hanya Purchasing, GM, atau Admin yang dapat membatalkan RFQ.' }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.rfq.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);

  if (body?.undo === true) {
    if (!existing.cancelledAt) return NextResponse.json({ error: 'RFQ ini tidak dalam status dibatalkan.' }, { status: 400 });
    const rfq = await prisma.rfq.update({
      where: { id },
      data: { cancelledAt: null, cancelledBy: null, cancelReason: null },
    });
    emitCrmEvent('rfq:updated', rfq);
    await logActivity({
      user,
      action: 'update',
      entity: 'rfq',
      entityId: id,
      summary: `Mengaktifkan kembali RFQ ${existing.noRfq || '(tanpa nomor)'} yang sebelumnya dibatalkan`,
    });
    return NextResponse.json({ rfq });
  }

  const reason = String(body?.reason || '').trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: 'Alasan pembatalan wajib diisi (minimal 5 karakter).' }, { status: 400 });
  }
  if (existing.cancelledAt) return NextResponse.json({ error: 'RFQ ini sudah dibatalkan.' }, { status: 400 });

  const rfq = await prisma.rfq.update({
    where: { id },
    data: { cancelledAt: new Date(), cancelledBy: user.name || user.username, cancelReason: reason },
  });

  emitCrmEvent('rfq:updated', rfq);
  await logActivity({
    user,
    action: 'update',
    entity: 'rfq',
    entityId: id,
    summary: `Membatalkan RFQ ${existing.noRfq || '(tanpa nomor)'} untuk "${existing.customer || '-'}" — alasan: ${reason}`,
  });
  await notify({
    userIds: await requesterUserIds(rfq.requestedBy),
    type: 'rfq_cancelled',
    entity: 'rfq',
    entityId: id,
    title: 'RFQ dibatalkan',
    message: `${rfq.noRfq || '(tanpa nomor)'} untuk "${rfq.customer || '-'}" — alasan: ${reason}`,
  });
  return NextResponse.json({ rfq });
}
