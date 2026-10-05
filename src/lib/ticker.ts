import { num } from './format';
import type { Prospect } from './types';

export interface TickerData {
  periode: string;
  topPo: { customer: string; value: number; se: string; cabang: string; noPo: string | null } | null;
  topCabang: { cabang: string; total: number; count: number } | null;
  custom: { enabled: boolean; messages: string[] };
}

export interface TickerCustom {
  enabled: boolean;
  messages: string[];
}

export const TICKER_SETTING_KEY = 'runningText';
export const TICKER_MAX_MESSAGES = 10;

/** YYYY-MM in Jakarta time -- the server runs in UTC, so on the 1st before 07:00 WIB UTC is still last month. */
export function jakartaPeriode(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

/**
 * The month's POs: prospects at PO/Kontrak (4) or DO (5) dated in `periode`
 * by Tgl PO (falling back to delivery, then offer date -- same rule as the
 * forecast/analysis screens, so the ticker agrees with them).
 */
export function buildTickerHighlights(prospects: Pick<Prospect, 'status' | 'value' | 'customer' | 'se' | 'cabang' | 'noPo' | 'tglPO' | 'tglDelivery' | 'tglPenawaran'>[], periode: string) {
  const pos = prospects.filter((r) => {
    const st = num(r.status);
    const d = r.tglPO || r.tglDelivery || r.tglPenawaran || '';
    return (st === 4 || st === 5) && d.slice(0, 7) === periode && num(r.value) > 0;
  });
  let topPo: TickerData['topPo'] = null;
  for (const r of pos) {
    if (!topPo || num(r.value) > topPo.value) {
      topPo = { customer: r.customer, value: num(r.value), se: (r.se || '-').toUpperCase(), cabang: (r.cabang || '-').toUpperCase(), noPo: r.noPo || null };
    }
  }
  const byCabang = new Map<string, { total: number; count: number }>();
  pos.forEach((r) => {
    const c = (r.cabang || '').trim().toUpperCase();
    if (!c) return;
    const e = byCabang.get(c) || { total: 0, count: 0 };
    e.total += num(r.value);
    e.count++;
    byCabang.set(c, e);
  });
  let topCabang: TickerData['topCabang'] = null;
  byCabang.forEach((v, cabang) => {
    if (!topCabang || v.total > topCabang.total) topCabang = { cabang, ...v };
  });
  return { topPo, topCabang };
}

export function normalizeTickerCustom(raw: unknown): TickerCustom {
  const r = (raw ?? {}) as { enabled?: unknown; messages?: unknown };
  const list = Array.isArray(r.messages) ? r.messages : [];
  return {
    enabled: r.enabled !== false,
    messages: list.map((m) => String(m ?? '').trim().slice(0, 300)).filter(Boolean).slice(0, TICKER_MAX_MESSAGES),
  };
}
