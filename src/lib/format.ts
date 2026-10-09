import type { Customer, CustomerPic, Klasifikasi, Material, Prospect } from './types';

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function formatRupiah(n: unknown): string {
  return 'Rp ' + Math.round(num(n)).toLocaleString('id-ID');
}

export function formatDateID(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Date + time for audit stamps. Unlike formatDateID these values are full
 * timestamps rather than bare YYYY-MM-DD, so they are parsed as-is instead of
 * being pinned to local midnight.
 */
export function formatDateTimeID(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDateLongID(iso?: string | null): string {
  if (!iso) return '';
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `status` alone decides this — deliberately. An earlier version also
 * pattern-matched `keterangan` (free-text notes) for words like "po", "do",
 * "cancel", "batal" and classified on that regardless of the actual status
 * field, meant to catch legacy records whose Won/Lost outcome was only ever
 * written as a note. In practice it did the opposite: short, everyday words
 * like "PO" or "DO" show up constantly in ordinary notes on deals that are
 * nowhere near won ("menunggu PO customer", "estimasi DO minggu depan"),
 * so a prospect still sitting at Penawaran Harga (status 2) could get
 * badged Won just because someone wrote a note mentioning PO — reported
 * via a screenshot showing several Penawaran Harga cards all marked Won.
 * Removed rather than narrowed, since the status field (with its own
 * dedicated PO/Kontrak and DO stages) is the actual source of truth Sales
 * and Purchasing already update deliberately — a text-search fallback
 * duplicating that, imperfectly, buys nothing this app doesn't already
 * have a real field for.
 */
export function classify(r: Pick<Prospect, 'status'>): Klasifikasi {
  const status = num(r.status);
  // Status 0 is a logged sales activity, not a live pipeline deal — counting it
  // as 'Aktif' inflated Aktif Pipeline against the single-file app.
  if (status === 0) return 'Activity';
  if (status === 6) return 'Lost';
  if (status === 4 || status === 5) return 'Won';
  return 'Aktif';
}

export function klasBadgeColor(klas: Klasifikasi): string {
  return klas === 'Won' ? 'green' : klas === 'Lost' ? 'rust' : klas === 'Activity' ? 'slate' : 'steel';
}

export function normalizePhone(p?: string | null): string {
  let d = String(p || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return d;
}

// Legacy fallback for records created before multi-material support so a
// missing/empty `materials` array still renders something sensible.
/**
 * Product line codes are two digits: "4" -> "04", "12" stays "12". A list
 * ("4, 7") is normalized per entry; anything that isn't a plain number
 * ("PL-4") is kept as typed.
 */
export function normalizeLine(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map((t) => (/^\d$/.test(t) ? `0${t}` : t))
    .join(', ');
}

/** Same as normalizeLine for every row of an item list (RFQ/FUP A/plan). */
export function normalizeItemLines<T>(items: T[]): T[] {
  return (Array.isArray(items) ? items : []).map((it) =>
    it && typeof it === 'object' && 'line' in (it as object) ? { ...it, line: normalizeLine((it as { line?: unknown }).line) } : it,
  );
}

export function getProspectMaterials(r: Pick<Prospect, 'materials' | 'qty' | 'value' | 'line' | 'uraian'>): Material[] {
  if (Array.isArray(r.materials) && r.materials.length > 0) {
    return r.materials.map((m) => ({ line: normalizeLine(m.line), uraian: m.uraian || '', qty: num(m.qty) || 0, beratPc: num(m.beratPc) || 0, hargaKg: num(m.hargaKg) || 0, harga: num(m.harga) || 0 }));
  }
  const qty = num(r.qty) || 1;
  const harga = qty > 0 ? Math.round(num(r.value) / qty) : num(r.value);
  return [{ line: normalizeLine(r.line), uraian: r.uraian || '', qty, beratPc: 0, hargaKg: 0, harga }];
}

// Legacy fallback for customers saved before multi-PIC support: when `pics`
// is empty, synthesize one entry from the old single pic/phone/email fields
// so every call site (quotation addressee, follow-up greeting, customer
// table) can read through this one function instead of re-deriving the
// fallback itself. Mirrors getProspectMaterials()'s role for `materials`.
export function getPrimaryPic(c: Pick<Customer, 'pics' | 'pic' | 'phone' | 'email'> | null | undefined): CustomerPic | null {
  if (!c) return null;
  if (Array.isArray(c.pics) && c.pics.length > 0) {
    return c.pics.find((p) => p.isPrimary) || c.pics[0];
  }
  if (c.pic || c.phone || c.email) {
    return { id: 'legacy', nama: c.pic || '', jabatan: null, phone: c.phone || null, email: c.email || null, isPrimary: true };
  }
  return null;
}

export function uid(): string {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function escapeForFilename(s: string): string {
  return String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Row/card highlight class for high-value prospects (see VALUE_HL_* ). */
export function valueHighlightClass(value: unknown): string {
  const v = num(value);
  if (v > 3_000_000_000) return 'hl-yellow';
  if (v >= 1_000_000_000) return 'hl-green';
  return '';
}

/**
 * Unit price for a prospect material row: weight x price-per-kg when both are
 * given, otherwise the flat `harga`. Mirrors the single-file app so totals
 * match what Sales sees today.
 */
export function materialUnitPrice(m: { beratPc?: unknown; hargaKg?: unknown; harga?: unknown }): number {
  const beratPc = num(m.beratPc);
  const hargaKg = num(m.hargaKg);
  return beratPc > 0 && hargaKg > 0 ? beratPc * hargaKg : num(m.harga);
}

/**
 * Each material of a prospect with its value (qty x unit price, where the
 * unit price is berat/pc x harga/kg when both are filled, else harga -- same
 * rule as the prospect form). When no material carries a price but the
 * prospect has a total value, that total is split across the materials by
 * qty, so per-Line reports never show Rp 0 for a priced prospect.
 */
export function materialsWithValue(r: Pick<Prospect, 'materials' | 'qty' | 'value' | 'line' | 'uraian'>): (Material & { nilai: number })[] {
  const mats = getProspectMaterials(r);
  const vals = mats.map((m) => num(m.qty) * materialUnitPrice(m));
  const sum = vals.reduce((s, v) => s + v, 0);
  const total = num(r.value);
  if (sum <= 0 && total > 0 && mats.length) {
    const qtySum = mats.reduce((s, m) => s + Math.max(0, num(m.qty)), 0);
    return mats.map((m) => ({ ...m, nilai: qtySum > 0 ? (total * Math.max(0, num(m.qty))) / qtySum : total / mats.length }));
  }
  return mats.map((m, i) => ({ ...m, nilai: vals[i] }));
}
