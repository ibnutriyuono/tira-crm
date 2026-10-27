import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { guard } from '@/lib/permissions-server';
import { quotePermAct } from '@/lib/roles';
import { assertProspectInScope } from '@/lib/prospect-access';
import { checkQuoteMargins, marginApproverIds } from '@/lib/margin-check';
import { cleanQuoteItems, marginStatus } from '@/lib/margin-server';
import { getOpsRules } from '@/lib/ops-escalation';
import { notify } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { logActivity } from '@/lib/activity';
import type { Prisma } from '@prisma/client';

/**
 * Cek margin Surat Penawaran: { prospectId, items } → item di bawah batas &
 * status persetujuan VP. { ..., ajukan: true, alasan, nomor } mengajukan
 * persetujuan ke VP.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', quotePermAct(user.role));
  if (denied) return denied;
  const body = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const prospectId = String(body.prospectId || '').slice(0, 64);
  if (!prospectId) return NextResponse.json({ error: 'Prospek wajib.' }, { status: 400 });
  const scoped = await assertProspectInScope(user, prospectId);
  if (scoped.error) return scoped.error;
  const items = cleanQuoteItems(body.items);
  const status = await marginStatus(user, prospectId, items);
  if (!body.ajukan) return NextResponse.json(status);

  if (!status.needs) return NextResponse.json(status);
  if (status.approval?.status === 'menunggu') return NextResponse.json({ error: 'Persetujuan untuk harga ini sudah diajukan dan menunggu VP.' }, { status: 409 });
  const alasan = String(body.alasan || '').trim().slice(0, 500);
  if (alasan.length < 5) return NextResponse.json({ error: 'Tulis alasan harga di bawah margin (min. 5 karakter).' }, { status: 400 });
  const p = scoped.existing!;
  const rules = await getOpsRules();
  const lines = await checkQuoteMargins(prospectId, items, rules.marginMin);
  const snap = lines.map((l) => ({ ...l, uraian: items[l.idx]?.uraian || '' }));
  const a = await prisma.marginApproval.create({
    data: {
      prospectId,
      customer: p.customer || '-',
      cabang: p.cabang,
      se: p.se,
      nomor: String(body.nomor || '').slice(0, 80) || null,
      items: snap as unknown as Prisma.InputJsonValue,
      priceKey: status.key,
      minMargin: rules.marginMin,
      alasan,
      requestedById: user.id,
      requestedByName: user.name,
    },
  });
  emitCrmEvent('marginApproval:updated', { id: a.id });
  const lowest = Math.min(...snap.filter((l) => l.below && l.margin != null).map((l) => l.margin as number));
  await notify({
    userIds: await marginApproverIds(),
    type: 'margin_request',
    entity: 'prospect',
    entityId: prospectId,
    title: `Persetujuan margin: ${p.customer}`,
    message: `${user.name} · ${status.below} item di bawah ${rules.marginMin}% (terendah ${Number.isFinite(lowest) ? lowest.toLocaleString('id-ID') : '-'}%). Alasan: ${alasan}`.slice(0, 300),
  });
  await logActivity({ user, action: 'create', entity: 'quotation', entityId: prospectId, summary: `Mengajukan persetujuan margin Surat Penawaran ${p.customer} (${status.below} item di bawah ${rules.marginMin}%)` });
  return NextResponse.json(await marginStatus(user, prospectId, items));
}
