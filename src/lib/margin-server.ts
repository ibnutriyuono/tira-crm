import { prisma } from './prisma';
import { canSeeHpp } from './roles';
import { checkQuoteMargins, priceKey, type MarginLine, type QuoteLineIn } from './margin-check';
import { getOpsRules } from './ops-escalation';
import type { SafeUser } from './types';

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

/**
 * Status margin surat: item di bawah batas, dan persetujuan VP yang berlaku
 * untuk harga yang sama. VP / Admin sendiri tidak perlu persetujuan.
 */
export async function marginStatus(user: SafeUser, prospectId: string, items: QuoteLineIn[]) {
  const rules = await getOpsRules();
  const lines = await checkQuoteMargins(prospectId, items, rules.marginMin);
  const below = lines.filter((l) => l.below);
  const key = priceKey(items);
  const latest = await prisma.marginApproval.findFirst({ where: { prospectId, priceKey: key }, orderBy: { createdAt: 'desc' } });
  const self = user.role === 'vp' || user.role === 'admin';
  const needs = below.length > 0 && !self && latest?.status !== 'disetujui';
  const hpp = canSeeHpp(user.role);
  return {
    minMargin: rules.marginMin,
    needs,
    checked: lines.filter((l) => l.checked).length,
    below: below.length,
    lines: lines.map((l) => (hpp ? l : { idx: l.idx, checked: l.checked, below: l.below })),
    approval: latest ? { id: latest.id, status: latest.status, decidedByName: latest.decidedByName, decisionNote: latest.decisionNote, decidedAt: latest.decidedAt?.toISOString() ?? null, createdAt: latest.createdAt.toISOString() } : null,
    key,
  };
}

export function approvalView(a: Awaited<ReturnType<typeof prisma.marginApproval.findFirst>> & object, withLines: boolean): MarginApprovalView {
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
    requestedByName: a.requestedByName,
    decidedByName: a.decidedByName,
    decisionNote: a.decisionNote,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    ...(withLines ? { lines: a.items as unknown as (MarginLine & { uraian: string })[] } : {}),
  };
}
