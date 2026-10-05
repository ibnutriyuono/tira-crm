import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { cleanFaktor, cleanLevel } from '@/lib/qcd';
import { deriveFromMaterials, isResponse, num, requireNoPoOnMoveToPo, requireQcdOnClose, requireUser, resolveProspectScope } from '@/lib/api-helpers';
import { canWriteSalesActivity } from '@/lib/auth';
import { activityOwner, formatActivityPics } from '@/lib/sales-activity';
import { ACTIVITY_CONVERT_STATUSES } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Material } from '@/lib/types';

/**
 * "Masukkan ke Pipeline": turns one logged activity into a Prospect at
 * Permintaan (1), Penawaran Harga (2) or PO/Kontrak (4), and links the two in
 * ONE transaction -- if the link failed after the prospect was created, a
 * retry would create a duplicate deal.
 *
 * Same rules as POST /api/prospects (at least one uraian; No. PO required for
 * PO), because this is that write with the customer/se/cabang pre-filled from
 * the activity.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canWriteSalesActivity(user)) return NextResponse.json({ error: 'Tidak berhak memasukkan aktivitas ke pipeline.' }, { status: 403 });
  const { id } = await params;

  const activity = await prisma.salesActivity.findUnique({ where: { id } });
  if (!activity) return NextResponse.json({ error: 'Aktivitas tidak ditemukan' }, { status: 404 });
  if (activity.se.trim().toLowerCase() !== (activityOwner(user) || '').trim().toLowerCase()) {
    return NextResponse.json({ error: 'Anda hanya dapat memproses aktivitas milik sendiri.' }, { status: 403 });
  }
  if (activity.prospectId) return NextResponse.json({ error: 'Aktivitas ini sudah dimasukkan ke pipeline.' }, { status: 409 });

  const body = await req.json().catch(() => null);
  const status = Number(body?.status);
  if (!(ACTIVITY_CONVERT_STATUSES as readonly number[]).includes(status)) {
    return NextResponse.json({ error: 'Status tujuan harus Permintaan, Penawaran Harga, atau PO/Kontrak.' }, { status: 400 });
  }
  const uraian = String(body?.uraian || '').trim();
  if (!uraian) return NextResponse.json({ error: 'Isi uraian material/kebutuhan customer' }, { status: 400 });
  const noPo = String(body?.noPo || '').trim();
  const poErr = requireNoPoOnMoveToPo(null, status, noPo);
  if (poErr) return poErr;
  // Entering PO closes the deal: QCD is mandatory, same as the prospect form and Kanban.
  const qcdErr = requireQcdOnClose(null, status, body || {});
  if (qcdErr) return qcdErr;

  const qty = Math.max(num(body?.qty), 0) || 1;
  const total = Math.max(num(body?.value), 0);
  const materials: Material[] = [{ line: '', uraian, qty, beratPc: 0, hargaKg: 0, harga: total > 0 ? total / qty : 0 }];
  const { reg, cabang } = await resolveProspectScope(user, null);
  const se = activityOwner(user) as string;

  const picText = formatActivityPics(activity.pics as unknown as { nama: string; jabatan: string }[]);
  const picNote = picText ? `PIC: ${picText}` : '';

  const prospect = await prisma.$transaction(async (tx) => {
    const created = await tx.prospect.create({
      data: {
        reg,
        cabang,
        se,
        customer: activity.customer,
        tglPenawaran: activity.tanggal,
        noPo: noPo || null,
        tglPO: status === 4 ? String(body?.tglPO || activity.tanggal) : null,
        ...deriveFromMaterials(materials),
        // PIC yang ditemui ikut terbawa ke prospek supaya tidak hilang di pipeline.
        keterangan: [activity.keterangan || '', picNote].filter(Boolean).join(' | '),
        status,
        ...(status === 4
          ? {
              qcdQualityLevel: cleanLevel(body?.qcdQualityLevel),
              qcdCostLevel: cleanLevel(body?.qcdCostLevel),
              qcdDeliveryLevel: cleanLevel(body?.qcdDeliveryLevel),
              qcdFaktor: cleanFaktor(body?.qcdFaktor),
              qcdQuality: String(body?.qcdQuality || '').trim(),
              qcdCost: String(body?.qcdCost || '').trim(),
              qcdDelivery: String(body?.qcdDelivery || '').trim(),
              qcdKompetitor: String(body?.qcdKompetitor || '').trim(),
              qcdCatatan: String(body?.qcdCatatan || '').trim(),
            }
          : {}),
      },
    });
    await tx.salesActivity.update({ where: { id }, data: { prospectId: created.id } });
    return created;
  });

  emitCrmEvent('prospect:created', prospect);
  await logActivity({
    user,
    action: 'create',
    entity: 'prospect',
    entityId: prospect.id,
    summary: `Memasukkan aktivitas ke pipeline: prospek "${prospect.customer}" (status ${status})`,
  });
  return NextResponse.json({ prospect, activity: { ...activity, prospectId: prospect.id } }, { status: 201 });
}
