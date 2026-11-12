/**
 * Kontrak harga / qty tahunan customer — client-safe (dipakai server & browser).
 *
 * Satu kontrak berlaku untuk satu grup customer (beberapa entitas) di
 * beberapa cabang, selama periode tertentu. Jenis:
 *   harga  — harga material dikunci, tanpa komitmen qty
 *   qty    — komitmen qty per tahun, harga per PO tetap lewat penawaran
 *   hq     — keduanya
 * Item kontrak = grade dengan cakupan dimensi:
 *   grade   — semua dimensi grade itu (boleh dibatasi rentang tebal), satu harga / kg
 *   tebal   — tebal tertentu (lebar & panjang bebas), harga per tebal
 *   dimensi — dimensi lengkap tertentu, harga per dimensi
 *   spek    — material non-katalog (spesifikasi + part number customer), satuan bebas
 * Saat mencocokkan material PO, aturan paling spesifik dipakai dulu:
 * dimensi lengkap → tebal → semua dimensi.
 */
import { num } from './format';
import { nameSimilarity, sameCompany } from './customer-names';
import { stockGradeKey } from './stock';
import type { Material } from './types';

export type KontrakJenis = 'harga' | 'qty' | 'hq';
export type KontrakCakupan = 'grade' | 'tebal' | 'dimensi' | 'spek';
export type KontrakSkema = 'tetap' | 'tinjau' | 'kurs';
export type KontrakStatus = 'draft' | 'menunggu' | 'aktif' | 'ditolak' | 'batal';
/** Status tampilan: status tersimpan + tanggal. */
export type KontrakState = 'draft' | 'menunggu' | 'ditolak' | 'batal' | 'belum' | 'aktif' | 'akanHabis' | 'habis';

export const JENIS_LABEL: Record<KontrakJenis, string> = { harga: 'Harga', qty: 'Qty', hq: 'Harga + Qty' };
export const JENIS_HINT: Record<KontrakJenis, string> = {
  harga: 'Harga material dikunci selama periode. Qty mengikuti PO customer, tanpa komitmen.',
  qty: 'Customer berkomitmen ambil qty tertentu per tahun. Harga per PO tetap lewat penawaran biasa.',
  hq: 'Harga dikunci dan ada komitmen qty. Realisasi dipantau terhadap waktu kontrak.',
};
export const CAKUPAN_LABEL: Record<KontrakCakupan, string> = { grade: 'Semua dimensi', tebal: 'Tebal tertentu', dimensi: 'Dimensi tertentu', spek: 'Spesifikasi / part number' };
export const SKEMA_LABEL: Record<KontrakSkema, string> = { tetap: 'Harga tetap', tinjau: 'Ditinjau berkala', kurs: 'Ikut kurs' };
export const SKEMA_HINT: Record<KontrakSkema, string> = {
  tetap: 'Terkunci penuh selama periode (umumnya 12 bulan).',
  tinjau: 'Harga boleh direvisi berkala; revisi = adendum dan ikut aturan diskon lagi.',
  kurs: 'Harga dasar USD / EUR; harga Rupiah per PO = harga dasar × kurs hari PO.',
};
export const STATE_META: Record<KontrakState, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'slate' },
  menunggu: { label: 'Menunggu persetujuan', color: 'steel' },
  ditolak: { label: 'Ditolak', color: 'rust' },
  batal: { label: 'Batal', color: 'slate' },
  belum: { label: 'Belum mulai', color: 'steel' },
  aktif: { label: 'Aktif', color: 'green' },
  akanHabis: { label: 'Akan habis', color: 'amber' },
  habis: { label: 'Habis', color: 'slate' },
};
export const SATUAN_SPEK = ['pcs', 'set', 'meter', 'roll', 'unit', 'lot'];
/** Kontrak dianggap "akan habis" bila sisa ≤ N hari. */
export const AKAN_HABIS_HARI = 90;

export interface KontrakDim {
  id: string;
  tebal: number | null;
  lebar: number | null;
  panjang: number | null;
  /** Harga kontrak per kg. */
  harga: number | null;
  /** Harga acuan per kg (harga jual Purchasing / saran stok / manual). */
  acuan: number | null;
  acuanSrc?: string;
}

