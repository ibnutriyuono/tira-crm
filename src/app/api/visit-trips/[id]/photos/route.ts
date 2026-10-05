import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { visitTripScopeWhere } from '@/lib/auth';
import { ATTACHMENT_MAX_BYTES } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { buildKey, isS3Configured, putObject } from '@/lib/s3';
import type { TripVisit } from '@/lib/types';
import { TRIP_PHOTO_MAX_PER_VISIT, TRIP_PHOTO_TYPES, canEditRealisasi } from '@/lib/visit-trip';

/** Photos of one trip, for anyone who can see the trip. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const trip = await prisma.visitTrip.findFirst({ where: { AND: [visitTripScopeWhere(user), { id }] }, select: { id: true } });
  if (!trip) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });
  const photos = await prisma.tripPhoto.findMany({ where: { tripId: id }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ photos });
}

/**
 * Upload one photo for one visit. Only the trip owner, while filling in
 * realisasi (status Disetujui) -- the same window in which realisasi text can
 * change, so a finished report's evidence can't be swapped afterwards.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!isS3Configured()) return NextResponse.json({ error: 'Penyimpanan file belum dikonfigurasi. Hubungi admin.' }, { status: 503 });
  const { id } = await params;
  const trip = await prisma.visitTrip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });
  if (!canEditRealisasi(user, trip)) return NextResponse.json({ error: 'Foto hanya dapat ditambahkan pemilik saat mengisi realisasi.' }, { status: 403 });

  const max = ATTACHMENT_MAX_BYTES;
  if (Number(req.headers.get('content-length') || 0) > max) return NextResponse.json({ error: `Foto melebihi batas ${Math.round(max / 1024 / 1024)}MB.` }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Gagal membaca file.' }, { status: 413 });
  }
  const file = form.get('file');
  const visitId = String(form.get('visitId') || '');
  if (!(file instanceof File)) return NextResponse.json({ error: 'File tidak ditemukan.' }, { status: 400 });
  if (!TRIP_PHOTO_TYPES.includes(file.type)) return NextResponse.json({ error: 'Hanya foto JPG, PNG, atau WEBP.' }, { status: 400 });
  if (file.size > max) return NextResponse.json({ error: `Foto melebihi batas ${Math.round(max / 1024 / 1024)}MB.` }, { status: 413 });
  const visit = (trip.visits as unknown as TripVisit[]).find((v) => v.id === visitId);
  if (!visit) return NextResponse.json({ error: 'Kunjungan tidak ditemukan. Simpan realisasi dulu bila kunjungan baru ditambahkan.' }, { status: 400 });
  const count = await prisma.tripPhoto.count({ where: { tripId: id, visitId } });
  if (count >= TRIP_PHOTO_MAX_PER_VISIT) return NextResponse.json({ error: `Maksimal ${TRIP_PHOTO_MAX_PER_VISIT} foto per kunjungan.` }, { status: 400 });

  const key = buildKey('trip', id, file.name || 'foto.jpg');
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return NextResponse.json({ error: 'Gagal mengunggah foto. Coba lagi.' }, { status: 502 });
  }
  const photo = await prisma.tripPhoto.create({
    data: { tripId: id, visitId, name: file.name || 'foto.jpg', type: file.type, size: file.size, key, uploadedBy: user.name || user.username },
  });
  await logActivity({ user, action: 'create', entity: 'visitTrip', entityId: id, summary: `Menambah foto kunjungan "${visit.customer}" (${trip.cabang}, ${trip.tglBerangkat})` });
  return NextResponse.json({ photo }, { status: 201 });
}
