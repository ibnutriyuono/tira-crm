import { applyManualKurs, getKurs } from './kurs';
import { prisma } from './prisma';
import { TICKER_SETTING_KEY, normalizeTickerCustom } from './ticker';

/** Kurs acuan saat ini (manual GM/Admin di Running Text menang atas online). IDR per 1 USD / EUR. */
export async function currentKurs(): Promise<{ usd: number | null; eur: number | null; date: string; source: string } | null> {
  const setting = await prisma.setting.findUnique({ where: { key: TICKER_SETTING_KEY } });
  const custom = normalizeTickerCustom(setting?.value);
  return applyManualKurs(await getKurs(), custom.kursManual) as { usd: number | null; eur: number | null; date: string; source: string } | null;
}

export async function kursFor(cur: string): Promise<number> {
  const c = (cur || 'IDR').toUpperCase();
  if (c === 'IDR') return 1;
  const k = await currentKurs();
  if (c === 'USD') return k?.usd || 0;
  if (c === 'EUR') return k?.eur || 0;
  return 0;
}
