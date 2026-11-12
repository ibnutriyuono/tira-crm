import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { cabangRegMap } from './auth';
import { getProspectMaterials, num } from './format';
import { flowItems, idxKey, itemLabel } from './item-flow';
import { getOpsRules } from './ops-escalation';
import { levelRank, marginRank, requiredLevel, type MarginLevel } from './margin-tier';
import { marginApproversFor, canDecideMargin } from './margin-server';
import { isOpsLead, isGmLevel } from './roles';
import { branchUserIds, notify, opsLeadIds, purchasingUserIds, seUserIds } from './notify';
import { stockGradeKey } from './stock';
import { jakartaToday } from './followup-notify';
import {
  SATUAN_SPEK, cabUp, customerInKontrak, customerMirip, dayDiffStr, fmtQty, hargaBeda, isBerlaku, itemTitle, matDims, kontrakMaxDisc, matPrice, matchMaterial, missingAcuan, numOrNull, prospectInKontrak, SAMA_TOL, waktuBerjalan,
  type Kontrak, type KontrakApproval, type KontrakCakupan, type KontrakDim, type KontrakItem, type KontrakItemReal, type KontrakKandidat, type KontrakLinkView, type KontrakNamaMirip,
} from './kontrak';
import type { Material, Prospect, SafeUser } from './types';

type Row = Prisma.KontrakGetPayload<{ include: { items: true } }>;

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

export function toKontrak(r: Row): Kontrak {
  return {
    id: r.id,
    nomor: r.nomor,
    noCustomer: r.noCustomer,
    jenis: (['harga', 'qty', 'hq'].includes(r.jenis) ? r.jenis : 'hq') as Kontrak['jenis'],
    skemaHarga: (['tetap', 'tinjau', 'kurs'].includes(r.skemaHarga) ? r.skemaHarga : 'tetap') as Kontrak['skemaHarga'],
    skemaCatatan: r.skemaCatatan,
    groupId: r.groupId,
    grupNama: r.grupNama,
    entitas: arr(r.entitas),
    cabangs: arr(r.cabangs).map(cabUp),
    cabang: r.cabang,
    reg: r.reg,
    tglMulai: r.tglMulai,
    tglAkhir: r.tglAkhir,
    top: r.top,
    franco: r.franco,
    catatan: r.catatan,
    status: r.status as Kontrak['status'],
    level: r.level,
    maxDiscount: r.maxDiscount,
    butuhPasokan: r.butuhPasokan,
    approvals: (Array.isArray(r.approvals) ? r.approvals : []) as unknown as KontrakApproval[],
    prevId: r.prevId,
    prospectId: r.prospectId,
    createdById: r.createdById,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    items: [...r.items]
      .sort((a, b) => a.urut - b.urut)
      .map((i) => ({
        id: i.id,
        urut: i.urut,
        cakupan: i.cakupan as KontrakCakupan,
        grade: i.grade,
        gradeKey: i.gradeKey,
        bentuk: i.bentuk,
        tebalMin: i.tebalMin,
        tebalMax: i.tebalMax,
        dims: (Array.isArray(i.dims) ? i.dims : []) as unknown as KontrakDim[],
        nama: i.nama,
        spesifikasi: i.spesifikasi,
        partNo: i.partNo,
        kategori: i.kategori,
        satuan: i.satuan,
        harga: i.harga,
        acuan: (Array.isArray(i.acuan) ? i.acuan : []) as unknown as KontrakItem['acuan'],
        qtyKomitmen: i.qtyKomitmen,
        materialBaru: i.materialBaru,
        vendorBerlaku: i.vendorBerlaku,
        saldoQty: i.saldoQty,
        saldoNilai: i.saldoNilai,
        saldoTgl: i.saldoTgl,
        saldoKet: i.saldoKet,
      })),
  };
}

// ── akses ─────────────────────────────────────────────────────────────────

