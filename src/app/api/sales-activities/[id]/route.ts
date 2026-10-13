import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canWriteSalesActivity, salesActivityScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { syncCustomerPics } from '@/lib/customer-sync';
import { TIPE_KEYS, activityOwner, normalizeActivityPics, validTanggal } from '@/lib/sales-activity';
import { guard } from '@/lib/permissions-server';
import { parseActivityExtras, syncActivityFollowUp } from '@/lib/activity-contact-server';

async function loadOwn(userSe: string, id: string) {
  const existing = await prisma.salesActivity.findUnique({ where: { id } });
  if (!existing) return { error: NextResponse.json({ error: 'Aktivitas tidak ditemukan' }, { status: 404 }) };
  if (existing.se.trim().toLowerCase() !== userSe.trim().toLowerCase()) {
    return { error: NextResponse.json({ error: 'Anda hanya dapat mengubah aktivitas milik sendiri.' }, { status: 403 }) };
  }
  return { existing };
}

/** Satu aktivitas/rencana (dalam cakupan user) — dipakai notifikasi follow-up untuk membuka tanggalnya. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'aktivitas', 'v');
  if (denied) return denied;
  const { id } = await params;
  const activity = await prisma.salesActivity.findFirst({ where: { AND: [await salesActivityScopeWhere(user), { id }] } });
  if (!activity) return NextResponse.json({ error: 'Aktivitas tidak ditemukan atau sudah dihapus' }, { status: 404 });
  return NextResponse.json({ activity });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'aktivitas', 'e');
  if (denied) return denied;
  if (!canWriteSalesActivity(user)) return NextResponse.json({ error: 'Tidak berhak mengubah aktivitas.' }, { status: 403 });
  const { id } = await params;
  const own = await loadOwn(activityOwner(user) || '', id);
  if (own.error) return own.error;
  // Rencana dari jadwal follow-up prospek diselesaikan lewat tombol Selesai;
  // rencana dari hasil kontak (sumber "aktivitas") diselesaikan dengan
  // menyimpannya sebagai aktivitas biasa.
  const completingPlan = own.existing.status === 'rencana' && own.existing.sumber === 'aktivitas';
  if (own.existing.status === 'rencana' && !completingPlan) {
    return NextResponse.json({ error: 'Rencana follow-up diatur dari jadwal follow-up prospek; tandai "Selesai" bila sudah dilakukan.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const tanggal = validTanggal(body?.tanggal);
  if (!tanggal) return NextResponse.json({ error: 'Tanggal tidak valid (tidak boleh lebih dari hari ini).' }, { status: 400 });
  const tipe = String(body?.tipe || '');
  if (!TIPE_KEYS.includes(tipe)) return NextResponse.json({ error: 'Jenis aktivitas tidak valid' }, { status: 400 });
  const customer = String(body?.customer || '').trim();
  if (!customer) return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 });
  const picRes = normalizeActivityPics(body?.pics);
  if ('error' in picRes) return NextResponse.json({ error: picRes.error }, { status: 400 });
  const ex = parseActivityExtras(body, tipe, tanggal, picRes.pics);
  if ('error' in ex) return NextResponse.json({ error: ex.error }, { status: 400 });
  const { followUp, ...extraCols } = ex.extras;
  void followUp;

  const updated = await prisma.salesActivity.update({
    where: { id },
    data: {
      tanggal,
      tipe,
      customer,
      keterangan: String(body?.keterangan || '').trim() || null,
      pics: picRes.pics as unknown as Prisma.InputJsonValue,
      ...extraCols,
      ...(completingPlan ? { status: 'selesai', sumber: null } : {}),
    },
  });
  const followUpId = await syncActivityFollowUp(updated, ex.extras, picRes.pics, user.name || user.username);
  const activity = { ...updated, followUpId };
  await logActivity({ user, action: 'update', entity: 'salesActivity', entityId: id, summary: `Mengubah aktivitas ${tipe} ke "${customer}" (${tanggal})` });
  await syncCustomerPics(user, [{ customer, pics: picRes.pics, cabang: own.existing!.cabang }], 'Aktivitas Harian');
  return NextResponse.json({ activity });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'aktivitas', 'd');
  if (denied) return denied;
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