export interface KontrakAcuan {
  label: string;
  tebal?: number | null;
  acuan: number;
  src?: string;
}

export interface KontrakItem {
  id: string;
  urut: number;
  cakupan: KontrakCakupan;
  grade: string | null;
  gradeKey: string | null;
  bentuk: string | null;
  tebalMin: number | null;
  tebalMax: number | null;
  dims: KontrakDim[];
  nama: string | null;
  spesifikasi: string | null;
  partNo: string | null;
  kategori: string | null;
  satuan: string;
  harga: number | null;
  acuan: KontrakAcuan[];
  qtyKomitmen: number | null;
  materialBaru: boolean;
  vendorBerlaku: string | null;
  saldoQty: number;
  saldoNilai: number;
  saldoTgl: string | null;
  saldoKet: string | null;
}

export interface KontrakApproval {
  jenis: 'diskon' | 'pasokan';
  level: string;
  status: 'menunggu' | 'disetujui' | 'ditolak';
  byId?: string | null;
  byName?: string | null;
  note?: string | null;
  at?: string | null;
}

export interface KontrakItemReal {
  /** Qty terpakai dari PO terhubung (kg / satuan). */
  pakai: number;
  nilai: number;
  /** Per dimensi (id dimensi) atau per tebal ('t12') untuk cakupan semua dimensi. */
  rinci: Record<string, number>;
}

export interface Kontrak {
  id: string;
  nomor: string;
  noCustomer: string | null;
  jenis: KontrakJenis;
  skemaHarga: KontrakSkema;
  skemaCatatan: string | null;
  groupId: string | null;
  grupNama: string;
  entitas: string[];
  cabangs: string[];
  cabang: string;
  reg: number | null;
  tglMulai: string;
  tglAkhir: string;
  top: string | null;
  franco: string | null;
  catatan: string | null;
  status: KontrakStatus;
  level: string | null;
  maxDiscount: number | null;
  butuhPasokan: boolean;
  approvals: KontrakApproval[];
  prevId: string | null;
  prospectId: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  items: KontrakItem[];
  /** Realisasi per item (id item) — diisi server. */
  real?: Record<string, KontrakItemReal>;
  linkCount?: number;
  poCount?: number;
  /** Perpanjangan (kontrak yang prevId-nya kontrak ini). */
  nextId?: string | null;
  nextNomor?: string | null;
}

/** Satu baris PO terhubung (detail kontrak). */
export interface KontrakLinkView {
  id: string;
  kontrakItemId: string;
  dimId: string | null;
  prospectId: string;
  itemId: string;
  customer: string;
  cabang: string | null;
  se: string | null;
  noPo: string | null;
  tglPO: string | null;
  status: number;
  terfaktur: boolean;
  label: string;
  qty: number;
  nilai: number;
  harga: number | null;
  hargaKontrak: number | null;
  /** Selisih harga PO terhadap kontrak (%), null bila tidak ada harga kontrak. */
  beda: number | null;
  createdByName: string | null;
  createdAt: string;
}

/** Kandidat realisasi (Cari realisasi). */
export interface KontrakKandidat {
  prospectId: string;
  itemId: string;
  noPo: string | null;
  tglPO: string | null;
  status: number;
  terfaktur: boolean;
  customer: string;
  cabang: string | null;
  se: string | null;
  label: string;
  qty: number;
  qtySrc: string;
  harga: number | null;
  /** grup: kuat | beda | luar */
  grup: 'kuat' | 'beda' | 'luar';
  kontrakItemId: string | null;
  dimId: string | null;
  hargaKontrak: number | null;
  beda: number | null;
  alasan: string[];
  /** Sudah terhubung ke kontrak lain. */
  lain?: string | null;
}

export interface KontrakNamaMirip {
  prospectId: string;
  noPo: string | null;
  customer: string;
  mirip: string;
  cabang: string | null;
  nilai: number;
}

// ── tanggal & status ──────────────────────────────────────────────────────

