import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { visitTripScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteObject, isS3Configured, presignGet } from '@/lib/s3';
import { canEditRealisasi } from '@/lib/visit-trip';

/** Redirects to a short-lived URL for the photo (inline, so it renders in <img> and in the printed report). Scoped to the trip. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!isS3Configured()) return NextResponse.json({ error: 'Penyimpanan file belum dikonfigurasi.' }, { status: 503 });
  const { id, photoId } = await params;
  const trip = await prisma.visitTrip.findFirst({ where: { AND: [visitTripScopeWhere(user), { id }] }, select: { id: true } });
  if (!trip) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });
  const photo = await prisma.tripPhoto.findFirst({ where: { id: photoId, tripId: id } });
  if (!photo) return NextResponse.json({ error: 'Foto tidak ditemukan' }, { status: 404 });
  try {
    return NextResponse.redirect(await presignGet(photo.key, photo.name, 600, true), 302);
  } catch {
    return NextResponse.json({ error: 'Gagal membuat tautan foto.' }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id, photoId } = await params;
  const trip = await prisma.visitTrip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });
  if (!canEditRealisasi(user, trip)) return NextResponse.json({ error: 'Foto hanya dapat dihapus pemilik saat mengisi realisasi.' }, { status: 403 });
  const photo = await prisma.tripPhoto.findFirst({ where: { id: photoId, tripId: id } });
  if (!photo) return NextResponse.json({ error: 'Foto tidak ditemukan' }, { status: 404 });
  try {
    await deleteObject(photo.key);
  } catch {
    // a stray object is cheaper than a row pointing at nothing
  }
  await prisma.tripPhoto.delete({ where: { id: photoId } });
  await logActivity({ user, action: 'delete', entity: 'visitTrip', entityId: id, summary: `Menghapus foto kunjungan "${photo.name}"` });
  return NextResponse.json({ ok: true });
}
