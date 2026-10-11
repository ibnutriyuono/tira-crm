import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canManageKam } from '@/lib/kam';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { KamTeam } from '@/lib/types';

const KEY = 'kamTeam';
const EMPTY: KamTeam = { sponsorId: null, ketuaId: null, sekretarisId: null, anggotaIds: [] };
const id = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);

/** Tim KAM nasional: sponsor, ketua, sekretaris, anggota (user ids). */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return NextResponse.json({ team: { ...EMPTY, ...((row?.value as unknown as KamTeam) || {}) } });
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canManageKam(user.role)) return NextResponse.json({ error: 'Hanya GM, RM dan Admin yang dapat mengatur tim KAM.' }, { status: 403 });
  const b = await req.json().catch(() => null);
  const team: KamTeam = {
    sponsorId: id(b?.sponsorId),
    ketuaId: id(b?.ketuaId),
    sekretarisId: id(b?.sekretarisId),
    anggotaIds: Array.from(new Set((Array.isArray(b?.anggotaIds) ? b.anggotaIds : []).map(id).filter(Boolean) as string[])).slice(0, 50),
  };
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: team as unknown as object }, update: { value: team as unknown as object } });
  emitCrmEvent('kamTeam:updated', team);
  await logActivity({ user, action: 'update', entity: 'customerGroup', summary: 'Mengubah susunan Tim KAM nasional' });
  return NextResponse.json({ team });
}
