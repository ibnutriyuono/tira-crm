/**
 * Kondisi stok per item & target kedatangan (PO Indent).
 *
 * - `stok` / `stokLama` diisi Sales per baris material (Edit Prospek):
 *   ready | ready2 (ready di cabang lain) | indent | import, + perkiraan lama.
 *   Prospek lama hanya punya teks bebas `kondisiStock`; teks itu dipetakan
 *   otomatis ke semua itemnya (legacyStok).
 * - `eta` (target tiba, YYYY-MM-DD), `etaStat` dan `etaLog` diisi Purchasing
 *   lewat tab PO Indent (/api/po-indent). Tidak pernah diambil dari form
 *   prospek (lihat deriveFromMaterials / carryItemTracking).
 *
 * Dependency-free supaya bisa dipakai di server maupun client.
 */

export type StokKond = 'ready' | 'ready2' | 'indent' | 'import';
export type EtaStat = 'belum' | 'po' | 'jalan' | 'tiba';

export const STOK_META: Record<StokKond, { label: string; short: string; cls: string }> = {
  ready: { label: 'Ready stock', short: 'Ready', cls: 'ready' },
  ready2: { label: 'Ready (cabang lain)', short: 'Ready (cabang lain)', cls: 'ready' },
  indent: { label: 'Indent', short: 'Indent', cls: 'indent' },
  import: { label: 'Import', short: 'Import', cls: 'import' },
};
export const STOK_KEYS = Object.keys(STOK_META) as StokKond[];

export const ETA_STAT_META: Record<EtaStat, { label: string; cls: string }> = {
  belum: { label: 'Belum dipesan', cls: 'belum' },
  po: { label: 'Sudah PO ke mill/vendor', cls: 'po' },
  jalan: { label: 'Dalam perjalanan', cls: 'jalan' },
  tiba: { label: 'Tiba di gudang', cls: 'tiba' },
};
export const ETA_STAT_KEYS = Object.keys(ETA_STAT_META) as EtaStat[];

export const isStokKond = (v: unknown): v is StokKond => typeof v === 'string' && v in STOK_META;
export const isEtaStat = (v: unknown): v is EtaStat => typeof v === 'string' && v in ETA_STAT_META;
export const needsArrival = (k: StokKond | null | undefined) => k === 'indent' || k === 'import';

export interface EtaLogEntry {
  /** ISO waktu dicatat. */
  at: string;
  by: string;
  /** Target sebelumnya / sesudahnya (YYYY-MM-DD atau ''). */
  from?: string;
  to?: string;
  /** Status barang sebelumnya / sesudahnya. */
  sFrom?: string;
  sTo?: string;
  note?: string;
}

const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const s = (v: unknown, max: number) => String(v ?? '').slice(0, max);

export function cleanEtaLog(v: unknown): EtaLogEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e === 'object')
    .slice(-40)
    .map((e) => {
      const o = e as Record<string, unknown>;
      const out: EtaLogEntry = { at: s(o.at, 40), by: s(o.by, 80) };
      if (o.from !== undefined) out.from = ymd(o.from);
      if (o.to !== undefined) out.to = ymd(o.to);
      if (isEtaStat(o.sFrom)) out.sFrom = o.sFrom;
      if (isEtaStat(o.sTo)) out.sTo = o.sTo;
      if (o.note) out.note = s(o.note, 300);
      return out;
    });
}

/** Fields kept by pickSpecExtra. Sales-editable: stok, stokLama. Purchasing-only: eta, etaStat, etaLog. */
export function pickStockExtra(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isStokKond(o.stok)) out.stok = o.stok;
  if (o.stokLama !== undefined && String(o.stokLama).trim()) out.stokLama = s(o.stokLama, 40).trim();
  const eta = ymd(o.eta);
  if (eta) out.eta = eta;
  if (isEtaStat(o.etaStat)) out.etaStat = o.etaStat;
  const log = cleanEtaLog(o.etaLog);
  if (log.length) out.etaLog = log;
  return out;
}

export const PURCH_ITEM_KEYS = ['eta', 'etaStat', 'etaLog'] as const;

