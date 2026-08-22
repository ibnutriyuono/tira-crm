import type { Klasifikasi, Material, Prospect } from './types';

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

export function classify(r: Pick<Prospect, 'status' | 'keterangan'>): Klasifikasi {
  const status = num(r.status);
  const k = (r.keterangan || '').toLowerCase();
  if (status === 6) return 'Lost';
  if (/kalah|lose|lost|batal|cancel|loss/.test(k)) return 'Lost';
  if (status === 4 || status === 5) return 'Won';
  if (/tersupply|terssupply|closed|\bclose\b|terkirim|invoice|\bdo\b|full ?supply|diambil|dikirim|faktur|\bpo\b/.test(k)) return 'Won';
  return 'Aktif';
}

export function klasBadgeColor(klas: Klasifikasi): string {
  return klas === 'Won' ? 'green' : klas === 'Lost' ? 'rust' : 'steel';
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
export function getProspectMaterials(r: Pick<Prospect, 'materials' | 'qty' | 'value' | 'line' | 'uraian'>): Material[] {
  if (Array.isArray(r.materials) && r.materials.length > 0) {
    return r.materials.map((m) => ({ line: m.line || '', uraian: m.uraian || '', qty: num(m.qty) || 0, harga: num(m.harga) || 0 }));
  }
  const qty = num(r.qty) || 1;
  const harga = qty > 0 ? Math.round(num(r.value) / qty) : num(r.value);
  return [{ line: r.line || '', uraian: r.uraian || '', qty, harga }];
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
