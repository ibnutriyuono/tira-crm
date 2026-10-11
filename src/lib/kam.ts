import type { CustomerGroup, KamAction, KamTier } from './types';

/**
 * Key Account Management (lihat deck "Key Account Management Special Steel").
 *
 * Grup customer dengan tier Strategic / Key / Development / Monitor, pola
 * penanganan A/B/C, dan tim per akun: ketua (penanggung jawab akun, menentukan
 * harga & term), sekretaris dan anggota. Entitas grup dicocokkan ke nama
 * customer di prospek, aktivitas dan RFQ lewat normalizeCustomerName.
 */

export const KAM_TIERS: { key: KamTier; label: string; rule: string; manager: string; contactDays: number; review: string; badge: string; color: string }[] = [
  { key: 'strategic', label: 'Strategic', rule: 'Skor ≥65 / omzet ≥Rp 4 M', manager: 'Sponsor GM/RM, ketua tim nasional, anggota di tiap cabang', contactDays: 14, review: 'kuartalan', badge: 'rust', color: '#7A2A18' },
  { key: 'key', label: 'Key Account', rule: 'Skor 40–65', manager: 'Ketua tim = BM home cabang, cabang lain anggota', contactDays: 30, review: 'semesteran', badge: 'amber', color: '#C98A2E' },
  { key: 'development', label: 'Development', rule: 'Skor 25–40', manager: 'SE home cabang dengan target pengembangan', contactDays: 45, review: 'tahunan', badge: 'steel', color: '#456484' },
  { key: 'monitor', label: 'Monitor', rule: 'Skor <25', manager: 'Dikelola reguler cabang; evaluasi 2 kuartal', contactDays: 60, review: 'tahunan', badge: 'slate', color: '#8796A5' },
];
export const KAM_TIER_META = Object.fromEntries(KAM_TIERS.map((t) => [t.key, t])) as Record<KamTier, (typeof KAM_TIERS)[number]>;
export const isKeyTier = (t: KamTier | null | undefined) => t === 'strategic' || t === 'key';

export const KAM_POLA: Record<'A' | 'B' | 'C', string> = {
  A: 'Grup terpusat, lokasi tersebar',
  B: 'Holding, entitas independen',
  C: 'Satu lokasi dominan',
};

export const KAM_ACTION_STATUS: Record<KamAction['status'], { label: string; badge: string }> = {
  belum: { label: 'Belum', badge: 'slate' },
  berjalan: { label: 'Berjalan', badge: 'steel' },
  selesai: { label: 'Selesai', badge: 'green' },
  batal: { label: 'Batal', badge: 'rust' },
};

/** Who may change groups, tiers and teams. */
export const canManageKam = (role: string | null | undefined) => role === 'gm' || role === 'rm' || role === 'admin';