/** Old free-text "Kondisi Stock" → one condition for every item. */
export function legacyStok(text: string | null | undefined): { kond: StokKond; lama: string } | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const lama = (t.match(/(\d+\s*(?:[-–]\s*\d+\s*)?(?:hari|hr|minggu|mgg|bulan|bln|month|week)s?)/i)?.[1] || '').trim();
  if (/import|impor/i.test(t)) return { kond: 'import', lama };
  if (/inden|indent|pesan/i.test(t)) return { kond: 'indent', lama };
  if (/cabang|lain/i.test(t) && /ready|ada|stok|stock/i.test(t)) return { kond: 'ready2', lama: '' };
  if (/ready|ada|tersedia|stok|stock/i.test(t)) return { kond: 'ready', lama: '' };
  return null;
}

export interface ItemStock {
  kond: StokKond | null;
  lama: string;
  /** Diambil dari teks Kondisi Stock lama (belum diisi per item). */
  legacy: boolean;
  eta: string;
  stat: EtaStat;
  log: EtaLogEntry[];
}

export function itemStock(m: Record<string, unknown> | null | undefined, kondisiStock?: string | null): ItemStock {
  const o = (m || {}) as Record<string, unknown>;
  let kond: StokKond | null = isStokKond(o.stok) ? o.stok : null;
  let lama = typeof o.stokLama === 'string' ? o.stokLama : '';
  let legacy = false;
  if (!kond) {
    const l = legacyStok(kondisiStock);
    if (l) {
      kond = l.kond;
      lama = lama || l.lama;
      legacy = true;
    }
  }
  return { kond, lama, legacy, eta: ymd(o.eta), stat: isEtaStat(o.etaStat) ? o.etaStat : 'belum', log: cleanEtaLog(o.etaLog) };
}

/** "2 Import · 1 Ready" — disimpan juga ke kolom kondisiStock agar laporan lama tetap terbaca. */
export function stockSummary(kinds: (StokKond | null)[]): string {
  const n: Partial<Record<StokKond, number>> = {};
  kinds.forEach((k) => k && (n[k] = (n[k] || 0) + 1));
  return STOK_KEYS.filter((k) => n[k]).map((k) => `${n[k]} ${STOK_META[k].short}`).join(' · ');
}

export type EtaFlag = 'tiba' | 'kosong' | 'lewat' | 'janji' | 'ok';

export const ETA_FLAG_META: Record<EtaFlag, { label: string; cls: string }> = {
  tiba: { label: 'Tiba — menunggu DO', cls: 'ok' },
  kosong: { label: 'Belum ada target', cls: 'none' },
  lewat: { label: 'Lewat target', cls: 'bad' },
  janji: { label: 'Melewati janji kirim', cls: 'warn' },
  ok: { label: 'Sesuai jadwal', cls: 'ok2' },
};

/** Merah = target lewat & belum tiba; oranye = target melewati janji kirim ke customer. */
export function etaFlag(eta: string, stat: EtaStat, janji: string, today: string): EtaFlag {
  if (stat === 'tiba') return 'tiba';
  if (!eta) return 'kosong';
  if (eta < today) return 'lewat';
  if (janji && eta > janji) return 'janji';
  return 'ok';
}

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function fmtYmd(d: string): string {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(8, 10))} ${BLN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '';
}

/** Teks satu baris riwayat. */
export function etaLogText(e: EtaLogEntry): string {
  const parts: string[] = [];
  if (e.from !== undefined || e.to !== undefined) {
    if (!e.from && e.to) parts.push(`target diisi ${fmtYmd(e.to)}`);
    else if (e.from && !e.to) parts.push(`target dihapus (sebelumnya ${fmtYmd(e.from)})`);
    else if (e.from !== e.to) parts.push(`target ${fmtYmd(e.from || '')} → ${fmtYmd(e.to || '')}${(e.to || '') > (e.from || '') ? ' (mundur)' : ' (maju)'}`);
  }
  if (e.sTo && e.sFrom !== e.sTo) parts.push(ETA_STAT_META[e.sTo as EtaStat]?.label || e.sTo);
  return parts.join(' · ') || 'catatan';
}
