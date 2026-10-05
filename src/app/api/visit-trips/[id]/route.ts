import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap, visitTripScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parsePicText, syncCustomerPics } from '@/lib/customer-sync';
import { deleteObject } from '@/lib/s3';
import type { TripVisit } from '@/lib/types';
import { canEditPlan, canEditRealisasi, mergeRealisasi, normalizePlanVisits, validateTripHeader } from '@/lib/visit-trip';

/** One trip, within the viewer's scope -- used when opening a trip from a notification. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const trip = await prisma.visitTrip.findFirst({ where: { AND: [visitTripScopeWhere(user), { id }] } });
  if (!trip) return NextResponse.json({ error: 'Perjalanan tidak ditemukan atau di luar akses Anda' }, { status: 404 });
  return NextResponse.json({ trip });
}

/**
 * Two kinds of edit, decided by the trip's status:
 * - draft / ditolak: the owner rewrites the plan (header + visits);
 * - disetujui: the owner fills in realisasi (and may add unplanned visits),
 *   but the approved plan itself stays as approved.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const existing = await prisma.visitTrip.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });
  const body = await req.json().catch(() => null);

  if (canEditPlan(user, existing)) {
    const cabang = (user.role === 'bm' ? existing.cabang : String(body?.cabang || '')).trim().toUpperCase();
    const tglBerangkat = String(body?.tglBerangkat || '').trim();
    const tglPulang = String(body?.tglPulang || '').trim();
    const headerErr = validateTripHeader({ cabang, tglBerangkat, tglPulang });
    if (headerErr) return NextResponse.json({ error: headerErr }, { status: 400 });
    const plan = normalizePlanVisits(body?.visits, tglBerangkat, tglPulang, randomUUID);
    if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 });
    const map = await cabangRegMap();
    const trip = await prisma.visitTrip.update({
      where: { id },
      data: {
        cabang,
        reg: map[cabang] ?? null,
        tglBerangkat,
        tglPulang,
        keperluan: String(body?.keperluan || '').trim().slice(0, 1000) || null,
        visits: plan.visits as unknown as Prisma.InputJsonValue,
      },
    });
    await logActivity({ user, action: 'update', entity: 'visitTrip', entityId: id, summary: `Mengubah rencana perjalanan ke ${cabang} (${tglBerangkat})` });
    await syncCustomerPics(user, plan.visits.map((v) => ({ customer: v.customer, pics: parsePicText(v.pic), cabang })), 'Perjalanan Dinas');
    return NextResponse.json({ trip });
  }

  if (canEditRealisasi(user, existing)) {
    const merged = mergeRealisasi(existing.visits as unknown as TripVisit[], body?.visits, randomUUID);
    if ('error' in merged) return NextResponse.json({ error: merged.error }, { status: 400 });
    const trip = await prisma.visitTrip.update({
      where: { id },
      data: {
        visits: merged.visits as unknown as Prisma.InputJsonValue,
        catatanRealisasi: String(body?.catatanRealisasi || '').trim().slice(0, 2000) || null,
      },
    });
    // A removed "di luar rencana" visit takes its photos with it.
    const keep = merged.visits.map((v) => v.id);
    const orphans = await prisma.tripPhoto.findMany({ where: { tripId: id, visitId: { notIn: keep } } });
    if (orphans.length) {
      await Promise.all(orphans.map((o) => deleteObject(o.key).catch(() => {})));
      await prisma.tripPhoto.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
    }
    await logActivity({ user, action: 'update', entity: 'visitTrip', entityId: id, summary: `Mengisi realisasi perjalanan ke ${existing.cabang} (${existing.tglBerangkat})` });
    await syncCustomerPics(user, merged.visits.map((v) => ({ customer: v.customer, pics: parsePicText(v.pic), cabang: existing.cabang })), 'Perjalanan Dinas');
    return NextResponse.json({ trip });
  }

  return NextResponse.json({ error: 'Perjalanan ini tidak dapat diubah pada status sekarang.' }, { status: 403 });
}

/** Only an owner's draft can be deleted; anything submitted is cancelled instead, so the record stays. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const existing = await prisma.visitTrip.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });
  if (existing.ownerId !== user.id || existing.status !== 'draft') {
    return NextResponse.json({ error: 'Hanya draft milik sendiri yang dapat dihapus. Gunakan Batalkan untuk yang sudah diajukan.' }, { status: 403 });
  }
  await prisma.visitTrip.delete({ where: { id } });
  await logActivity({ user, action: 'delete', entity: 'visitTrip', entityId: id, summary: `Menghapus draft perjalanan ke ${existing.cabang} (${existing.tglBerangkat})` });
  return NextResponse.json({ ok: true });
}
