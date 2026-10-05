import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { TICKER_SETTING_KEY, buildTickerHighlights, jakartaPeriode, normalizeTickerCustom, type TickerData } from '@/lib/ticker';

/**
 * Running text. Highlights are computed company-wide on the server (not from
 * the caller's role-scoped prospects) so every user sees the same headline,
 * and only the headline fields leave the server -- not the underlying list.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const periode = jakartaPeriode();
  const rows = await prisma.prospect.findMany({
    where: { status: { in: [4, 5] }, value: { gt: 0 } },
    select: { status: true, value: true, customer: true, se: true, cabang: true, noPo: true, tglPO: true, tglDelivery: true, tglPenawaran: true },
  });
  const setting = await prisma.setting.findUnique({ where: { key: TICKER_SETTING_KEY } });
  const data: TickerData = { periode, ...buildTickerHighlights(rows as never, periode), custom: normalizeTickerCustom(setting?.value) };
  return NextResponse.json(data);
}

/** Custom messages: GM and admin only. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.role !== 'gm' && user.role !== 'admin') return NextResponse.json({ error: 'Hanya GM/admin yang dapat mengubah running text.' }, { status: 403 });
  const custom = normalizeTickerCustom(await req.json().catch(() => null));
  const value = custom as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: TICKER_SETTING_KEY }, update: { value }, create: { key: TICKER_SETTING_KEY, value } });
  emitCrmEvent('ticker:updated', {});
  await logActivity({ user, action: 'update', entity: 'setting', entityId: TICKER_SETTING_KEY, summary: `Mengubah running text (${custom.messages.length} pesan, ${custom.enabled ? 'aktif' : 'nonaktif'})` });
  return NextResponse.json({ custom });
}