export function dayDiffStr(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function kontrakState(k: Pick<Kontrak, 'status' | 'tglMulai' | 'tglAkhir'>, today: string): KontrakState {
  if (k.status !== 'aktif') return k.status;
  if (today < k.tglMulai) return 'belum';
  if (today > k.tglAkhir) return 'habis';
  return dayDiffStr(today, k.tglAkhir) <= AKAN_HABIS_HARI ? 'akanHabis' : 'aktif';
}

/** Kontrak berlaku (aktif, belum habis) — PO baru boleh memakainya. */
export function isBerlaku(k: Pick<Kontrak, 'status' | 'tglMulai' | 'tglAkhir'>, date: string): boolean {
  return k.status === 'aktif' && date >= k.tglMulai && date <= k.tglAkhir;
}

/** Porsi waktu kontrak yang sudah berjalan (0–1). */
export function waktuBerjalan(k: Pick<Kontrak, 'tglMulai' | 'tglAkhir'>, today: string): number {
  const total = dayDiffStr(k.tglMulai, k.tglAkhir) + 1;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (dayDiffStr(k.tglMulai, today) + 1) / total));
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return t.toISOString().slice(0, 10);
}

/** Akhir default = mulai + 12 bulan − 1 hari. */
export function defaultAkhir(mulai: string): string {
  const t = new Date(Date.parse(`${addMonths(mulai, 12)}T00:00:00Z`) - 86400000);
  return t.toISOString().slice(0, 10);
}

// ── angka & label ─────────────────────────────────────────────────────────

const n0 = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};
export const numOrNull = n0;

export const isKgItem = (it: Pick<KontrakItem, 'cakupan' | 'satuan'>) => it.cakupan !== 'spek' && (it.satuan || 'kg') === 'kg';

/** Qty untuk tampilan: kg → ton. */
export function fmtQty(v: number, satuan: string): string {
  if (satuan === 'kg') {
    const t = v / 1000;
    return `${t.toLocaleString('id-ID', { maximumFractionDigits: t >= 100 ? 0 : 1 })} t`;
  }
  return `${Math.round(v).toLocaleString('id-ID')} ${satuan}`;
}

export function dimLabel(d: Pick<KontrakDim, 'tebal' | 'lebar' | 'panjang'>, cakupan: KontrakCakupan): string {
  const f = (x: number | null) => (x == null ? '?' : String(x).replace('.', ','));
  if (cakupan === 'tebal') return `tebal ${f(d.tebal)} mm`;
  return `${f(d.tebal)} × ${f(d.lebar)} × ${f(d.panjang)} mm`;
}

export function itemTitle(it: Pick<KontrakItem, 'cakupan' | 'grade' | 'nama'>): string {
  return it.cakupan === 'spek' ? it.nama || '(material)' : it.grade || '(grade)';
}

export function itemCakupanText(it: KontrakItem): string {
  if (it.cakupan === 'spek') return [it.partNo ? `PN ${it.partNo}` : '', it.spesifikasi || '', it.satuan].filter(Boolean).join(' · ');
  if (it.cakupan === 'grade') {
    const r = it.tebalMin != null || it.tebalMax != null ? ` · tebal ${it.tebalMin ?? '…'}–${it.tebalMax ?? '…'} mm` : '';
    return `${CAKUPAN_LABEL.grade}${r}`;
  }
  return `${CAKUPAN_LABEL[it.cakupan]} · ${it.dims.length} ${it.cakupan === 'tebal' ? 'tebal' : 'dimensi'}`;
}

export interface DiscLine {
  label: string;
  acuan: number | null;
  harga: number | null;
  disc: number | null;
  src?: string;
}

/** Diskon per baris harga (dimensi / acuan) item. Kontrak qty: tidak ada harga. */
export function itemDiscLines(it: KontrakItem): DiscLine[] {
  const d = (a: number | null, h: number | null) => (a && a > 0 && h && h > 0 ? Math.round(((a - h) / a) * 1000) / 10 : null);
  if (it.cakupan === 'tebal' || it.cakupan === 'dimensi') return it.dims.map((x) => ({ label: dimLabel(x, it.cakupan), acuan: x.acuan, harga: x.harga, disc: d(x.acuan, x.harga), src: x.acuanSrc }));
  if (!it.acuan.length) return [{ label: it.cakupan === 'spek' ? it.nama || '' : 'semua dimensi', acuan: null, harga: it.harga, disc: null }];
  return it.acuan.map((a) => ({ label: a.label, acuan: a.acuan, harga: it.harga, disc: d(a.acuan, it.harga), src: a.src }));
}