/** "PT. Indah Kiat Pulp & Paper Tbk" -> "INDAH KIAT PULP PAPER" */
export function normalizeCustomerName(name: string | null | undefined): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[.,&()'"/\\-]+/g, ' ')
    .replace(/\b(PT|CV|TBK|PERSERO|UD|FA|PD)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lookup customer name -> group. Group name itself also matches. */
export function buildGroupIndex(groups: CustomerGroup[]): Map<string, CustomerGroup> {
  const m = new Map<string, CustomerGroup>();
  groups.forEach((g) => {
    [g.name, ...(g.entities || [])].forEach((n) => {
      const k = normalizeCustomerName(n);
      if (k && !m.has(k)) m.set(k, g);
    });
  });
  return m;
}

export function groupForCustomer(index: Map<string, CustomerGroup>, customer: string | null | undefined): CustomerGroup | null {
  const k = normalizeCustomerName(customer);
  if (!k) return null;
  const exact = index.get(k);
  if (exact) return exact;
  // "INDAH KIAT PULP PAPER PERAWANG" still belongs to entity "INDAH KIAT".
  let best: CustomerGroup | null = null;
  let bestLen = 0;
  index.forEach((g, name) => {
    if (name.length >= 5 && name.length > bestLen && (k.startsWith(name + ' ') || k === name)) {
      best = g;
      bestLen = name.length;
    }
  });
  return best;
}

export interface KamFlag {
  key: string;
  text: string;
  level: 'high' | 'mid' | 'low';
}

/** Risk signals per deck: YTD <= -30%, margin < 25%, no transaction >= 3 months, L12M < 50% of 3-year average, contact overdue. */
export function kamFlags(g: CustomerGroup, opts: { today: string; daysSinceContact?: number | null }): KamFlag[] {
  const f: KamFlag[] = [];
  if (g.growthYtd != null && g.growthYtd <= -30) f.push({ key: 'ytd', text: `YTD ${Math.round(g.growthYtd)}%`, level: 'high' });
  if (g.margin != null && g.margin < 25) f.push({ key: 'margin', text: `Margin ${Math.round(g.margin)}%`, level: 'high' });
  if (g.lastTrx && /^\d{4}-\d{2}/.test(g.lastTrx)) {
    const [y, m] = g.lastTrx.split('-').map(Number);
    const [ty, tm] = opts.today.split('-').map(Number);
    const months = (ty - y) * 12 + (tm - m);
    if (months >= 3) f.push({ key: 'idle', text: `Tanpa transaksi ${months} bln`, level: 'mid' });
  }
  if (g.l12m != null && g.avg3y != null && g.avg3y > 0 && g.l12m < g.avg3y * 0.5) f.push({ key: 'l3', text: 'L12M < 50% rata-rata 3 th', level: 'mid' });
  const lim = KAM_TIER_META[g.tier]?.contactDays;
  if (isKeyTier(g.tier) && lim) {
    if (opts.daysSinceContact == null) f.push({ key: 'contact', text: 'Belum ada kontak tercatat', level: 'low' });
    else if (opts.daysSinceContact > lim) f.push({ key: 'contact', text: `Belum dikontak ${opts.daysSinceContact} hari`, level: 'low' });
  }
  return f;
}

const str = (v: unknown, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const numOrNull = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const strList = (v: unknown, max = 200): string[] =>
  Array.from(
    new Set(
      (Array.isArray(v) ? v : String(v ?? '').split(/[\n;]+/))
        .map((x) => str(x, 120))
        .filter(Boolean),
    ),
  ).slice(0, max);

export function parseTier(v: unknown): KamTier | null {
  const s = str(v).toLowerCase();
  if (s.startsWith('strat')) return 'strategic';
  if (s.startsWith('key')) return 'key';
  if (s.startsWith('dev')) return 'development';
  if (s.startsWith('mon')) return 'monitor';
  return null;
}

/** Sanitizes the editable fields of a group (shared by API create/update/import). */
export function cleanGroupInput(b: Record<string, unknown>): Partial<CustomerGroup> {
  const out: Partial<CustomerGroup> = {};
  if ('name' in b) out.name = str(b.name, 120);
  if ('tier' in b) {
    const t = parseTier(b.tier);
    if (t) out.tier = t;
  }
  if ('skor' in b) out.skor = numOrNull(b.skor);
  if ('pola' in b) {
    const p = str(b.pola).toUpperCase().slice(0, 1);
    out.pola = p === 'A' || p === 'B' || p === 'C' ? p : null;
  }
  for (const k of ['segmen', 'homeCabang', 'sponsor', 'lastTrx', 'reviewNext', 'notes'] as const) {
    if (k in b) (out as Record<string, unknown>)[k] = str(b[k], k === 'notes' ? 2000 : 120) || null;
  }
  if (out.homeCabang) out.homeCabang = out.homeCabang.toUpperCase();
  if ('supportCabang' in b) out.supportCabang = strList(b.supportCabang, 20).map((c) => c.toUpperCase());
  if ('entities' in b) out.entities = strList(b.entities, 200);
  for (const k of ['l12m', 'growthYtd', 'margin', 'avg3y', 'target'] as const) {
    if (k in b) out[k] = numOrNull(b[k]);
  }
  for (const k of ['ketuaId', 'sekretarisId'] as const) {
    if (k in b) out[k] = str(b[k], 40) || null;
  }
  if ('anggotaIds' in b) out.anggotaIds = strList(b.anggotaIds, 50);
  if ('actions' in b && Array.isArray(b.actions)) {
    out.actions = (b.actions as Record<string, unknown>[]).slice(0, 100).map((a, i) => ({
      id: str(a.id, 40) || `a${Date.now().toString(36)}${i}`,
      text: str(a.text, 300),
      pic: str(a.pic, 120),
      due: /^\d{4}-\d{2}-\d{2}$/.test(str(a.due)) ? str(a.due) : '',
      status: (['belum', 'berjalan', 'selesai', 'batal'].includes(str(a.status)) ? str(a.status) : 'belum') as KamAction['status'],
    })).filter((a) => a.text);
  }
  return out;
}
