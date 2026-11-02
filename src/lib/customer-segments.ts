/**
 * Segmen & sub-segmen customer (satu segmen per customer).
 *
 * - Daftar segmen + sub-segmen bisa diubah Admin (disimpan di Setting
 *   "customerSegments"); di bawah ini daftar awalnya.
 * - "Supplier": perusahaan yang memasok ke industri lain (trader,
 *   distributor, fabrikator). Sub-segmennya = segmen yang dipasok, dipilih
 *   dari semua segmen lain.
 * - "Others": segmen asli belum diketahui. Boleh dipakai, tetapi customer
 *   ini terus diingatkan untuk dilengkapi (Kelola Customer, Profil Customer,
 *   Beranda).
 */

export interface SegmentDef {
  name: string;
  subs: string[];
  /** Nonaktif = tidak bisa dipilih lagi, customer lama tetap. */
  active?: boolean;
}

export const SEG_SUPPLIER = 'Supplier';
export const SEG_OTHERS = 'Others';
export const SPECIAL_SEGMENTS = [SEG_SUPPLIER, SEG_OTHERS];

export const DEFAULT_SEGMENTS: SegmentDef[] = [
  { name: 'Pertambangan', subs: ['Batubara', 'Nikel & smelter', 'Emas & tembaga', 'Bauksit & timah', 'Quarry / agregat', 'Kontraktor tambang'] },
  { name: 'Semen & bahan bangunan', subs: ['Pabrik semen', 'Ready-mix / beton', 'Keramik & kaca'] },
  { name: 'Energi', subs: ['PLTU batubara', 'PLTU biomassa', 'Migas hulu', 'Kilang & petrokimia'] },
  { name: 'Agro', subs: ['Pabrik kelapa sawit', 'Gula', 'Pakan ternak', 'Karet'] },
  { name: 'Pulp & kertas', subs: ['Pulp mill', 'Paper mill', 'Kayu / chip mill'] },
  { name: 'Logam', subs: ['Steel mill', 'Smelter', 'Foundry / pengecoran'] },
  { name: 'Manufaktur', subs: ['Alat berat & komponen', 'Otomotif', 'Mesin', 'Kimia & pupuk'] },
  { name: 'Infrastruktur', subs: ['Konstruksi umum', 'Pelabuhan & galangan', 'Jalan & jembatan'] },
  { name: 'Daur ulang', subs: ['Scrap / shredder', 'Pengolahan limbah'] },
  { name: SEG_SUPPLIER, subs: [] },
  { name: SEG_OTHERS, subs: [] },
];

/** Segmen lama (daftar datar sebelum 31 Okt 2026) → segmen baru. Sama dengan migrasi phase51. */
export const LEGACY_SEGMENT_MAP: Record<string, { seg: string; sub?: string }> = {
  Tambang: { seg: 'Pertambangan' },
  Semen: { seg: 'Semen & bahan bangunan', sub: 'Pabrik semen' },
  'Sawit & agro': { seg: 'Agro' },
  'Pulp & kertas': { seg: 'Pulp & kertas' },
  'Energi & pembangkit': { seg: 'Energi' },
  'Migas & petrokimia': { seg: 'Energi' },
  'Fabrikator / bengkel': { seg: SEG_SUPPLIER },
  Konstruksi: { seg: 'Infrastruktur', sub: 'Konstruksi umum' },
  Manufaktur: { seg: 'Manufaktur' },
  'Distributor / trader': { seg: SEG_SUPPLIER },
  Lainnya: { seg: SEG_OTHERS },
};

const clean = (s: unknown, max = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Rapikan daftar dari Admin: nama unik, sub unik, Supplier & Others selalu ada (di akhir, tanpa sub). */
export function normalizeTaxonomy(input: unknown): SegmentDef[] {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: SegmentDef[] = [];
  for (const x of list as Partial<SegmentDef>[]) {
    const name = clean(x?.name);
    if (!name || seen.has(name.toLowerCase()) || SPECIAL_SEGMENTS.some((s) => s.toLowerCase() === name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const subSeen = new Set<string>();
    const subs = (Array.isArray(x?.subs) ? x.subs : [])
      .map((s) => clean(s))
      .filter((s) => s && !subSeen.has(s.toLowerCase()) && subSeen.add(s.toLowerCase()));
    out.push({ name, subs: subs.slice(0, 40), active: x?.active !== false });
  }
  return [...out.slice(0, 40), { name: SEG_SUPPLIER, subs: [], active: true }, { name: SEG_OTHERS, subs: [], active: true }];
}

/** Segmen yang bisa dipilih (aktif), plus nilai yang sedang terpasang walau sudah nonaktif. */
export function segmentChoices(tax: SegmentDef[], current?: string | null): string[] {
  const names = tax.filter((s) => s.active !== false).map((s) => s.name);
  return current && !names.includes(current) ? [...names, current] : names;
}

/** Pilihan sub-segmen untuk satu segmen. Supplier: semua segmen industri aktif; Others: tidak ada. */
export function subOptions(tax: SegmentDef[], segmen: string | null | undefined, current?: string | null): string[] {
  if (!segmen || segmen === SEG_OTHERS) return [];
  const base =
    segmen === SEG_SUPPLIER
      ? tax.filter((s) => s.active !== false && !SPECIAL_SEGMENTS.includes(s.name)).map((s) => s.name)
      : tax.find((s) => s.name === segmen)?.subs || [];
  return current && !base.includes(current) ? [...base, current] : base;
}

export function segmentLabel(segmen: string | null | undefined, sub: string | null | undefined): string {
  if (!segmen) return '';
  if (segmen === SEG_SUPPLIER) return sub ? `Supplier → ${sub}` : 'Supplier';
  return sub ? `${segmen} › ${sub}` : segmen;
}

/** Segmen belum jelas: kosong atau Others — perlu dilengkapi. */
export function needsSegment(c: { segmen?: string | null } | null | undefined): boolean {
  return !c?.segmen || c.segmen === SEG_OTHERS;
}

/**
 * Yang boleh mengisi / mengubah segmen: Admin Sales, Sales, BM, Admin, role
 * Product & Marketing, dan role tambahan di Kelola Role yang key / namanya
 * memuat "marketing" (apa pun tipe dasarnya). RM / GM / VP tidak.
 */
export function canEditSegment(role: string | null | undefined, customRole?: string | null, customLabel?: string | null): boolean {
  if (!role) return false;
  if (['salesadmin', 'sales', 'bm', 'admin', 'marketing'].includes(role)) return true;
  return /marketing/i.test(customRole || '') || /marketing/i.test(customLabel || '');
}