/** Diskon tertinggi seluruh kontrak (null bila belum ada pembanding / kontrak qty). */
export function kontrakMaxDisc(k: Pick<Kontrak, 'jenis' | 'items'>): number | null {
  if (k.jenis === 'qty') return null;
  let m: number | null = null;
  k.items.forEach((it) => itemDiscLines(it).forEach((l) => { if (l.disc != null && (m == null || l.disc > m)) m = l.disc; }));
  return m;
}

/** Baris harga tanpa acuan (persetujuan tidak bisa dihitung). */
export function missingAcuan(k: Pick<Kontrak, 'jenis' | 'items'>): string[] {
  if (k.jenis === 'qty') return [];
  const out: string[] = [];
  k.items.forEach((it) => itemDiscLines(it).forEach((l) => { if (!l.acuan || !l.harga) out.push(`${itemTitle(it)} ${l.label}`.trim()); }));
  return out;
}

// ── pencocokan material ───────────────────────────────────────────────────

type Mat = Material & { grade?: string; bentuk?: string; dim?: Record<string, unknown>; itemId?: string; satuan?: string; hargaUnit?: number; fabNama?: string };

const alnum = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const same = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.01;

/**
 * Dimensi pelat material: dari spesifikasi terstruktur (dim), atau dibaca dari
 * uraian lama ("Pelat Creusabro 4800 t16 x 2000 x 6000", "TC 8000 12x2000x6000").
 */
export function matDims(m: Mat): { tebal: number | null; lebar: number | null; panjang: number | null } {
  const d = (m.dim || {}) as Record<string, unknown>;
  if (n0(d.tebal) != null) return { tebal: n0(d.tebal), lebar: n0(d.lebar), panjang: n0(d.panjang) };
  const text = String(m.uraian || '').toLowerCase().replace(/,/g, '.');
  const num3 = text.match(/(?:\bt\s*)?(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)/);
  if (num3) return { tebal: n0(num3[1]), lebar: n0(num3[2]), panjang: n0(num3[3]) };
  const t = text.match(/\b(?:t|tebal|thk|thick)\s*\.?\s*(\d+(?:\.\d+)?)/);
  return { tebal: t ? n0(t[1]) : null, lebar: null, panjang: null };
}

/** Harga material per satuan kontrak: per kg (baja) atau per unit. */
export function matPrice(m: Mat, satuan: string): number | null {
  if (satuan === 'kg') {
    if (num(m.hargaKg) > 0) return num(m.hargaKg);
    if (num(m.beratPc) > 0 && num(m.harga) > 0) return num(m.harga) / num(m.beratPc);
    return null;
  }
  if (num(m.harga) > 0) return num(m.harga);
  if (num(m.hargaUnit) > 0) return num(m.hargaUnit);
  if (num(m.hargaKg) > 0 && num(m.beratPc) > 0) return num(m.hargaKg) * num(m.beratPc);
  return null;
}

/** Grade dari uraian pelat lama: "Pelat Creusabro 4800 t16 x 2000 x 6000" → "Creusabro 4800". */
export function guessGrade(uraian: string): string {
  const m = String(uraian || '').match(/\b(?:pelat|plat|plate|pl)\.?\s+(.+?)\s+(?:t\s*)?\d+(?:[.,]\d+)?\s*(?:mm)?\s*[x×*]/i);
  return m ? m[1].trim() : '';
}

export interface KontrakMatch {
  item: KontrakItem;
  dim: KontrakDim | null;
  /** Harga kontrak per satuan item (null untuk kontrak qty / belum ada harga). */
  harga: number | null;
  /** Aturan yang cocok, untuk ditampilkan. */
  rule: string;
  /** Tingkat kekhususan: 3 dimensi, 2 tebal, 1 semua dimensi, 4 part number, 2 nama. */
  rank: number;
}

