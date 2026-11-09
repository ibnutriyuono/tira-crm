import { prisma } from './prisma';
import { canSeeHpp } from './roles';
import { checkQuoteMargins, priceKey, type MarginLine, type QuoteLineIn } from './margin-check';
import { getOpsRules } from './ops-escalation';
import { asLevel, levelRank, MARGIN_LEVEL_LABEL, marginRank, requiredLevel, type MarginLevel } from './margin-tier';
import type { SafeUser } from './types';

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

export interface MarginApprovalView {
  id: string;
  prospectId: string;
  customer: string;
  cabang: string | null;
  se: string | null;
  nomor: string | null;
  status: string;
  alasan: string | null;
  minMargin: number;
  level: MarginLevel;
  lowestMargin: number | null;
  /** 'diskon' (aturan sekarang) | 'margin' (pengajuan lama). */
  basis: string;
  maxDiscount: number | null;
  /** User ini boleh memutuskan pengajuan ini. */
  canDecide?: boolean;
  requestedByName: string;
  decidedByName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** Hanya untuk role yang boleh melihat HPP. */
  lines?: (MarginLine & { uraian: string })[];
}

export function cleanQuoteItems(v: unknown): QuoteLineIn[] {
  const list = Array.isArray(v) ? v : [];
  return list.slice(0, 60).map((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const num = (k: string) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 0);
    return { line: String(o.line ?? '').slice(0, 20), uraian: String(o.uraian ?? '').slice(0, 300), grade: String(o.grade ?? '').slice(0, 60), qty: num('qty'), beratPc: num('beratPc'), hargaKg: num('hargaKg'), harga: num('harga') };
  });
}

/** Sisi aman untuk role tanpa HPP: harga jual Purchasing & diskon boleh, HPP & margin tidak. */
export function publicLine(l: MarginLine) {
  return { idx: l.idx, checked: l.checked, below: l.below, ref: l.ref, refSrc: l.refSrc, refDesc: l.refDesc, perPcs: l.perPcs, discount: l.discount };
}

/**
 * Status diskon surat: item dengan diskon di atas batas Sales, tingkat
 * penyetuju yang dibutuhkan (BM / GM / VP menurut diskon terbesar), dan
 * persetujuan yang berlaku untuk harga yang sama. Pembuat surat yang
 * wewenangnya sudah cukup tidak perlu persetujuan.
 */
export async function marginStatus(user: SafeUser, prospectId: string, items: QuoteLineIn[]) {
  const rules = await getOpsRules();
  const lines = await checkQuoteMargins(prospectId, items, rules.discSe);
  const below = lines.filter((l) => l.below);
  const maxDisc = below.length ? Math.max(...below.map((l) => l.discount ?? 0)) : null;
  const level: MarginLevel | null = maxDisc == null ? null : requiredLevel(maxDisc, rules);
  const key = priceKey(items);
  const latest = await prisma.marginApproval.findFirst({ where: { prospectId, priceKey: key }, orderBy: { createdAt: 'desc' } });
  const self = !!level && marginRank(user.role) >= levelRank(level);
  const approved = latest?.status === 'disetujui' && (!level || levelRank(asLevel(latest.level)) >= levelRank(level));
  const needs = below.length > 0 && !self && !approved;
  const hpp = canSeeHpp(user.role);
  return {
    discSe: rules.discSe,
    discBm: rules.discBm,
    discGm: rules.discGm,
    discVp: rules.discVp,
    maxDiscount: maxDisc,
    overVp: maxDisc != null && maxDisc > rules.discVp + 1e-9,
    level,
    levelLabel: level ? MARGIN_LEVEL_LABEL[level] : '',
    needs,
    checked: lines.filter((l) => l.checked).length,
    below: below.length,
    lines: lines.map((l) => (hpp ? l : publicLine(l))),
    approval: latest ? { id: latest.id, status: latest.status, decidedByName: latest.decidedByName, decisionNote: latest.decisionNote, decidedAt: latest.decidedAt?.toISOString() ?? null, createdAt: latest.createdAt.toISOString() } : null,
    key,
  };
}

/**
 * Penerima pengajuan: penyetuju tingkat yang dibutuhkan di cakupan prospek
 * (BM cabangnya, RM regionalnya, GM, VP); bila tidak ada akun aktif di tingkat
 * itu, naik ke tingkat berikutnya; terakhir Admin.
 */
export async function marginApproverIdsFor(level: MarginLevel, scope: { cabang: string | null; reg: number | null }): Promise<string[]> {
  return (await marginApproversFor(level, scope)).map((r) => r.id);
}

/** Penyetuju untuk satu tingkat: tingkat itu dulu, lalu naik bila kosong (BM → RM → GM → VP → Admin). */
export async function marginApproversFor(level: MarginLevel, scope: { cabang: string | null; reg: number | null }): Promise<{ id: string; name: string; role: string }[]> {
  for (const l of ['bm', 'rm', 'gm', 'vp'].slice(levelRank(level) - 1) as MarginLevel[]) {
    const where =
      l === 'bm'
        ? scope.cabang
          ? { role: 'bm' as const, cabang: { equals: scope.cabang, mode: 'insensitive' as const } }
          : null
        : l === 'rm'
          ? scope.reg != null
            ? { role: 'rm' as const, reg: scope.reg }
            : null
          : { role: l };
    if (!where) continue;
    const rows = await prisma.user.findMany({ where: { ...where, pausedAt: null }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
    if (rows.length) return rows;
  }
  return prisma.user.findMany({ where: { role: 'admin', pausedAt: null }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
}

/** Boleh memutuskan: wewenang ≥ tingkat pengajuan, di cakupannya (BM cabang, RM regional). VP belum ada → GM. */
export async function canDecideMargin(user: SafeUser, a: { level: string; cabang: string | null; reg: number | null }): Promise<boolean> {
  const level = asLevel(a.level);
  const rank = marginRank(user.role);
  if (rank >= 4) return true;
  if (rank >= levelRank(level)) {
    if (user.role === 'bm') return !!user.cabang && up(user.cabang) === up(a.cabang);
    if (user.role === 'rm') return user.reg != null && a.reg != null && user.reg === a.reg;
    return true;
  }
  if (level === 'vp' && user.role === 'gm') return (await prisma.user.count({ where: { role: 'vp', pausedAt: null } })) === 0;
  return false;
}

export function approvalView(a: Awaited<ReturnType<typeof prisma.marginApproval.findFirst>> & object, withLines: boolean | 'margin'): MarginApprovalView {
  return {
    id: a.id,
    prospectId: a.prospectId,
    customer: a.customer,
    cabang: a.cabang,
    se: a.se,
    nomor: a.nomor,
    status: a.status,
    alasan: a.alasan,
    minMargin: a.minMargin,
    level: asLevel(a.level),
    lowestMargin: a.lowestMargin ?? null,
    basis: a.basis,
    maxDiscount: a.maxDiscount ?? null,
    requestedByName: a.requestedByName,
    decidedByName: a.decidedByName,
    decisionNote: a.decisionNote,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    // BM: diskon + persentase margin, tanpa HPP. Role lain tanpa HPP: diskon & harga saja.
    ...(withLines === 'margin'
      ? { lines: (a.items as unknown as (MarginLine & { uraian: string })[]).map((l) => ({ ...l, hpp: null, rfqNo: '' })) }
      : withLines
        ? { lines: a.items as unknown as (MarginLine & { uraian: string })[] }
        : { lines: (a.items as unknown as (MarginLine & { uraian: string })[]).map((l) => ({ ...l, hpp: null, margin: null, rfqNo: '' })) }),
  };
}
