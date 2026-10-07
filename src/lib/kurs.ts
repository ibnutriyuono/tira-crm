import type { TickerKurs } from './ticker';

/**
 * Daily reference rates USD->IDR and EUR->IDR for the running text.
 * Source: Frankfurter (European Central Bank reference rates, published on
 * working days); fallback open.er-api.com. Fetched at most once an hour per
 * server process -- every user's ticker reads the cached value. A failed
 * fetch keeps serving the last good rate.
 */

const TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

interface Cache {
  value: TickerKurs | null;
  fetchedAt: number;
  failedAt: number;
}
const g = globalThis as unknown as { __kursCache?: Cache };
const cache: Cache = (g.__kursCache ??= { value: null, fetchedAt: 0, failedAt: 0 });

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** Rates per 1 USD -> { usd: IDR per USD, eur: IDR per EUR }. */
export function ratesFromUsdBase(idrPerUsd: unknown, eurPerUsd: unknown): { usd: number; eur: number } | null {
  const idr = Number(idrPerUsd);
  const eur = Number(eurPerUsd);
  if (!(idr > 0) || !(eur > 0)) return null;
  return { usd: idr, eur: idr / eur };
}

async function fromFrankfurter(): Promise<TickerKurs | null> {
  const j = (await getJson('https://api.frankfurter.dev/v1/latest?from=USD&to=IDR,EUR')) as { date?: string; rates?: { IDR?: number; EUR?: number } };
  const r = ratesFromUsdBase(j.rates?.IDR, j.rates?.EUR);
  return r ? { ...r, date: String(j.date || ''), source: 'ECB' } : null;
}

async function fromErApi(): Promise<TickerKurs | null> {
  const j = (await getJson('https://open.er-api.com/v6/latest/USD')) as { result?: string; time_last_update_unix?: number; rates?: { IDR?: number; EUR?: number } };
  if (j.result !== 'success') return null;
  const r = ratesFromUsdBase(j.rates?.IDR, j.rates?.EUR);
  const date = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : '';
  return r ? { ...r, date, source: 'open.er-api' } : null;
}

export async function getKurs(now = Date.now()): Promise<TickerKurs | null> {
  if (cache.value && now - cache.fetchedAt < TTL_MS) return cache.value;
  if (now - cache.failedAt < RETRY_MS) return cache.value;
  for (const src of [fromFrankfurter, fromErApi]) {
    try {
      const v = await src();
      if (v) {
        cache.value = v;
        cache.fetchedAt = now;
        return v;
      }
    } catch (err) {
      console.warn('[kurs] gagal ambil kurs', err instanceof Error ? err.message : err);
    }
  }
  cache.failedAt = now;
  return cache.value;
}

/** Manual rates (GM/Admin) win over the online ones, per currency. */
export function applyManualKurs(online: TickerKurs | null, manual: { usd: number | null; eur: number | null }): TickerKurs | null {
  if (!manual.usd && !manual.eur) return online;
  return {
    usd: manual.usd ?? online?.usd ?? null,
    eur: manual.eur ?? online?.eur ?? null,
    date: online?.date || '',
    source: manual.usd && manual.eur ? 'internal' : online ? `internal + ${online.source}` : 'internal',
  };
}
