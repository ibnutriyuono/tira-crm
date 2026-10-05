import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap, visitTripScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parsePicText, syncCustomerPics } from '@/lib/customer-sync';
import { TRIP_ROLES, normalizePlanVisits, validateTripHeader } from '@/lib/visit-trip';

/** GET ?periode=YYYY-MM (optional): trips whose departure falls in that month. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const periode = new URL(req.url).searchParams.get('periode') || '';
  if (periode && !/^\d{4}-\d{2}$/.test(periode)) return NextResponse.json({ error: 'Periode harus YYYY-MM' }, { status: 400 });
  const trips = await prisma.visitTrip.findMany({
    where: { AND: [visitTripScopeWhere(user), periode ? { tglBerangkat: { startsWith: periode } } : {}] },
    orderBy: [{ tglBerangkat: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ trips });
}

/** Create a draft trip. Only GM / RM / BM plan trips; a BM's destination is locked to their own branch. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!TRIP_ROLES.includes(user.role)) return NextResponse.json({ error: 'Hanya GM, RM, dan BM yang membuat rencana perjalanan.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const cabang = (user.role === 'bm' ? user.cabang || '' : String(body?.cabang || '')).trim().toUpperCase();
  const tglBerangkat = String(body?.tglBerangkat || '').trim();
  const tglPulang = String(body?.tglPulang || '').trim();
  const headerErr = validateTripHeader({ cabang, tglBerangkat, tglPulang });
  if (headerErr) return NextResponse.json({ error: headerErr }, { status: 400 });
  const plan = normalizePlanVisits(body?.visits, tglBerangkat, tglPulang, randomUUID);
  if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 });

  const map = await cabangRegMap();
  const ownerCabang = (user.cabang || '').toUpperCase() || null;
  const ownerReg = user.reg ?? (ownerCabang ? map[ownerCabang] ?? null : null);
  const trip = await prisma.visitTrip.create({
    data: {
      ownerId: user.id,
      ownerName: user.name || user.username,
      ownerRole: user.role,
      ownerCabang,
      ownerReg,
      cabang,
      reg: map[cabang] ?? null,
      tglBerangkat,
      tglPulang,
      keperluan: String(body?.keperluan || '').trim().slice(0, 1000) || null,
      visits: plan.visits as unknown as Prisma.InputJsonValue,
    },
  });
  await logActivity({ user, action: 'create', entity: 'visitTrip', entityId: trip.id, summary: `Membuat rencana perjalanan ke ${cabang} (${tglBerangkat} s/d ${tglPulang}), ${plan.visits.length} kunjungan` });
  await syncCustomerPics(user, plan.visits.map((v) => ({ customer: v.customer, pics: parsePicText(v.pic), cabang })), 'Perjalanan Dinas');
  return NextResponse.json({ trip }, { status: 201 });
}