/** Aturan kontrak yang cocok dengan satu material prospek (paling spesifik), atau null. */
export function matchMaterial(k: Pick<Kontrak, 'items' | 'jenis'>, m: Mat): KontrakMatch | null {
  const text = `${m.uraian || ''} ${m.fabNama || ''}`.toLowerCase();
  const textA = alnum(text);
  const gk = m.grade ? stockGradeKey(String(m.grade)).key : '';
  const { tebal, lebar, panjang } = matDims(m);
  let best: KontrakMatch | null = null;
  const take = (c: KontrakMatch) => { if (!best || c.rank > best.rank) best = c; };
  k.items.forEach((it) => {
    if (it.cakupan === 'spek') {
      const pn = alnum(it.partNo);
      if (pn.length >= 3 && textA.includes(pn)) take({ item: it, dim: null, harga: k.jenis === 'qty' ? null : it.harga, rule: `part number ${it.partNo}`, rank: 4 });
      else if (it.nama && it.nama.trim().length >= 4 && text.includes(it.nama.trim().toLowerCase())) take({ item: it, dim: null, harga: k.jenis === 'qty' ? null : it.harga, rule: `nama ${it.nama}`, rank: 2 });
      return;
    }
    const ik = it.gradeKey || (it.grade ? stockGradeKey(it.grade).key : '');
    const gradeOk = !!ik && (gk ? gk === ik : textA.includes(ik.toLowerCase()));
    if (!gradeOk) return;
    if (it.cakupan === 'dimensi') {
      const d = it.dims.find((x) => same(x.tebal, tebal) && same(x.lebar, lebar) && same(x.panjang, panjang));
      if (d) take({ item: it, dim: d, harga: k.jenis === 'qty' ? null : d.harga, rule: `${it.grade} · dimensi ${dimLabel(d, 'dimensi')}`, rank: 3 });
    } else if (it.cakupan === 'tebal') {
      const d = it.dims.find((x) => same(x.tebal, tebal));
      if (d) take({ item: it, dim: d, harga: k.jenis === 'qty' ? null : d.harga, rule: `${it.grade} · tebal ${d.tebal} mm`, rank: 2 });
    } else {
      const okMin = it.tebalMin == null || (tebal != null && tebal >= it.tebalMin - 1e-9);
      const okMax = it.tebalMax == null || (tebal != null && tebal <= it.tebalMax + 1e-9);
      if (okMin && okMax) {
        const r = it.tebalMin != null || it.tebalMax != null ? ` (tebal ${tebal ?? '?'} dalam ${it.tebalMin ?? '…'}–${it.tebalMax ?? '…'})` : '';
        take({ item: it, dim: null, harga: k.jenis === 'qty' ? null : it.harga, rule: `${it.grade} · semua dimensi${r}`, rank: 1 });
      }
    }
  });
  return best;
}

/** Nama customer termasuk kontrak: sama dengan salah satu entitas atau nama grup. */
export function customerInKontrak(k: Pick<Kontrak, 'entitas' | 'grupNama'>, name: string): boolean {
  if (!name) return false;
  return [...k.entitas, k.grupNama].some((e) => e && sameCompany(e, name));
}

/** Nama customer mirip entitas kontrak (tapi tidak sama) — kandidat Satukan Nama Customer. */
export function customerMirip(k: Pick<Kontrak, 'entitas' | 'grupNama'>, name: string): string | null {
  if (!name || customerInKontrak(k, name)) return null;
  let best: string | null = null;
  let score = 0;
  [...k.entitas, k.grupNama].forEach((e) => {
    const s = nameSimilarity(e, name);
    if (s >= 0.8 && s > score) {
      best = e;
      score = s;
    }
  });
  return best;
}

export const cabUp = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/** Prospek masuk cakupan kontrak (customer + cabang). */
export function prospectInKontrak(k: Pick<Kontrak, 'entitas' | 'grupNama' | 'cabangs'>, p: { customer: string; cabang: string | null }): boolean {
  return k.cabangs.map(cabUp).includes(cabUp(p.cabang)) && customerInKontrak(k, p.customer);
}

/** Selisih harga PO terhadap harga kontrak (%). */
export function hargaBeda(harga: number | null, kontrak: number | null): number | null {
  if (!harga || !kontrak) return null;
  return Math.round(((harga - kontrak) / kontrak) * 1000) / 10;
}

/** Toleransi "harga sama" (pembulatan). */
export const SAMA_TOL = 0.3;