/** Menginput / mengubah kontrak: Admin Sales (cabangnya) dan Admin. */
export function canEditKontrak(user: SafeUser, k?: Pick<Kontrak, 'cabang' | 'cabangs'> | null): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'salesadmin') return false;
  if (!k) return true;
  const c = cabUp(user.cabang);
  return !!c && (cabUp(k.cabang) === c || k.cabangs.map(cabUp).includes(c));
}

/** Kontrak terlihat user: nasional untuk pimpinan; cabang / regional untuk role cabang. */
export async function scopeFilter(user: SafeUser): Promise<(k: Pick<Kontrak, 'cabang' | 'cabangs' | 'reg'>) => boolean> {
  const role = user.role;
  if (role === 'admin' || isGmLevel(role) || isOpsLead(role) || role === 'marketing') return () => true;
  if (role === 'rm') {
    const map = await cabangRegMap();
    return (k) => (user.reg != null && k.reg === user.reg) || k.cabangs.some((c) => map[cabUp(c)] === user.reg);
  }
  const c = cabUp(user.cabang);
  return (k) => !!c && (cabUp(k.cabang) === c || k.cabangs.map(cabUp).includes(c));
}

// ── input ─────────────────────────────────────────────────────────────────

const str = (v: unknown, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
let dimSeq = 0;
const newDimId = () => `d${Date.now().toString(36)}${(dimSeq++).toString(36)}`;

export interface KontrakInput {
  noCustomer: string | null;
  jenis: Kontrak['jenis'];
  skemaHarga: Kontrak['skemaHarga'];
  skemaCatatan: string | null;
  groupId: string | null;
  grupNama: string;
  entitas: string[];
  cabangs: string[];
  tglMulai: string;
  tglAkhir: string;
  top: string | null;
  franco: string | null;
  catatan: string | null;
  prevId: string | null;
  prospectId: string | null;
  items: Omit<KontrakItem, 'id'>[];
}

/** Bersihkan body form kontrak. Mengembalikan pesan galat bila tidak lengkap. */
export function cleanKontrakInput(b: Record<string, unknown>): KontrakInput | { error: string } {
  const jenis = (['harga', 'qty', 'hq'].includes(String(b.jenis)) ? String(b.jenis) : 'hq') as Kontrak['jenis'];
  const skemaHarga = (['tetap', 'tinjau', 'kurs'].includes(String(b.skemaHarga)) ? String(b.skemaHarga) : 'tetap') as Kontrak['skemaHarga'];
  const entitas = Array.from(new Set(arr(b.entitas).map((s) => s.trim().slice(0, 200)).filter(Boolean))).slice(0, 60);
  const cabangs = Array.from(new Set(arr(b.cabangs).map(cabUp).filter(Boolean))).slice(0, 20);
  const grupNama = str(b.grupNama, 200) || entitas[0] || '';
  if (!grupNama) return { error: 'Pilih grup customer atau isi minimal satu entitas customer.' };
  if (!entitas.length) return { error: 'Centang minimal satu entitas customer yang terikat kontrak.' };
  if (!cabangs.length) return { error: 'Pilih minimal satu cabang berlaku.' };
  if (!isDate(b.tglMulai) || !isDate(b.tglAkhir)) return { error: 'Isi tanggal mulai dan berakhir kontrak.' };
  if (String(b.tglAkhir) < String(b.tglMulai)) return { error: 'Tanggal berakhir harus setelah tanggal mulai.' };
  const rawItems = Array.isArray(b.items) ? b.items.slice(0, 80) : [];
  const items: Omit<KontrakItem, 'id'>[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const o = (rawItems[i] && typeof rawItems[i] === 'object' ? rawItems[i] : {}) as Record<string, unknown>;
    const cakupan = (['grade', 'tebal', 'dimensi', 'spek'].includes(String(o.cakupan)) ? String(o.cakupan) : 'grade') as KontrakCakupan;
    const grade = cakupan === 'spek' ? null : str(o.grade, 60);
    const nama = cakupan === 'spek' ? str(o.nama, 200) : null;
    if (cakupan !== 'spek' && !grade) return { error: `Item ${i + 1}: pilih grade.` };
    if (cakupan === 'spek' && !nama) return { error: `Item ${i + 1}: isi nama material.` };
    const dims: KontrakDim[] = (Array.isArray(o.dims) ? o.dims : []).slice(0, 60).map((x) => {
      const d = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      return {
        id: String(d.id || '') || newDimId(),
        tebal: numOrNull(d.tebal),
        lebar: cakupan === 'dimensi' ? numOrNull(d.lebar) : null,
        panjang: cakupan === 'dimensi' ? numOrNull(d.panjang) : null,
        harga: jenis === 'qty' ? null : numOrNull(d.harga),
        acuan: jenis === 'qty' ? null : numOrNull(d.acuan),
        acuanSrc: str(d.acuanSrc, 120) || undefined,
      };
    }).filter((d) => d.tebal != null);
    if ((cakupan === 'tebal' || cakupan === 'dimensi') && !dims.length) return { error: `Item ${i + 1}: isi minimal satu ${cakupan === 'tebal' ? 'tebal' : 'dimensi'}.` };
    if (cakupan === 'dimensi' && dims.some((d) => d.lebar == null || d.panjang == null)) return { error: `Item ${i + 1}: dimensi tertentu perlu tebal × lebar × panjang.` };
    const acuan = (Array.isArray(o.acuan) ? o.acuan : []).slice(0, 30).map((x) => {
      const a = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      return { label: String(a.label || '').slice(0, 80), tebal: numOrNull(a.tebal), acuan: num(a.acuan), src: str(a.src, 120) || undefined };
    }).filter((a) => a.acuan > 0);
    const satuan = cakupan === 'spek' ? (SATUAN_SPEK.includes(String(o.satuan)) ? String(o.satuan) : 'pcs') : 'kg';
    const harga = jenis === 'qty' || cakupan === 'tebal' || cakupan === 'dimensi' ? null : numOrNull(o.harga);
    if (jenis !== 'qty' && (cakupan === 'grade' || cakupan === 'spek') && !(harga && harga > 0)) return { error: `Item ${i + 1}: isi harga kontrak.` };
    if (jenis !== 'qty' && (cakupan === 'tebal' || cakupan === 'dimensi') && dims.some((d) => !(d.harga && d.harga > 0))) return { error: `Item ${i + 1}: isi harga kontrak tiap ${cakupan === 'tebal' ? 'tebal' : 'dimensi'}.` };
    const qtyKomitmen = jenis === 'harga' ? null : numOrNull(o.qtyKomitmen);
    if (jenis !== 'harga' && !(qtyKomitmen && qtyKomitmen > 0)) return { error: `Item ${i + 1}: isi qty komitmen.` };
    items.push({
      urut: i,
      cakupan,
      grade,
      gradeKey: grade ? stockGradeKey(grade).key : null,
      bentuk: cakupan === 'spek' ? null : str(o.bentuk, 40) || 'Plate',
      tebalMin: cakupan === 'grade' ? numOrNull(o.tebalMin) : null,
      tebalMax: cakupan === 'grade' ? numOrNull(o.tebalMax) : null,
      dims: cakupan === 'tebal' || cakupan === 'dimensi' ? dims : [],
      nama,
      spesifikasi: cakupan === 'spek' ? str(o.spesifikasi, 500) : null,
      partNo: cakupan === 'spek' ? str(o.partNo, 80) : null,
      kategori: cakupan === 'spek' ? str(o.kategori, 80) : null,
      satuan,
      harga,
      acuan: cakupan === 'grade' || cakupan === 'spek' ? acuan : [],
      qtyKomitmen,
      materialBaru: cakupan === 'spek' ? o.materialBaru !== false : !!o.materialBaru,
      vendorBerlaku: isDate(o.vendorBerlaku) ? String(o.vendorBerlaku) : null,
      saldoQty: num(o.saldoQty),
      saldoNilai: num(o.saldoNilai),
      saldoTgl: isDate(o.saldoTgl) ? String(o.saldoTgl) : null,
      saldoKet: str(o.saldoKet, 300),
    });
  }
  if (!items.length) return { error: 'Tambahkan minimal satu item kontrak.' };
  return {
    noCustomer: str(b.noCustomer, 80),
    jenis,
    skemaHarga,
    skemaCatatan: str(b.skemaCatatan, 300),
    groupId: str(b.groupId, 40),
    grupNama,
    entitas,
    cabangs,
    tglMulai: String(b.tglMulai),
    tglAkhir: String(b.tglAkhir),
    top: str(b.top, 60),
    franco: str(b.franco, 120),
    catatan: str(b.catatan, 1000),
    prevId: str(b.prevId, 40),
    prospectId: str(b.prospectId, 40),
    items,
  };
}

export function itemCreateData(items: Omit<KontrakItem, 'id'>[]) {
  return items.map((it) => ({
    ...it,
    dims: it.dims as unknown as Prisma.InputJsonValue,
    acuan: it.acuan as unknown as Prisma.InputJsonValue,
  }));
}

export async function nextNomor(tglMulai: string): Promise<string> {
  const year = (tglMulai || jakartaToday()).slice(0, 4);
  const prefix = `KH-${year}-`;
  const rows = await prisma.kontrak.findMany({ where: { nomor: { startsWith: prefix } }, select: { nomor: true } });
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.nomor.slice(prefix.length), 10) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export async function logKontrak(kontrakId: string, aksi: string, ket: string | null, byName: string | null) {
  await prisma.kontrakLog.create({ data: { kontrakId, aksi, ket: ket ? ket.slice(0, 1000) : null, byName } });
}

// ── persetujuan ───────────────────────────────────────────────────────────

/** Persetujuan yang dibutuhkan kontrak (diskon menurut aturan Surat Penawaran + pasokan material baru). */
export async function neededApprovals(k: Pick<Kontrak, 'jenis' | 'items'>): Promise<{ maxDisc: number | null; level: MarginLevel | null; butuhPasokan: boolean; missing: string[] }> {
  const rules = await getOpsRules();
  const maxDisc = kontrakMaxDisc(k);
  const level = maxDisc != null && maxDisc > rules.discSe + 1e-9 ? requiredLevel(maxDisc, rules) : null;
  return { maxDisc, level, butuhPasokan: k.items.some((i) => i.materialBaru), missing: missingAcuan(k) };
}

export async function canDecideKontrak(user: SafeUser, k: Pick<Kontrak, 'cabang' | 'reg'>, a: KontrakApproval): Promise<boolean> {
  if (a.status !== 'menunggu') return false;
  if (a.jenis === 'pasokan') return isOpsLead(user.role) || user.role === 'admin';
  return canDecideMargin(user, { level: a.level, cabang: k.cabang, reg: k.reg });
}

export async function approverIds(k: Pick<Kontrak, 'cabang' | 'reg'>, a: KontrakApproval): Promise<string[]> {
  if (a.jenis === 'pasokan') return opsLeadIds();
  return (await marginApproversFor(a.level as MarginLevel, { cabang: k.cabang, reg: k.reg })).map((r) => r.id);
}

/** Pengaju dengan wewenang cukup tidak perlu menunggu persetujuannya sendiri. */
export function selfApproves(user: SafeUser, a: KontrakApproval): boolean {
  if (a.jenis === 'pasokan') return isOpsLead(user.role) || user.role === 'admin';
  return marginRank(user.role) >= levelRank(a.level as MarginLevel);
}

// ── realisasi ─────────────────────────────────────────────────────────────

type PRow = Pick<Prospect, 'id' | 'customer' | 'cabang' | 'se' | 'noPo' | 'tglPO' | 'status' | 'terfaktur' | 'materials' | 'qty' | 'value' | 'line' | 'uraian'> & { statusChangedAt?: Date | string };
type Mat = Material & { itemId?: string; grade?: string; dim?: Record<string, unknown> };

/** Qty PO item prospek dalam satuan kontrak (kg / satuan) + sumbernya. */
export function lineQty(p: PRow, idx: number, satuan: string): { qty: number; src: string; pcs: number } {
  const flows = flowItems(p as unknown as Prospect);
  const f = flows[idx];
  const mats = getProspectMaterials(p as unknown as Prospect) as Mat[];
  const m = mats[idx];
  const pcs = f ? (f.po ?? 0) : 0;
  const src = f?.poConfirmed ? 'qty PO dikonfirmasi' : 'qty prospek';
  if (satuan === 'kg') {
    const kg = pcs * num(m?.beratPc);
    return { qty: kg, src: num(m?.beratPc) > 0 ? `${src} · ${pcs} pcs × ${num(m?.beratPc).toLocaleString('id-ID')} kg` : src, pcs };
  }
  return { qty: pcs, src, pcs };
}

function matAt(p: PRow, itemId: string): { m: Mat; idx: number } | null {
  const mats = getProspectMaterials(p as unknown as Prospect) as Mat[];
  const idx = mats.findIndex((m, i) => (m.itemId || idxKey(i)) === itemId);
  return idx < 0 ? null : { m: mats[idx], idx };
}

const PROSPECT_SELECT = { id: true, customer: true, cabang: true, se: true, noPo: true, tglPO: true, status: true, terfaktur: true, materials: true, qty: true, value: true, line: true, uraian: true, statusChangedAt: true } as const;

/** Realisasi + PO terhubung untuk beberapa kontrak sekaligus. */
export async function realisasi(ks: Kontrak[]): Promise<Map<string, { real: Record<string, KontrakItemReal>; links: KontrakLinkView[]; poCount: number }>> {
  const out = new Map<string, { real: Record<string, KontrakItemReal>; links: KontrakLinkView[]; poCount: number }>();
  if (!ks.length) return out;
  const links = await prisma.kontrakLink.findMany({ where: { kontrakId: { in: ks.map((k) => k.id) } }, orderBy: { createdAt: 'desc' } });
  const pids = Array.from(new Set(links.map((l) => l.prospectId)));
  const ps = pids.length ? ((await prisma.prospect.findMany({ where: { id: { in: pids } }, select: PROSPECT_SELECT })) as unknown as PRow[]) : [];
  const pById = new Map(ps.map((p) => [p.id, p]));
  ks.forEach((k) => {
    const real: Record<string, KontrakItemReal> = {};
    k.items.forEach((it) => (real[it.id] = { pakai: 0, nilai: 0, rinci: {} }));
    const views: KontrakLinkView[] = [];
    const poSet = new Set<string>();
    links.filter((l) => l.kontrakId === k.id).forEach((l) => {
      const p = pById.get(l.prospectId);
      const it = k.items.find((x) => x.id === l.kontrakItemId);
      if (!p || !it) return;
      const at = matAt(p, l.itemId);
      if (!at) return;
      if (num(p.status) === 6) return;
      const { qty } = lineQty(p, at.idx, it.satuan);
      const harga = matPrice(at.m, it.satuan);
      const nilai = harga ? qty * harga : 0;
      const dim = l.dimId ? it.dims.find((d) => d.id === l.dimId) : null;
      const hk = k.jenis === 'qty' ? null : dim ? dim.harga : it.harga;
      const r = real[it.id];
      r.pakai += qty;
      r.nilai += nilai;
      const tb = matDims(at.m).tebal;
      const key = dim ? dim.id : tb != null ? `t${tb}` : '-';
      r.rinci[key] = (r.rinci[key] || 0) + qty;
      poSet.add(p.id);
      views.push({
        id: l.id, kontrakItemId: l.kontrakItemId, dimId: l.dimId, prospectId: p.id, itemId: l.itemId, customer: p.customer, cabang: p.cabang, se: p.se, noPo: p.noPo, tglPO: p.tglPO,
        status: num(p.status), terfaktur: !!p.terfaktur, label: itemLabel(at.m), qty, nilai, harga, hargaKontrak: hk, beda: hargaBeda(harga, hk), createdByName: l.createdByName, createdAt: l.createdAt.toISOString(),
      });
    });
    out.set(k.id, { real, links: views, poCount: poSet.size });
  });
  return out;
}

const tglOf = (p: PRow) => (p.tglPO || (p.statusChangedAt ? new Date(p.statusChangedAt).toISOString() : '')).slice(0, 10);

/** Cari realisasi: item prospek PO/DO yang mungkin milik kontrak ini. */
export async function kandidat(k: Kontrak): Promise<{ rows: KontrakKandidat[]; mirip: KontrakNamaMirip[] }> {
  const today = jakartaToday();
  const until = k.tglAkhir < today ? k.tglAkhir : today;
  const ps = (await prisma.prospect.findMany({ where: { status: { in: [4, 5] } }, select: PROSPECT_SELECT })) as unknown as PRow[];
  const cabs = k.cabangs.map(cabUp);
  const inRange = (p: PRow) => {
    const t = tglOf(p);
    return !!t && t >= k.tglMulai && t <= until;
  };
  const mine = ps.filter((p) => cabs.includes(cabUp(p.cabang)) && inRange(p));
  const linked = await prisma.kontrakLink.findMany({ where: { prospectId: { in: mine.map((p) => p.id) } }, select: { prospectId: true, itemId: true, kontrakId: true } });
  const others = new Map<string, string>();
  const lk = linked.filter((l) => l.kontrakId !== k.id);
  if (lk.length) {
    const ok = await prisma.kontrak.findMany({ where: { id: { in: Array.from(new Set(lk.map((l) => l.kontrakId))) } }, select: { id: true, nomor: true } });
    const nom = new Map(ok.map((x) => [x.id, x.nomor]));
    lk.forEach((l) => others.set(`${l.prospectId}|${l.itemId}`, nom.get(l.kontrakId) || 'kontrak lain'));
  }
  const self = new Set(linked.filter((l) => l.kontrakId === k.id).map((l) => `${l.prospectId}|${l.itemId}`));
  const rows: KontrakKandidat[] = [];
  const mirip: KontrakNamaMirip[] = [];
  mine.forEach((p) => {
    if (!customerInKontrak(k, p.customer)) {
      const mm = customerMirip(k, p.customer);
      if (mm) mirip.push({ prospectId: p.id, noPo: p.noPo, customer: p.customer, mirip: mm, cabang: p.cabang, nilai: num(p.value) });
      return;
    }
    const mats = getProspectMaterials(p as unknown as Prospect) as Mat[];
    mats.forEach((m, idx) => {
      const itemId = m.itemId || idxKey(idx);
      const key = `${p.id}|${itemId}`;
      if (self.has(key)) return;
      const match = matchMaterial(k, m);
      const satuan = match?.item.satuan || 'kg';
      const { qty, src } = lineQty(p, idx, satuan);
      if (qty <= 0 && match) return;
      const harga = matPrice(m, satuan);
      const base = { prospectId: p.id, itemId, noPo: p.noPo, tglPO: tglOf(p), status: num(p.status), terfaktur: !!p.terfaktur, customer: p.customer, cabang: p.cabang, se: p.se, label: itemLabel(m), qty, qtySrc: src, harga, lain: others.get(key) || null };
      if (!match) {
        rows.push({ ...base, grup: 'luar', kontrakItemId: null, dimId: null, hargaKontrak: null, beda: null, alasan: ['material di luar kontrak'] });
        return;
      }
      const beda = hargaBeda(harga, match.harga);
      const alasan = [match.rule];
      const noKontrak = [k.noCustomer, k.nomor].filter(Boolean).map((s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, ''));
      const poA = String(p.noPo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const viaNo = noKontrak.some((x) => x.length >= 4 && poA.includes(x));
      if (viaNo) alasan.push('No PO memuat nomor kontrak');
      const hargaSama = k.jenis === 'qty' || (beda != null && Math.abs(beda) <= SAMA_TOL);
      if (k.jenis !== 'qty') alasan.push(beda == null ? 'harga belum bisa dibandingkan' : hargaSama ? 'harga sama' : `harga beda ${beda > 0 ? '+' : ''}${String(beda).replace('.', ',')}%`);
      rows.push({ ...base, grup: hargaSama || viaNo ? 'kuat' : 'beda', kontrakItemId: match.item.id, dimId: match.dim?.id || null, hargaKontrak: match.harga, beda, alasan });
    });
  });
  rows.sort((a, b) => (b.tglPO || '').localeCompare(a.tglPO || ''));
  return { rows, mirip };
}

/** Kontrak berlaku untuk satu prospek + kecocokan per item (panel prospek). */
export async function kontrakForProspect(p: PRow, user: SafeUser) {
  const date = (p.tglPO || jakartaToday()).slice(0, 10);
  const rows = (await prisma.kontrak.findMany({ where: { status: 'aktif' }, include: { items: true } })).map(toKontrak);
  const visible = await scopeFilter(user);
  const ks = rows.filter((k) => prospectInKontrak(k, p) && visible(k));
  const links = await prisma.kontrakLink.findMany({ where: { prospectId: p.id } });
  const mats = getProspectMaterials(p as unknown as Prospect) as Mat[];
  return ks.map((k) => ({
    kontrak: { id: k.id, nomor: k.nomor, jenis: k.jenis, grupNama: k.grupNama, tglMulai: k.tglMulai, tglAkhir: k.tglAkhir, berlaku: isBerlaku(k, date) },
    items: mats.map((m, idx) => {
      const itemId = m.itemId || idxKey(idx);
      const match = matchMaterial(k, m);
      const link = links.find((l) => l.itemId === itemId);
      const satuan = match?.item.satuan || 'kg';
      const harga = matPrice(m, satuan);
      return {
        itemId, label: itemLabel(m), kontrakItemId: match?.item.id || null, dimId: match?.dim?.id || null, rule: match?.rule || null, hargaKontrak: match?.harga ?? null, harga, beda: hargaBeda(harga, match?.harga ?? null),
        linked: link ? (link.kontrakId === k.id ? 'ini' : 'lain') : null,
      };
    }),
  }));
}

// ── pengingat ─────────────────────────────────────────────────────────────

/** Penerima pengingat: Admin Sales & BM cabang berlaku, pembuat, dan SE prospek entitas kontrak. */
export async function kontrakRecipients(k: Kontrak, withGm = false): Promise<string[]> {
  const ids = new Set<string>([k.createdById]);
  for (const c of k.cabangs) (await branchUserIds(c, ['salesadmin', 'bm'])).forEach((id) => ids.add(id));
  const ps = await prisma.prospect.findMany({ where: { cabang: { in: k.cabangs, mode: 'insensitive' }, status: { in: [2, 3, 4, 5] } }, select: { customer: true, se: true } });
  const ses = Array.from(new Set(ps.filter((p) => customerInKontrak(k, p.customer)).map((p) => (p.se || '').trim()).filter(Boolean)));
  for (const se of ses) (await seUserIds(se)).forEach((id) => ids.add(id));
  if (withGm) (await prisma.user.findMany({ where: { pausedAt: null, role: { in: ['gm', 'vp'] } }, select: { id: true } })).forEach((u) => ids.add(u.id));
  return Array.from(ids);
}

const REMINDERS: { key: string; hari: number; gm: boolean }[] = [
  { key: 'h90', hari: 90, gm: false },
  { key: 'h60', hari: 60, gm: false },
  { key: 'h30', hari: 30, gm: true },
  { key: 'h7', hari: 7, gm: true },
];

let lastSweep = 0;
/**
 * Pengingat kontrak (dipanggil pengecekan otomatis tiap 5 menit): H-90 / H-60 /
 * H-30 / H-7 sebelum habis, saat habis, dan masa berlaku harga vendor item
 * material baru (H-60, ke Purchasing). Sekali per tahap per kontrak.
 */
export async function sweepKontrakReminders(opts: { force?: boolean; today?: string } = {}): Promise<void> {
  if (!opts.force && Date.now() - lastSweep < 5 * 60 * 1000) return;
  lastSweep = Date.now();
  try {
    const today = opts.today || jakartaToday();
    const rows = (await prisma.kontrak.findMany({ where: { status: 'aktif' }, include: { items: true } })).map((r) => ({ k: toKontrak(r), sent: ((r.remindersSent as Record<string, string>) || {}) as Record<string, string> }));
    if (!rows.length) return;
    const reals = await realisasi(rows.map((r) => r.k));
    for (const { k, sent } of rows) {
      const next = { ...sent };
      const sisa = dayDiffStr(today, k.tglAkhir);
      const re = reals.get(k.id);
      const kg = k.items.filter((i) => i.satuan === 'kg');
      const kom = kg.reduce((s, it) => s + num(it.qtyKomitmen), 0);
      const pakai = kg.reduce((s, it) => s + (re?.real[it.id]?.pakai || 0) + num(it.saldoQty), 0);
      const realTxt = kom > 0 ? ` Realisasi ${fmtQty(pakai, 'kg')} / ${fmtQty(kom, 'kg')} (${Math.round((pakai / kom) * 100)}%, waktu berjalan ${Math.round(waktuBerjalan(k, today) * 100)}%).` : '';
      if (today > k.tglAkhir) {
        if (!next.habis) {
          await notify({ userIds: await kontrakRecipients(k), type: 'kontrak_reminder', entity: 'kontrak', entityId: k.id, title: `Kontrak ${k.nomor} habis`, message: `${k.grupNama} · berakhir ${k.tglAkhir}. PO baru tidak lagi memakai harga kontrak ini.${realTxt}`.slice(0, 300) });
          next.habis = today;
        }
      } else if (today >= k.tglMulai) {
        // Hanya tahap terdekat yang belum terkirim (kontrak yang baru diinput tidak mendapat semua pengingat sekaligus).
        const due = REMINDERS.filter((r) => sisa <= r.hari && !next[r.key]);
        const r = due[due.length - 1];
        if (r) {
          const nextNo = await prisma.kontrak.findFirst({ where: { prevId: k.id, status: { in: ['draft', 'menunggu', 'aktif'] } }, select: { nomor: true, status: true } });
          const lanj = nextNo ? ` Perpanjangan ${nextNo.nomor} (${nextNo.status}).` : r.hari <= 60 ? ' Belum ada draft perpanjangan.' : '';
          await notify({ userIds: await kontrakRecipients(k, r.gm), type: 'kontrak_reminder', entity: 'kontrak', entityId: k.id, title: `Kontrak ${k.nomor} habis ${sisa} hari lagi`, message: `${k.grupNama} · berakhir ${k.tglAkhir}.${realTxt}${lanj}`.slice(0, 300) });
          due.forEach((d) => (next[d.key] = today));
        }
      }
      // Harga vendor item material baru.
      for (const it of k.items) {
        if (!it.vendorBerlaku || today > k.tglAkhir) continue;
        const key = `vendor:${it.id}`;
        if (next[key] || dayDiffStr(today, it.vendorBerlaku) > 60 || it.vendorBerlaku >= k.tglAkhir) continue;
        await notify({ userIds: await purchasingUserIds(), type: 'kontrak_reminder', entity: 'kontrak', entityId: k.id, title: `Harga vendor ${itemTitle(it)} berlaku s.d. ${it.vendorBerlaku}`, message: `Kontrak ${k.nomor} (${k.grupNama}) berlaku s.d. ${k.tglAkhir}. Minta perpanjangan harga vendor atau siapkan revisi harga kontrak.`.slice(0, 300) });
        next[key] = today;
      }
      if (JSON.stringify(next) !== JSON.stringify(sent)) await prisma.kontrak.update({ where: { id: k.id }, data: { remindersSent: next } });
    }
  } catch (err) {
    console.error('[kontrak] reminder sweep failed:', err);
  }
}

export { cabUp };
