/**
 * Hasil Lead Marketing: dari lead (prospek dengan leadAt/leadSource) sampai
 * penawaran, PO/DO dan omzet — per sumber dan per cabang, plus waktu respons
 * cabang (Sales ditunjuk, penawaran pertama) dan lead yang lewat batas waktu.
 * Client-safe.
 */
import { num } from './format';
import { isLead, leadSourceLabel, leadStage, type LeadStage } from './leads';
import type { OpsRules } from './ops-rules';
import type { Prospect } from './types';

const DAY = 86400000;
const ymd = (v: unknown) => String(v || '').slice(0, 10);
const days = (a: unknown, b: unknown) => (a && b ? Math.max(0, Math.round((Date.parse(String(b)) - Date.parse(String(a))) / DAY)) : null);

export interface LeadRow {
  p: Prospect;
  stage: LeadStage;
  source: string;
  sourceLabel: string;
  leadAt: string;
  age: number;
  /** Hari sampai Sales ditunjuk / penawaran pertama (null = belum / tidak tercatat). */
  dAssign: number | null;
  dQuote: number | null;
  quoted: boolean;
  won: boolean;
  lost: boolean;
  value: number;
  /** Lewat batas waktu saat ini (belum sampai penawaran). */
  overdue: '' | 'tugas' | 'penawaran' | 'eskalasi';
}

export interface LeadAgg {
  key: string;
  label: string;
  n: number;
  assigned: number;
  quoted: number;
  won: number;
  lost: number;
  wonValue: number;
  overdue: number;
  avgAssign: number | null;
  avgQuote: number | null;
  /** PO/DO ÷ lead. */
  conv: number | null;
  /** Nilai PO/DO per lead. */
  perLead: number;
}

export function leadRows(prospects: Prospect[], rules: Pick<OpsRules, 'leadTugasHari' | 'leadPenawaranHari' | 'leadEskalasiHari'>, today: string): LeadRow[] {
  return prospects.filter(isLead).map((p) => {
    const st = num(p.status);
    const leadAt = String(p.leadAt || p.createdAt);
    const quoted = (st >= 2 && st <= 5) || !!(p.penawaranTerkirim || p.leadQuotedAt);
    const won = st === 4 || st === 5;
    const age = days(leadAt, `${today}T12:00:00`) ?? 0;
    const dAssign = days(leadAt, p.leadAssignedAt);
    const dQuote = days(leadAt, p.leadQuotedAt);
    let overdue: LeadRow['overdue'] = '';
    if (st <= 1 && !quoted) {
      const sinceAssign = p.leadAssignedAt ? days(p.leadAssignedAt, `${today}T12:00:00`) ?? 0 : age;
      if (age > rules.leadEskalasiHari) overdue = 'eskalasi';
      else if (!(p.se || '').trim() && age > rules.leadTugasHari) overdue = 'tugas';
      else if ((p.se || '').trim() && sinceAssign > rules.leadPenawaranHari) overdue = 'penawaran';
    }
    return {
      p,
      stage: leadStage(p),
      source: p.leadSource || 'lainnya',
      sourceLabel: leadSourceLabel(p.leadSource) || 'Lainnya',
      leadAt,
      age,
      dAssign,
      dQuote,
      quoted,
      won,
      lost: st === 6,
      value: num(p.value),
      overdue,
    };
  });
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
};

export function aggregate(rows: LeadRow[], keyOf: (r: LeadRow) => string, labelOf: (r: LeadRow) => string): LeadAgg[] {
  const m = new Map<string, LeadRow[]>();
  rows.forEach((r) => {
    const k = keyOf(r);
    m.set(k, [...(m.get(k) || []), r]);
  });
  return [...m.entries()]
    .map(([key, list]) => {
      const won = list.filter((r) => r.won);
      const wonValue = won.reduce((s, r) => s + r.value, 0);
      return {
        key,
        label: labelOf(list[0]),
        n: list.length,
        assigned: list.filter((r) => (r.p.se || '').trim()).length,
        quoted: list.filter((r) => r.quoted).length,
        won: won.length,
        lost: list.filter((r) => r.lost).length,
        wonValue,
        overdue: list.filter((r) => r.overdue).length,
        avgAssign: avg(list.map((r) => r.dAssign)),
        avgQuote: avg(list.map((r) => r.dQuote)),
        conv: list.length ? won.length / list.length : null,
        perLead: list.length ? wonValue / list.length : 0,
      };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.n - a.n);
}

export const OVERDUE_LABEL: Record<Exclude<LeadRow['overdue'], ''>, string> = {
  tugas: 'Belum ditunjuk Sales',
  penawaran: 'Belum ada penawaran',
  eskalasi: 'Eskalasi RM',
};

/** Lead dalam rentang bulan (YYYY-MM, inklusif); kosong = semua. */
export const inMonths = (r: LeadRow, from: string, to: string) => !from || (ymd(r.leadAt).slice(0, 7) >= from && ymd(r.leadAt).slice(0, 7) <= to);
