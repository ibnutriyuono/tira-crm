import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { kandidat, scopeFilter, toKontrak } from '@/lib/kontrak-server';

/** Cari realisasi: item prospek PO/DO yang cocok dengan kontrak tetapi belum terhubung. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'v');
  if (denied) return denied;
  const { id } = await params;
  const row = await prisma.kontrak.findUnique({ where: { id }, include: { items: true } });
  if (!row) return NextResponse.json({ error: 'Kontrak tidak ditemukan' }, { status: 404 });
  const k = toKontrak(row);
  if (!(await scopeFilter(user))(k)) return NextResponse.json({ error: 'Kontrak di luar cakupan Anda' }, { status: 403 });
  const { rows, mirip } = await kandidat(k);
  return NextResponse.json({ rows, mirip });
}
