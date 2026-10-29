/**
 * Analisa Eksekutif — bagian Aktivitas, Cabang, Customer, Operasional.
 * Fungsi murni (client & PPT memakai angka yang sama). Semua definisi
 * mengikuti exec-analysis.ts: deal menang = status PO/DO, tanggal menang =
 * Tgl PO → Tgl Delivery → Tgl Penawaran; kalah = status Lose, tanggal Lose.
 */
import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_TARGETS, STAGE_PROBABILITY } from './constants';
import { classify, num } from './format';
import { lostDateOf } from './lose-date';
import { customerKey } from './reports';
import { isOpenIssue, issueCatLabel, type PipelineIssue } from './issues';
import { rfqAsWorkflowDoc, workflowStage } from './purchasing-workflow';
import type { CustomerGroup, Fupa, Prospect, Rfq, SalesActivity } from './types';

const DAY = 86400000;
const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const days = (from: string, to: string) => Math.floor((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
export const wonDateOf = (r: Prospect) => r.tglPO || r.tglDelivery || r.tglPenawaran || '';
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const CUST_TYPES = ACTIVITY_TYPES.map((t) => t.key as string);

export interface Range {
  months: string[];
  today: string;
}
const inRange = (r: Range) => {
  const set = new Set(r.months);
  return (d: string | null | undefined) => !!d && set.has(d.slice(0, 7));
};
/** Bulan-bulan sebelum rentang dengan panjang yang sama (pembanding). */
export function prevMonths(months: string[]): string[] {
  if (!months.length) return [];
  const [y, m] = months[0].split('-').map(Number);
  return months.map((_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - months.length + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

// ================================================================ AKTIVITAS

export interface ActSeRow {
  se: string;
  cabang: string;
  counts: Record<string, number>;
  total: number;
  /** Target periode (default per bulan × jumlah bulan). */
  target: number;
  achieve: number | null;
  hariAktif: number;
  lastDate: string | null;
  idle: number | null;
  verifPct: number | null;
  custTouched: number;
  converted: number;
  toPo: number;
  won: number;
  wonCount: number;
  /** Realisasi per kunjungan (Rp). */
  wonPerVisit: number | null;
}

export interface ActCabangRow {
  cabang: string;
  seCount: number;
  total: number;
  perSe: number;
  kunjungan: number;
  kunjPerSe: number;
  verifPct: number | null;
  custTouched: number;
  activeCust: number;
  /** Customer aktif yang disentuh. */
  covered: number;
  coveragePct: number | null;
  converted: number;
  convPct: number | null;
  won: number;
  lowSe: number;
}

export interface ActivityAnalysis {
  total: number;
  byType: { tipe: string; label: string; count: number; target: number; pct: number | null }[];
  prevTotal: number;
  changePct: number | null;
  weeks: { label: string; counts: Record<string, number> }[];
  weekday: { label: string; count: number }[];
  custTouched: number;
  converted: number;
  convPct: number | null;
  toPo: number;
  verifPct: number | null;
  phoneResult: { label: string; count: number }[];
  seRows: ActSeRow[];
  cabangRows: ActCabangRow[];
  idleSe: ActSeRow[];
  insights: string[];
}

const HASIL_LABEL: Record<string, string> = { tersambung: 'Tersambung', tidak_diangkat: 'Tidak diangkat', belum_dibalas: 'Belum dibalas', minta_lagi: 'Minta dihubungi lagi' };
const WD = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function buildActivityAnalysis(inp: {
  activities: SalesActivity[];
  prospects: Prospect[];
  range: Range;
  /** Kode SE milik staf (GM, Purchasing, …) — bukan Sales cabang. */
  isStaff: (se: string) => boolean;
  cabangFilter?: string;
}): ActivityAnalysis {
  const { range } = inp;
  const inR = inRange(range);
  const prevR = inRange({ months: prevMonths(range.months), today: range.today });
  const cf = up(inp.cabangFilter);
  const base = inp.activities.filter((a) => a.status !== 'rencana' && CUST_TYPES.includes(a.tipe) && !inp.isStaff(a.se) && (!cf || up(a.cabang) === cf));
  const acts = base.filter((a) => inR(a.tanggal));
  const prevTotal = base.filter((a) => prevR(a.tanggal)).length;
  const nMonths = range.months.length || 1;
  const prospById = new Map(inp.prospects.map((p) => [p.id, p]));

  // Pekan (Senin) dalam rentang.
  const weekKey = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const wk = new Map<string, Record<string, number>>();
  acts.forEach((a) => {
    const k = weekKey(a.tanggal);
    const o = wk.get(k) || {};
    o[a.tipe] = (o[a.tipe] || 0) + 1;
    wk.set(k, o);
  });
  const weeks = Array.from(wk.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-16)
    .map(([k, counts]) => ({ label: `${k.slice(8, 10)}/${k.slice(5, 7)}`, counts }));
  const wdc = [0, 0, 0, 0, 0, 0, 0];
  acts.forEach((a) => wdc[new Date(`${a.tanggal}T00:00:00Z`).getUTCDay()]++);
  const weekday = [1, 2, 3, 4, 5, 6].map((i) => ({ label: WD[i], count: wdc[i] }));

  const visits = acts.filter((a) => a.tipe === 'kunjungan');
  const verif = visits.filter((a) => a.lat != null).length;
  const linked = acts.filter((a) => a.prospectId && !a.sumber);
  const st = (a: SalesActivity) => num(prospById.get(a.prospectId as string)?.status);
  const toPo = linked.filter((a) => [4, 5].includes(st(a))).length;
  const phones = acts.filter((a) => a.tipe === 'telepon' && a.hasil);
  const pr = new Map<string, number>();
  phones.forEach((a) => pr.set(String(a.hasil), (pr.get(String(a.hasil)) || 0) + 1));

  // Realisasi per SE dalam rentang (untuk aktivitas vs hasil).
  const wonBySe = new Map<string, { v: number; n: number }>();
  inp.prospects.forEach((p) => {
    if (classify(p) !== 'Won' || !inR(wonDateOf(p))) return;
    const k = up(p.se);
    const x = wonBySe.get(k) || { v: 0, n: 0 };
    x.v += num(p.value);
    x.n++;
    wonBySe.set(k, x);
  });

  const bySe = new Map<string, SalesActivity[]>();
  acts.forEach((a) => {
    const k = up(a.se);
    bySe.set(k, [...(bySe.get(k) || []), a]);
  });
  // SE yang punya prospek di cakupan tapi belum ada aktivitas → tetap tampil.
  inp.prospects.forEach((p) => {
    const k = up(p.se);
    if (k && !inp.isStaff(k) && (!cf || up(p.cabang) === cf) && !bySe.has(k) && classify(p) === 'Aktif') bySe.set(k, []);
  });
  const cabOfSe = new Map<string, string>();
  inp.prospects.forEach((p) => p.se && p.cabang && !cabOfSe.has(up(p.se)) && cabOfSe.set(up(p.se), up(p.cabang)));
  const tgtPerMonth = Object.values(DEFAULT_ACTIVITY_TARGETS).reduce((s, v) => s + v, 0);
  const lastDay = range.today < `${range.months[range.months.length - 1]}-31` ? range.today : `${range.months[range.months.length - 1]}-28`;

  const seRows: ActSeRow[] = Array.from(bySe.entries()).map(([se, list]) => {
    const counts: Record<string, number> = {};
    CUST_TYPES.forEach((t) => (counts[t] = list.filter((a) => a.tipe === t).length));
    const v = list.filter((a) => a.tipe === 'kunjungan');
    const lk = list.filter((a) => a.prospectId && !a.sumber);
    const lastDate = list.reduce<string | null>((m, a) => (!m || a.tanggal > m ? a.tanggal : m), null);
    const w = wonBySe.get(se) || { v: 0, n: 0 };
    const target = tgtPerMonth * nMonths;
    return {
      se: list[0]?.se || se,
      cabang: up(list[0]?.cabang) || cabOfSe.get(se) || '-',
      counts,
      total: list.length,
      target,
      achieve: pct(list.length, target),
      hariAktif: new Set(list.map((a) => a.tanggal)).size,
      lastDate,
      idle: lastDate ? Math.max(0, days(lastDate, lastDay)) : null,
      verifPct: pct(v.filter((a) => a.lat != null).length, v.length),
      custTouched: new Set(list.map((a) => customerKey(a.customer))).size,
      converted: lk.length,
      toPo: lk.filter((a) => [4, 5].includes(st(a))).length,
      won: w.v,
      wonCount: w.n,
      wonPerVisit: v.length ? w.v / v.length : null,
    };
  });
  seRows.sort((a, b) => b.total - a.total);

  // Customer aktif per cabang (punya prospek aktif / menang 12 bulan) untuk cakupan kunjungan.
  const yearAgo = new Date(Date.parse(range.today) - 365 * DAY).toISOString().slice(0, 10);
  const activeCust = new Map<string, Set<string>>();
  inp.prospects.forEach((p) => {
    const c = up(p.cabang);
    if (!c) return;
    const live = classify(p) === 'Aktif' || (classify(p) === 'Won' && wonDateOf(p) >= yearAgo);
    if (!live) return;
    if (!activeCust.has(c)) activeCust.set(c, new Set());
    activeCust.get(c)!.add(customerKey(p.customer));
  });
  const cabs = Array.from(new Set(seRows.map((r) => r.cabang))).filter((c) => c && c !== '-');
  const cabangRows: ActCabangRow[] = cabs.map((c) => {
    const rows = seRows.filter((r) => r.cabang === c);
    const list = acts.filter((a) => up(a.cabang) === c);
    const v = list.filter((a) => a.tipe === 'kunjungan');
    const touched = new Set(list.map((a) => customerKey(a.customer)));
    const act = activeCust.get(c) || new Set<string>();
    const covered = Array.from(act).filter((k) => touched.has(k)).length;
    const lk = list.filter((a) => a.prospectId && !a.sumber);
    const seCount = rows.length || 1;
    return {
      cabang: c,
      seCount: rows.length,
      total: list.length,
      perSe: Math.round(list.length / seCount),
      kunjungan: v.length,
      kunjPerSe: Math.round((v.length / seCount) * 10) / 10,
      verifPct: pct(v.filter((a) => a.lat != null).length, v.length),
      custTouched: touched.size,
      activeCust: act.size,
      covered,
      coveragePct: pct(covered, act.size),
      converted: lk.length,
      convPct: pct(lk.length, list.length),
      won: rows.reduce((s, r) => s + r.won, 0),
      lowSe: rows.filter((r) => (r.achieve ?? 0) < 60).length,
    };
  });
  cabangRows.sort((a, b) => b.perSe - a.perSe);

  const idleSe = seRows.filter((r) => r.idle == null || r.idle >= 5).sort((a, b) => (b.idle ?? 999) - (a.idle ?? 999));
  const total = acts.length;
  const byType = ACTIVITY_TYPES.map((t) => {
    const count = acts.filter((a) => a.tipe === t.key).length;
    const target = DEFAULT_ACTIVITY_TARGETS[t.key] * nMonths * Math.max(1, seRows.length);
    return { tipe: t.key as string, label: t.short, count, target, pct: pct(count, target) };
  });
  const custTouched = new Set(acts.map((a) => customerKey(a.customer))).size;
  const changePct = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  const insights: string[] = [];
  if (total) insights.push(`${total} aktivitas oleh ${seRows.filter((r) => r.total).length} SE menyentuh ${custTouched} customer${changePct != null ? ` (${changePct >= 0 ? 'naik' : 'turun'} ${Math.abs(changePct)}% dari periode sebelumnya)` : ''}.`);
  const kun = byType.find((t) => t.tipe === 'kunjungan');
  if (kun && total && kun.count / total < 0.25) insights.push(`Kunjungan tatap muka hanya ${Math.round((kun.count / total) * 100)}% dari aktivitas — aktivitas didominasi telepon/WA.`);
  if (visits.length && pct(verif, visits.length)! < 50) insights.push(`${pct(verif, visits.length)}% kunjungan tercatat dengan lokasi; sisanya dicatat tanpa verifikasi.`);
  if (total) insights.push(`${linked.length} aktivitas (${pct(linked.length, total)}%) dibawa ke pipeline; ${toPo} di antaranya sudah menjadi PO/DO.`);
  if (idleSe.length) insights.push(`${idleSe.length} SE tidak menginput aktivitas ≥ 5 hari: ${idleSe.slice(0, 5).map((r) => r.se).join(', ')}.`);
  const low = seRows.filter((r) => (r.achieve ?? 0) < 60);
  if (low.length) insights.push(`${low.length} SE di bawah 60% target aktivitas (acuan target default).`);
  const best = [...seRows].filter((r) => r.wonPerVisit != null && r.won > 0).sort((a, b) => (b.wonPerVisit ?? 0) - (a.wonPerVisit ?? 0))[0];
  if (best) insights.push(`Realisasi per kunjungan tertinggi: ${best.se} (${Math.round((best.wonPerVisit ?? 0) / 1e6).toLocaleString('id-ID')} jt per kunjungan).`);
  const weakCab = [...cabangRows].filter((c) => c.coveragePct != null && c.activeCust >= 5).sort((a, b) => (a.coveragePct ?? 0) - (b.coveragePct ?? 0))[0];
  if (weakCab && (weakCab.coveragePct ?? 0) < 50) insights.push(`Cabang ${weakCab.cabang} baru menyentuh ${weakCab.coveragePct}% customer aktifnya pada periode ini.`);

  return {
    total,
    byType,
    prevTotal,
    changePct,
    weeks,
    weekday,
    custTouched,
    converted: linked.length,
    convPct: pct(linked.length, total),
    toPo,
    verifPct: pct(verif, visits.length),
    phoneResult: Array.from(pr.entries()).map(([k, c]) => ({ label: HASIL_LABEL[k] || k, count: c })).sort((a, b) => b.count - a.count),
    seRows,
    cabangRows,
    idleSe,
    insights,
  };
}

// ================================================================ CABANG

export interface BranchScore {
  cabang: string;
  reg: number | null;
  target: number;
  won: number;
  ach: number | null;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  avgDeal: number;
  pipeline: number;
  weighted: number;
  coverage: number | null;
  openCount: number;
  noFu: number;
  fuLate: number;
  aging: number;
  seCount: number;
  aktivitas: number;
  aktPerSe: number;
  kunjungan: number;
  issuesOpen: number;
  issuesLate: number;
  gitOld: number;
  gitOldValue: number;
  rfqCount: number;
  rfqAnswerDays: number | null;
  custActive: number;
  custNew: number;
  /** Skor 0–100 (indikatif) dan komponennya. */
  score: number;
  parts: { label: string; value: number; weight: number }[];
  rank: number;
  flags: string[];
}

export function buildBranchScorecard(inp: {
  prospects: Prospect[];
  /** Target & realisasi per cabang dari exec-analysis (definisi sama dengan tab Sales). */
  forecast: { cabang: string; reg: number | null; target: number; won: number }[];
  activities: SalesActivity[] | null;
  issues: PipelineIssue[];
  rfqs: Rfq[];
  range: Range;
  isStaff: (se: string) => boolean;
  cabangs: string[];
}): BranchScore[] {
  const { range } = inp;
  const inR = inRange(range);
  const today = range.today;
  const nMonths = range.months.length || 1;
  const tgtAct = Object.values(DEFAULT_ACTIVITY_TARGETS).reduce((s, v) => s + v, 0) * nMonths;
  const fc = new Map(inp.forecast.map((r) => [up(r.cabang), r]));
  const firstWon = new Map<string, string>();
  inp.prospects.forEach((p) => {
    if (classify(p) !== 'Won') return;
    const k = customerKey(p.customer);
    const d = wonDateOf(p);
    if (d && (!firstWon.has(k) || d < firstWon.get(k)!)) firstWon.set(k, d);
  });
  const yearAgo = new Date(Date.parse(today) - 365 * DAY).toISOString().slice(0, 10);
  const cabs = Array.from(new Set([...inp.cabangs.map(up), ...inp.forecast.map((r) => up(r.cabang))])).filter(Boolean);

  const rows = cabs.map((c) => {
    const ps = inp.prospects.filter((p) => up(p.cabang) === c);
    const f = fc.get(c);
    const won = ps.filter((p) => classify(p) === 'Won' && inR(wonDateOf(p)));
    const lost = ps.filter((p) => classify(p) === 'Lost' && inR(lostDateOf(p)));
    const open = ps.filter((p) => classify(p) === 'Aktif');
    const pipeline = open.reduce((s, p) => s + num(p.value), 0);
    const weighted = open.reduce((s, p) => s + num(p.value) * (STAGE_PROBABILITY[num(p.status)] ?? 0), 0);
    const target = f?.target ?? 0;
    const wonV = f?.won ?? won.reduce((s, p) => s + num(p.value), 0);
    const gap = Math.max(0, target - wonV);
    const acts = (inp.activities || []).filter((a) => up(a.cabang) === c && a.status !== 'rencana' && CUST_TYPES.includes(a.tipe) && !inp.isStaff(a.se) && inR(a.tanggal));
    const ses = new Set([...acts.map((a) => up(a.se)), ...open.map((p) => up(p.se))].filter((s) => s && !inp.isStaff(s)));
    const git = ps.filter((p) => num(p.status) === 5 && !p.terfaktur).map((p) => ({ v: num(p.value), d: days(p.tglDelivery || p.tglPO || String(p.statusChangedAt).slice(0, 10), today) })).filter((x) => x.d > 30);
    const iss = inp.issues.filter((i) => up(i.cabang) === c && isOpenIssue(i));
    const rf = inp.rfqs.filter((r) => up(r.cabang) === c && r.sentToPurchasingAt && inR(r.sentToPurchasingAt));
    const resp = rf.filter((r) => r.jawabanRfqAt).map((r) => (Date.parse(String(r.jawabanRfqAt)) - Date.parse(String(r.sentToPurchasingAt))) / DAY);
    const custActive = new Set(ps.filter((p) => classify(p) === 'Aktif' || (classify(p) === 'Won' && wonDateOf(p) >= yearAgo)).map((p) => customerKey(p.customer))).size;
    const custNew = new Set(won.filter((p) => inR(firstWon.get(customerKey(p.customer)))).map((p) => customerKey(p.customer))).size;
    const seCount = ses.size;
    const aktPerSe = seCount ? Math.round(acts.length / seCount) : 0;
    const noFu = open.filter((p) => !p.followUpAt).length;
    const fuLate = open.filter((p) => p.followUpAt && p.followUpAt < today).length;
    const aging = open.filter((p) => days(String(p.statusChangedAt || p.updatedAt), today) > 30).length;
    const winRate = pct(won.length, won.length + lost.length);
    const ach = target ? Math.round((wonV / target) * 100) : null;
    const coverage = gap > 0 ? Math.round((weighted / gap) * 100) / 100 : null;

    // Skor indikatif — komponen tanpa data tidak dihitung.
    const parts: { label: string; value: number | null; weight: number }[] = [
      { label: 'Pencapaian target', value: ach == null ? null : Math.min(100, ach), weight: 30 },
      { label: 'Win rate', value: winRate, weight: 15 },
      { label: 'Aktivitas per SE', value: inp.activities ? Math.min(100, Math.round((aktPerSe / tgtAct) * 100)) : null, weight: 20 },
      { label: 'Disiplin follow-up', value: open.length ? 100 - Math.round(((noFu + fuLate) / open.length) * 100) : null, weight: 15 },
      { label: 'Pipeline bergerak', value: open.length ? 100 - Math.round((aging / open.length) * 100) : null, weight: 10 },
      { label: 'Cakupan pipeline', value: coverage == null ? (target && wonV >= target ? 100 : null) : Math.min(100, Math.round((coverage / 1.5) * 100)), weight: 10 },
    ];
    const used = parts.filter((p) => p.value != null) as { label: string; value: number; weight: number }[];
    const w = used.reduce((s, p) => s + p.weight, 0);
    const score = w ? Math.round(used.reduce((s, p) => s + p.value * p.weight, 0) / w) : 0;

    const flags: string[] = [];
    if (ach != null && ach < 70) flags.push(`target ${ach}%`);
    if (winRate != null && winRate < 30 && won.length + lost.length >= 4) flags.push(`win rate ${winRate}%`);
    if (open.length && (noFu + fuLate) / open.length > 0.4) flags.push(`${noFu + fuLate} prospek tanpa FU / FU terlambat`);
    if (aging >= 5) flags.push(`${aging} deal diam > 30 hari`);
    if (git.length) flags.push(`${git.length} DO belum faktur > 30 hari`);
    if (iss.length) flags.push(`${iss.length} masalah terbuka`);
    if (inp.activities && seCount && aktPerSe < tgtAct * 0.5) flags.push(`aktivitas ${Math.round((aktPerSe / tgtAct) * 100)}% dari target per SE`);

    return {
      cabang: c,
      reg: f?.reg ?? ps.find((p) => p.reg != null)?.reg ?? null,
      target,
      won: wonV,
      ach,
      wonCount: won.length,
      lostCount: lost.length,
      winRate,
      avgDeal: won.length ? won.reduce((s, p) => s + num(p.value), 0) / won.length : 0,
      pipeline,
      weighted,
      coverage,
      openCount: open.length,
      noFu,
      fuLate,
      aging,
      seCount,
      aktivitas: acts.length,
      aktPerSe,
      kunjungan: acts.filter((a) => a.tipe === 'kunjungan').length,
      issuesOpen: iss.length,
      issuesLate: iss.filter((i) => days(i.dilaporAt || i.createdAt, today) > 7).length,
      gitOld: git.length,
      gitOldValue: git.reduce((s, x) => s + x.v, 0),
      rfqCount: rf.length,
      rfqAnswerDays: median(resp),
      custActive,
      custNew,
      score,
      parts: used,
      rank: 0,
      flags,
    } satisfies BranchScore;
  });
  const active = rows.filter((r) => r.target > 0 || r.won > 0 || r.openCount > 0 || r.aktivitas > 0);
  active.sort((a, b) => b.score - a.score).forEach((r, i) => (r.rank = i + 1));
  return active;
}

// ================================================================ CUSTOMER

export interface CustomerAnalysis {
  segments: { key: string; label: string; hint: string; count: number; value12: number; tone: string }[];
  totalWonCust: number;
  buyers: number;
  wonInRange: number;
  top10Share: number | null;
  pareto80: number;
  topCustomers: { name: string; cabang: string; value: number; prev: number; change: number | null; tier: string }[];
  gainers: { name: string; cabang: string; value: number; prev: number }[];
  decliners: { name: string; cabang: string; value: number; prev: number }[];
  newCustomers: { name: string; cabang: string; value: number; date: string }[];
  lapsed: { name: string; cabang: string; last: string; days: number; value12: number; hist: number }[];
  byCabang: { cabang: string; aktif: number; risiko: number; dingin: number; hilang: number; baru: number }[];
  kam: { tier: string; groups: number; share: number | null }[];
  insights: string[];
}

export function buildCustomerAnalysis(inp: { prospects: Prospect[]; groups: CustomerGroup[]; range: Range; cabangFilter?: string }): CustomerAnalysis {
  const { range } = inp;
  const today = range.today;
  const inR = inRange(range);
  const prevR = inRange({ months: prevMonths(range.months), today });
  const cf = up(inp.cabangFilter);
  const ps = inp.prospects.filter((p) => !cf || up(p.cabang) === cf);
  const yearAgo = new Date(Date.parse(today) - 365 * DAY).toISOString().slice(0, 10);

  interface C { name: string; cabang: string; last: string; first: string; hist: number; v12: number; vr: number; vp: number; open: number; any: boolean }
  const m = new Map<string, C>();
  ps.forEach((p) => {
    const k = customerKey(p.customer);
    if (!k) return;
    const c = m.get(k) || { name: p.customer, cabang: up(p.cabang) || '-', last: '', first: '', hist: 0, v12: 0, vr: 0, vp: 0, open: 0, any: false };
    c.any = true;
    if (classify(p) === 'Aktif') c.open += num(p.value);
    if (classify(p) === 'Won') {
      const d = wonDateOf(p);
      const v = num(p.value);
      c.hist += v;
      if (d > c.last) c.last = d;
      if (d && (!c.first || d < c.first)) c.first = d;
      if (d >= yearAgo) c.v12 += v;
      if (inR(d)) c.vr += v;
      if (prevR(d)) c.vp += v;
    }
    m.set(k, c);
  });
  const all = Array.from(m.values());
  const age = (c: C) => (c.last ? days(c.last, today) : null);
  const seg = (c: C) => {
    const a = age(c);
    if (a == null) return c.open > 0 ? 'prospek' : 'pasif';
    if (a <= 90) return 'aktif';
    if (a <= 180) return 'risiko';
    if (a <= 365) return 'dingin';
    return 'hilang';
  };
  const SEG = [
    { key: 'aktif', label: 'Aktif', hint: 'order ≤ 90 hari', tone: 'green' },
    { key: 'risiko', label: 'Berisiko', hint: 'order terakhir 91–180 hari', tone: 'amber' },
    { key: 'dingin', label: 'Dingin', hint: '181–365 hari tanpa order', tone: 'rust' },
    { key: 'hilang', label: 'Hilang', hint: '> 1 tahun tanpa order', tone: 'slate' },
    { key: 'prospek', label: 'Prospek baru', hint: 'belum pernah order, ada penawaran aktif', tone: 'steel' },
  ];
  const segments = SEG.map((s) => {
    const list = all.filter((c) => seg(c) === s.key);
    return { ...s, count: list.length, value12: list.reduce((x, c) => x + (s.key === 'prospek' ? c.open : c.v12 || c.hist), 0) };
  });

  const inRangeCust = all.filter((c) => c.vr > 0).sort((a, b) => b.vr - a.vr);
  const wonInRange = inRangeCust.reduce((s, c) => s + c.vr, 0);
  const top10Share = wonInRange ? Math.round((inRangeCust.slice(0, 10).reduce((s, c) => s + c.vr, 0) / wonInRange) * 100) : null;
  let acc = 0;
  let pareto80 = 0;
  for (const c of inRangeCust) {
    acc += c.vr;
    pareto80++;
    if (acc >= wonInRange * 0.8) break;
  }
  const tierOf = new Map<string, string>();
  inp.groups.forEach((g) => [g.name, ...((Array.isArray(g.entities) ? g.entities : []) as string[])].forEach((n) => tierOf.set(customerKey(n), String(g.tier || ''))));
  const topCustomers = inRangeCust.slice(0, 15).map((c) => ({ name: c.name, cabang: c.cabang, value: c.vr, prev: c.vp, change: c.vp > 0 ? Math.round(((c.vr - c.vp) / c.vp) * 100) : null, tier: tierOf.get(customerKey(c.name)) || '' }));
  const delta = all.filter((c) => c.vr > 0 || c.vp > 0).map((c) => ({ name: c.name, cabang: c.cabang, value: c.vr, prev: c.vp, d: c.vr - c.vp }));
  const gainers = delta.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 8);
  const decliners = delta.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 8);
  const newCustomers = all.filter((c) => c.first && inR(c.first)).sort((a, b) => b.vr - a.vr).slice(0, 15).map((c) => ({ name: c.name, cabang: c.cabang, value: c.vr, date: c.first }));
  const lapsed = all
    .filter((c) => ['risiko', 'dingin'].includes(seg(c)))
    .sort((a, b) => b.hist - a.hist)
    .slice(0, 15)
    .map((c) => ({ name: c.name, cabang: c.cabang, last: c.last, days: age(c) ?? 0, value12: c.v12, hist: c.hist }));
  const cabs = Array.from(new Set(all.map((c) => c.cabang))).filter((c) => c && c !== '-').sort();
  const byCabang = cabs.map((cb) => {
    const l = all.filter((c) => c.cabang === cb);
    return { cabang: cb, aktif: l.filter((c) => seg(c) === 'aktif').length, risiko: l.filter((c) => seg(c) === 'risiko').length, dingin: l.filter((c) => seg(c) === 'dingin').length, hilang: l.filter((c) => seg(c) === 'hilang').length, baru: l.filter((c) => c.first && inR(c.first)).length };
  });
  const total12 = all.reduce((s, c) => s + c.v12, 0);
  const kam = ['strategic', 'key', 'development', 'monitor']
    .map((t) => {
      const gs = inp.groups.filter((g) => String(g.tier || '').toLowerCase() === t);
      const v = all.filter((c) => (tierOf.get(customerKey(c.name)) || '').toLowerCase() === t).reduce((s, c) => s + c.v12, 0);
      return { tier: t, groups: gs.length, share: total12 ? Math.round((v / total12) * 100) : null };
    })
    .filter((k) => k.groups > 0);

  const insights: string[] = [];
  const sg = (k: string) => segments.find((s) => s.key === k)!;
  insights.push(`${sg('aktif').count} customer aktif, ${sg('risiko').count} berisiko, ${sg('dingin').count} dingin, ${sg('hilang').count} hilang (> 1 tahun).`);
  if (top10Share != null) insights.push(`10 customer terbesar = ${top10Share}% realisasi periode; ${pareto80} customer membentuk 80% realisasi.`);
  if (newCustomers.length) insights.push(`${newCustomers.length} customer baru melakukan order pertama pada periode ini.`);
  if (decliners.length) insights.push(`Penurunan terbesar vs periode sebelumnya: ${decliners.slice(0, 3).map((x) => x.name).join(', ')}.`);
  if (sg('risiko').count) insights.push(`${sg('risiko').count} customer berisiko (order terakhir 3–6 bulan lalu) — prioritas kunjungan sebelum menjadi dingin.`);
  return { segments, totalWonCust: all.filter((c) => c.hist > 0).length, buyers: inRangeCust.length, wonInRange, top10Share, pareto80: inRangeCust.length ? pareto80 : 0, topCustomers, gainers, decliners, newCustomers, lapsed, byCabang, kam, insights };
}

// ================================================================ OPERASIONAL

export interface OpsAnalysis {
  rfqCount: number;
  fupaCount: number;
  answeredPct: number | null;
  medianDays: number | null;
  within2Pct: number | null;
  noQuotePct: number | null;
  pending: { no: string; cabang: string; customer: string; days: number }[];
  rfqWin: number | null;
  noRfqWin: number | null;
  issueCats: { label: string; open: number; done: number; value: number }[];
  issueOpen: number;
  issueLate: number;
  issueAvgClose: number | null;
  fuNone: number;
  fuLate: number;
  openDeals: number;
  stageAge: { stage: number; count: number; avg: number | null }[];
  git: { label: string; count: number; value: number }[];
  insights: string[];
}

export function buildOpsAnalysis(inp: { prospects: Prospect[]; rfqs: Rfq[]; fupas: Fupa[]; issues: PipelineIssue[]; range: Range; cabangFilter?: string }): OpsAnalysis {
  const { range } = inp;
  const today = range.today;
  const inR = inRange(range);
  const cf = up(inp.cabangFilter);
  const okC = (c: string | null | undefined) => !cf || up(c) === cf;
  const rf = inp.rfqs.filter((r) => okC(r.cabang) && r.sentToPurchasingAt && !r.cancelledAt && inR(String(r.sentToPurchasingAt)));
  const fu = inp.fupas.filter((f) => okC(f.cabang) && f.sentToPurchasingAt && inR(String(f.sentToPurchasingAt)));
  const answered = rf.filter((r) => r.jawabanRfqAt);
  const resp = answered.map((r) => Math.max(0, (Date.parse(String(r.jawabanRfqAt)) - Date.parse(String(r.sentToPurchasingAt))) / DAY));
  const items = rf.flatMap((r) => r.items || []);
  const pending = inp.rfqs
    .filter((r) => okC(r.cabang) && r.sentToPurchasingAt && !r.cancelledAt && [1, 2].includes(workflowStage(rfqAsWorkflowDoc(r))))
    .map((r) => ({ no: r.noRfq || 'RFQ', cabang: r.cabang || '-', customer: r.customer || '-', days: days(String(r.sentToPurchasingAt), today) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 10);

  // Win rate deal dengan / tanpa RFQ terjawab (keputusan dalam rentang).
  const answeredByProspect = new Set(inp.rfqs.filter((r) => r.prospectId && r.jawabanRfqAt).map((r) => r.prospectId as string));
  const ps = inp.prospects.filter((p) => okC(p.cabang));
  const decided = ps.filter((p) => (classify(p) === 'Won' && inR(wonDateOf(p))) || (classify(p) === 'Lost' && inR(lostDateOf(p))));
  const wr = (list: Prospect[]) => pct(list.filter((p) => classify(p) === 'Won').length, list.length);
  const withRfq = decided.filter((p) => answeredByProspect.has(p.id));
  const noRfq = decided.filter((p) => !answeredByProspect.has(p.id));

  const iss = inp.issues.filter((i) => okC(i.cabang) && i.status !== 'diabaikan');
  const catMap = new Map<string, { open: number; done: number; value: number }>();
  const pv = new Map(inp.prospects.map((p) => [p.id, num(p.value)]));
  iss.forEach((i) => {
    const k = issueCatLabel(i.kategori);
    const x = catMap.get(k) || { open: 0, done: 0, value: 0 };
    if (isOpenIssue(i)) {
      x.open++;
      x.value += pv.get(i.prospectId) || 0;
    } else if (i.status === 'selesai' && inR(i.selesaiAt)) x.done++;
    catMap.set(k, x);
  });
  const closedDays = iss.filter((i) => i.status === 'selesai' && i.selesaiAt && inR(i.selesaiAt)).map((i) => days(i.dilaporAt || i.createdAt, String(i.selesaiAt)));
  const open = ps.filter((p) => classify(p) === 'Aktif');
  const stageAge = [1, 2, 3].map((s) => {
    const l = open.filter((p) => num(p.status) === s).map((p) => days(String(p.statusChangedAt || p.updatedAt), today));
    return { stage: s, count: l.length, avg: l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null };
  });
  const gitList = ps.filter((p) => num(p.status) === 5 && !p.terfaktur).map((p) => ({ v: num(p.value), d: days(p.tglDelivery || p.tglPO || String(p.statusChangedAt).slice(0, 10), today) }));
  const B = [
    { label: '≤ 14 hari', f: (d: number) => d <= 14 },
    { label: '15–30 hari', f: (d: number) => d > 14 && d <= 30 },
    { label: '31–60 hari', f: (d: number) => d > 30 && d <= 60 },
    { label: '> 60 hari', f: (d: number) => d > 60 },
  ];
  const git = B.map((b) => {
    const l = gitList.filter((x) => b.f(x.d));
    return { label: b.label, count: l.length, value: l.reduce((s, x) => s + x.v, 0) };
  });
  const issueOpen = iss.filter(isOpenIssue).length;
  const issueLate = iss.filter((i) => isOpenIssue(i) && days(i.dilaporAt || i.createdAt, today) > 7).length;
  const fuNone = open.filter((p) => !p.followUpAt).length;
  const fuLate = open.filter((p) => p.followUpAt && p.followUpAt < today).length;

  const out: OpsAnalysis = {
    rfqCount: rf.length,
    fupaCount: fu.length,
    answeredPct: pct(answered.length, rf.length),
    medianDays: median(resp),
    within2Pct: pct(resp.filter((d) => d <= 2).length, resp.length),
    noQuotePct: pct(items.filter((it) => it.noQuote).length, items.length),
    pending,
    rfqWin: wr(withRfq),
    noRfqWin: wr(noRfq),
    issueCats: Array.from(catMap.entries()).map(([label, x]) => ({ label, ...x })).sort((a, b) => b.open - a.open || b.value - a.value),
    issueOpen,
    issueLate,
    issueAvgClose: closedDays.length ? Math.round(closedDays.reduce((a, b) => a + b, 0) / closedDays.length) : null,
    fuNone,
    fuLate,
    openDeals: open.length,
    stageAge,
    git,
    insights: [],
  };
  const ins = out.insights;
  if (rf.length) ins.push(`${rf.length} RFQ dikirim ke Purchasing; ${out.answeredPct}% sudah dijawab, median ${out.medianDays == null ? '-' : (Math.round(out.medianDays * 10) / 10).toLocaleString('id-ID')} hari.`);
  if (out.rfqWin != null && out.noRfqWin != null) ins.push(`Win rate deal dengan RFQ terjawab ${out.rfqWin}% vs tanpa RFQ ${out.noRfqWin}%.`);
  if (pending.length && pending[0].days > 3) ins.push(`${pending.filter((x) => x.days > 3).length} RFQ menunggu jawaban lebih dari 3 hari (terlama ${pending[0].days} hari).`);
  if (open.length) ins.push(`${fuNone + fuLate} dari ${open.length} prospek aktif tanpa jadwal follow-up atau follow-up terlambat.`);
  if (issueOpen) ins.push(`${issueOpen} masalah pipeline terbuka, ${issueLate} lebih dari 7 hari.`);
  const g60 = git[3];
  if (g60.count) ins.push(`${g60.count} DO belum difaktur lebih dari 60 hari.`);
  return out;
}
