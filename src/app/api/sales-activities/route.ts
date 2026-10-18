import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser, resolveProspectScope } from '@/lib/api-helpers';
import { canWriteSalesActivity, salesActivityScopeWhere } from '@/lib/auth';
import { TIPE_KEYS, activityOwner, normalizeActivityPics, validTanggal } from '@/lib/sales-activity';
import { prisma } from '@/lib/prisma';
import { syncCustomerPics } from '@/lib/customer-sync';
import { guard } from '@/lib/permissions-server';
import { parseActivityExtras, syncActivityFollowUp } from '@/lib/activity-contact-server';

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'aktivitas', 'v');
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  // ?all=1 -> every activity this role can see (Export Semua); otherwise one month.
  const all = params.get('all') === '1';
  const periode = params.get('periode') || new Date().toISOString().slice(0, 7);
  if (!all && !/^\d{4}-\d{2}$/.test(periode)) return NextResponse.json({ error: 'Periode harus YYYY-MM' }, { status: 400 });

  const activities = await prisma.salesActivity.findMany({
    where: { AND: [await salesActivityScopeWhere(user), all ? {} : { tanggal: { startsWith: periode } }] },
    orderBy: [{ tanggal: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ activities });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'aktivitas', 'e');
  if (denied) return denied;
  if (!canWriteSalesActivity(user)) {
    return NextResponse.json({ error: 'Akun ini belum memiliki identitas aktivitas (username / Kode SE).' }, { status: 403 });
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

  // se / cabang / reg always come from the account, never the request.
  const { reg, cabang } = await resolveProspectScope(user, null);
  const se = activityOwner(user) as string;
  const activity = await prisma.salesActivity.create({
    data: {
      tanggal,
      se,
      cabang: cabang || null,
      reg,
      tipe,
      customer,
      keterangan: String(body?.keterangan || '').trim() || null,
      pics: picRes.pics as unknown as Prisma.InputJsonValue,
      ...extraCols,
      createdBy: user.name || user.username,
    },
  });
  const followUpId = await syncActivityFollowUp(activity, ex.extras, picRes.pics, user.name || user.username);
  void followUp;

  await logActivity({
    user,
    action: 'create',
    entity: 'salesActivity',
    entityId: activity.id,
    summary: `Mengisi aktivitas ${tipe} ke "${customer}" (${tanggal})`,
  });
  await syncCustomerPics(user, [{ customer, pics: picRes.pics, cabang }], 'Aktivitas Harian');
  return NextResponse.json({ activity: { ...activity, followUpId }, followUpCreated: !!followUpId }, { status: 201 });
}
