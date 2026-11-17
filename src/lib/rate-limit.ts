/**
 * Pembatas percobaan sederhana di memori (satu proses Node di VPS). Dipakai
 * untuk login: setelah terlalu banyak gagal dalam satu jendela waktu, kunci
 * sementara. Hilang saat server restart — cukup untuk menahan tebak password
 * otomatis; banjir trafik tetap ditahan di depan (Cloudflare / reverse proxy).
 */
interface Bucket {
  fails: number[];
  lockedUntil: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  buckets.forEach((b, k) => {
    b.fails = b.fails.filter((t) => now - t < windowMs);
    if (!b.fails.length && b.lockedUntil < now) buckets.delete(k);
  });
}

export interface LimitRule {
  /** Gagal maksimal dalam jendela sebelum dikunci. */
  max: number;
  windowMs: number;
  lockMs: number;
}

/** Sisa detik terkunci (0 = boleh mencoba). */
export function lockedFor(key: string): number {
  const b = buckets.get(key);
  const now = Date.now();
  return b && b.lockedUntil > now ? Math.ceil((b.lockedUntil - now) / 1000) : 0;
}

/** Catat satu kegagalan; kembalikan sisa detik kunci bila batas tercapai. */
export function recordFail(key: string, rule: LimitRule): number {
  const now = Date.now();
  sweep(now, rule.windowMs);
  const b = buckets.get(key) || { fails: [], lockedUntil: 0 };
  b.fails = b.fails.filter((t) => now - t < rule.windowMs);
  b.fails.push(now);
  if (b.fails.length >= rule.max) {
    b.lockedUntil = now + rule.lockMs;
    b.fails = [];
  }
  buckets.set(key, b);
  return lockedFor(key);
}

export function clearFails(key: string) {
  buckets.delete(key);
}
