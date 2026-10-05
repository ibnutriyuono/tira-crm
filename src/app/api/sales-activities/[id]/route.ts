import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canWriteSalesActivity } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { syncCustomerPics } from '@/lib/customer-sync';
import { TIPE_KEYS, activityOwner, normalizeActivityPics, validTanggal } from '@/lib/sales-activity';

async function loadOwn(userSe: string, id: string) {
  const existing = await prisma.salesActivity.findUnique({ where: { id } });
  if (!existing) return { error: NextResponse.json({ error: 'Aktivitas tidak ditemukan' }, { status: 404 }) };
  if (existing.se.trim().toLowerCase() !== userSe.trim().toLowerCase()) {
    return { error: NextResponse.json({ error: 'Anda hanya dapat mengubah aktivitas milik sendiri.' }, { status: 403 }) };
  }
  return { existing };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canWriteSalesActivity(user)) return NextResponse.json({ error: 'Tidak berhak mengubah aktivitas.' }, { status: 403 });
  const { id } = await params;
  const own = await loadOwn(activityOwner(user) || '', id);
  if (own.error) return own.error;

  const body = await req.json().catch(() => null);
  const tanggal = validTanggal(body?.tanggal);
  if (!tanggal) return NextResponse.json({ error: 'Tanggal tidak valid (tidak boleh lebih dari hari ini).' }, { status: 400 });
  const tipe = String(body?.tipe || '');
  if (!TIPE_KEYS.includes(tipe)) return NextResponse.json({ error: 'Jenis aktivitas tidak valid' }, { status: 400 });
  const customer = String(body?.customer || '').trim();
  if (!customer) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });
  const picRes = normalizeActivityPics(body?.pics);
  if ('error' in picRes) return NextResponse.json({ error: picRes.error }, { status: 400 });

  const activity = await prisma.salesActivity.update({
    where: { id },
    data: { tanggal, tipe, customer, keterangan: String(body?.keterangan || '').trim() || null, pics: picRes.pics as unknown as Prisma.InputJsonValue },
  });
  await logActivity({ user, action: 'update', entity: 'salesActivity', entityId: id, summary: `Mengubah aktivitas ${tipe} ke "${customer}" (${tanggal})` });
  await syncCustomerPics(user, [{ customer, pics: picRes.pics, cabang: own.existing!.cabang }], 'Aktivitas Harian');
  return NextResponse.json({ activity });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canWriteSalesActivity(user)) return NextResponse.json({ error: 'Tidak berhak menghapus aktivitas.' }, { status: 403 });
  const { id } = await params;
  const own = await loadOwn(activityOwner(user) || '', id);
  if (own.error) return own.error;
  // A converted activity is the origin of a pipeline record; deleting it would
  // orphan that link and silently lower the KPI the deal already earned.
  if (own.existing.prospectId) {
    return NextResponse.json({ error: 'Aktivitas ini sudah masuk pipeline dan tidak dapat dihapus.' }, { status: 409 });
  }
  await prisma.salesActivity.delete({ where: { id } });
  await logActivity({ user, action: 'delete', entity: 'salesActivity', entityId: id, summary: `Menghapus aktivitas ${own.existing.tipe} ke "${own.existing.customer}"` });
  return NextResponse.json({ ok: true });
}
