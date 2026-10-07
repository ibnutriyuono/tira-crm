import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { applyManualKurs, getKurs } from '@/lib/kurs';
import { TICKER_SETTING_KEY, buildTickerExtras, buildTickerHighlights, jakartaPeriode, jakartaToday, normalizeTickerCustom, type TickerData } from '@/lib/ticker';

/**
 * Running text. Highlights are computed company-wide on the server (not from
 * the caller's role-scoped prospects) so every user sees the same headline,
 * and only the headline fields leave the server -- not the underlying list.
 */
// Same answer for every user: computed at most every 30 s per server process,
// not once per user per refresh. Saving the settings clears it.
const CACHE_MS = 30 * 1000;
const g = globalThis as unknown as { __tickerCache?: { data: TickerData; at: number } | null };

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (g.__tickerCache && Date.now() - g.__tickerCache.at < CACHE_MS) return NextResponse.json(g.__tickerCache.data);
  const periode = jakartaPeriode();
  const today = jakartaToday();
  const [rows, targets, setting] = await Promise.all([
    prisma.prospect.findMany({
      select: {
        status: true, value: true, customer: true, se: true, cabang: true, reg: true, noPo: true, tglPO: true, tglDelivery: true, tglPenawaran: true,
        createdAt: true, updatedAt: true, statusChangedAt: true, qcdKompetitor: true, qcdFaktor: true, materials: true, line: true, uraian: true, qty: true, terfaktur: true,
      },
    }),
    prisma.budgetTarget.findMany(),
    prisma.setting.findUnique({ where: { key: TICKER_SETTING_KEY } }),
  ]);
  const custom = normalizeTickerCustom(setting?.value);
  const list = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), statusChangedAt: r.statusChangedAt.toISOString() }));
  const needKurs = custom.items.kursUsd || custom.items.kursEur;
  const kurs = needKurs ? applyManualKurs(await getKurs(), custom.kursManual) : null;
  const data: TickerData = {
    periode,
    today,
    ...buildTickerHighlights(list as never, periode),
    ...buildTickerExtras(list as never, targets as never, periode, today),
    kurs,
    custom,
  };
  g.__tickerCache = { data, at: Date.now() };
  return NextResponse.json(data);
}

/** Settings (checklist, custom messages, manual exchange rate): GM and admin only. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.role !== 'gm' && user.role !== 'admin') return NextResponse.json({ error: 'Hanya GM/admin yang dapat mengubah running text.' }, { status: 403 });
  const custom = normalizeTickerCustom(await req.json().catch(() => null));
  const value = custom as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: TICKER_SETTING_KEY }, update: { value }, create: { key: TICKER_SETTING_KEY, value } });
  g.__tickerCache = null;
  emitCrmEvent('ticker:updated', {});
  await logActivity({ user, action: 'update', entity: 'setting', entityId: TICKER_SETTING_KEY, summary: `Mengubah running text (${Object.values(custom.items).filter(Boolean).length} item tampil, ${custom.messages.length} pesan custom)` });
  return NextResponse.json({ custom });
}
