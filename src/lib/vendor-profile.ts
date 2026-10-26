import type { RfqItem, Vendor } from './types';

/** Profil vendor, Approved Vendor List dan saran vendor per item. */

export const VENDOR_TIPE: { v: string; l: string }[] = [
  { v: 'mill', l: 'Mill / pabrik' },
  { v: 'distributor', l: 'Distributor / stockist' },
  { v: 'fabrikasi', l: 'Jasa potong / fabrikasi (Line 05)' },
  { v: 'ekspedisi', l: 'Ekspedisi' },
  { v: 'lainnya', l: 'Lainnya' },
];
export const tipeLabel = (v: string | null | undefined) => VENDOR_TIPE.find((t) => t.v === v)?.l || '';

export type AvlStatus = 'aktif' | 'evaluasi' | 'diblokir';
export const AVL_META: Record<AvlStatus, { label: string; color: string }> = {
  aktif: { label: 'Aktif', color: 'green' },
  evaluasi: { label: 'Dalam evaluasi', color: 'amber' },
  diblokir: { label: 'Diblokir', color: 'rust' },
};
export const avlOf = (v: Pick<Vendor, 'statusAvl'>): AvlStatus => (v.statusAvl === 'evaluasi' || v.statusAvl === 'diblokir' ? v.statusAvl : 'aktif');

export const VENDOR_DOC_JENIS = ['MTC', 'ISO', 'NPWP', 'Kontrak', 'Price list', 'Lainnya'];
export const INCOTERMS = ['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'Franco'];

/** Dokumen yang habis masa berlaku ≤ `days` hari lagi (atau sudah lewat). */
export function expiringDocs(v: Pick<Vendor, 'dokumen'>, today: string, days = 30) {
  const lim = new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
  return (v.dokumen || []).filter((d) => d.berlaku && d.berlaku <= lim).map((d) => ({ ...d, lewat: (d.berlaku || '') < today }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function itemThick(it: Partial<RfqItem>): number {
  const n = Number(String(it.thick || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export interface VendorSuggestion {
  vendor: Vendor;
  score: number;
  why: string[];
}

/**
 * Saran vendor untuk item-item sebuah RFQ: cocok tag produk / grade, rentang
 * tebal, Line 05 → vendor fabrikasi; ditambah riwayat (pernah membalas harga
 * untuk grade itu). Vendor diblokir tidak pernah disarankan.
 */
export function suggestVendors(items: Partial<RfqItem>[], vendors: Vendor[], history: { vendorId: string; text: string; replied: boolean }[] = []): VendorSuggestion[] {
  const texts = items.map((it) => norm(`${it.grade || ''} ${it.material || ''}`));
  const fab = items.some((it) => String(it.line || '').split(/\s*,\s*/).includes('05'));
  const out: VendorSuggestion[] = [];
  vendors.forEach((v) => {
    if (avlOf(v) === 'diblokir') return;
    let score = 0;
    const why: string[] = [];
    const tags = (v.produk || []).map(norm).filter(Boolean);
    const hits = tags.filter((t) => texts.some((x) => x.includes(t) || (t.length > 3 && t.split(' ').every((w) => x.includes(w)))));
    if (hits.length) {
      score += 10 * hits.length;
      why.push(`memasok ${hits.slice(0, 2).join(', ')}`);
    }
    if (v.tebalMin != null || v.tebalMax != null) {
      const ok = items.some((it) => {
        const t = itemThick(it);
        return t > 0 && (v.tebalMin == null || t >= v.tebalMin) && (v.tebalMax == null || t <= v.tebalMax);
      });
      if (ok) {
        score += 3;
        why.push('tebal sesuai');
      }
    }
    if (fab && v.tipe === 'fabrikasi') {
      score += 6;
      why.push('fabrikasi Line 05');
    }
    const past = history.filter((h) => h.vendorId === v.id && texts.some((x) => x && h.text.includes(x.split(' ')[0] || '~')));
    if (past.some((h) => h.replied)) {
      score += 4;
      why.push('pernah membalas harga serupa');
    }
    if (avlOf(v) === 'evaluasi') score -= 2;
    if (score > 0) out.push({ vendor: v, score, why });
  });
  return out.sort((a, b) => b.score - a.score);
}

const str = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max);
const numOrNull = (v: unknown) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Field profil vendor dari body form (server). */
export function cleanVendorProfile(b: Record<string, unknown>) {
  const tags = (v: unknown) =>
    Array.from(new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map((x) => str(x, 60)).filter(Boolean))).slice(0, 40);
  const pics = (Array.isArray(b.pics) ? b.pics : [])
    .map((p) => {
      const o = (p || {}) as Record<string, unknown>;
      return { nama: str(o.nama, 80), jabatan: str(o.jabatan, 60), wa: str(o.wa, 40), email: str(o.email, 120) };
    })
    .filter((p) => p.nama || p.wa || p.email)
    .slice(0, 10);
  const dokumen = (Array.isArray(b.dokumen) ? b.dokumen : [])
    .map((d, i) => {
      const o = (d || {}) as Record<string, unknown>;
      return {
        id: str(o.id, 40) || `d${Date.now().toString(36)}${i}`,
        jenis: str(o.jenis, 40) || 'Lainnya',
        nomor: str(o.nomor, 80),
        berlaku: /^\d{4}-\d{2}-\d{2}$/.test(String(o.berlaku || '')) ? String(o.berlaku) : '',
        catatan: str(o.catatan, 200),
        ...(o.attachmentId ? { attachmentId: str(o.attachmentId, 40) } : {}),
      };
    })
    .slice(0, 30);
  const all = {
    tipe: VENDOR_TIPE.some((t) => t.v === b.tipe) ? String(b.tipe) : null,
    asal: b.asal === 'lokal' || b.asal === 'impor' ? String(b.asal) : null,
    negara: str(b.negara, 60) || null,
    mataUang: str(b.mataUang, 5).toUpperCase() || null,
    incoterm: str(b.incoterm, 30) || null,
    produk: tags(b.produk),
    tebalMin: numOrNull(b.tebalMin),
    tebalMax: numOrNull(b.tebalMax),
    moq: str(b.moq, 60) || null,
    leadTime: str(b.leadTime, 60) || null,
    syaratBayar: str(b.syaratBayar, 80) || null,
    pics,
    dokumen,
  };
  // Hanya field yang dikirim form — form lama (tanpa profil) tidak menghapus profil.
  return Object.fromEntries(Object.entries(all).filter(([k]) => k in b)) as Partial<typeof all>;
}
