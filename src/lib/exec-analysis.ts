import { CABANG_LIST, STAGE_PROBABILITY } from './constants';
import { classify, num } from './format';
import { buildAgingList, buildCustomerIntel, buildForecast, buildForecastBySe, buildForecastByReg, buildForecastNasional, customerKey, daysSince, periodeList } from './reports';
import type { BudgetTarget, Prospect, SafeUser, SalesPlan } from './types';

/**
 * Analisa Eksekutif, open to every sales-side role and scoped to what that
 * role is responsible for:
 *   GM / admin -> Nasional (all branches)
 *   RM         -> its Regional (branches of its region)
 *   BM         -> its Cabang
 *   Sales      -> its own SE figures, against its branch target as reference
 * Prospects/sales plans in the store are already server-scoped per role; this
 * only narrows the branch list so company-wide targets don't leak into, or
 * inflate, a narrower view.
 */
export type ExecScopeKind = 'nasional' | 'regional' | 'cabang' | 'se';

export interface ExecScope {
  kind: ExecScopeKind;
  label: string;
  cabangs: string[];
}

export function execScopeFor(user: SafeUser, prospects: Prospect[]): ExecScope | null {
  if (user.role === 'gm' || user.role === 'admin') return { kind: 'nasional', label: 'Nasional', cabangs: CABANG_LIST };
  if (user.role === 'rm') {
    const reg = user.reg ?? -1;
    const set = new Set<string>();
    prospects.forEach((p) => p.cabang && p.reg === reg && set.add(p.cabang.trim().toUpperCase()));
    const ordered = [...CABANG_LIST.filter((c) => set.has(c)), ...Array.from(set).filter((c) => !CABANG_LIST.includes(c))];
    return { kind: 'regional', label: `Regional ${user.reg ?? '-'}`, cabangs: ordered };
  }
  if (user.role === 'bm') {
    const c = (user.cabang || '').trim().toUpperCase();
    return c ? { kind: 'cabang', label: `Cabang ${c}`, cabangs: [c] } : null;
  }
  if (user.role === 'sales') {
    const c = (user.cabang || '').trim().toUpperCase();
    return { kind: 'se', label: `SE ${(user.se || '-').toUpperCase()}${c ? ` · ${c}` : ''}`, cabangs: c ? [c] : [] };
  }
  return null; // purchasing: no sales data in scope
}

/** Local (not UTC) YYYY-MM -- at 06:00 WIB on the 1st, UTC is still last month. */
export function localPeriode(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function prevPeriode(periode: string): string {
  const [y, m] = periode.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return localPeriode(d);
}

/** Same month one year earlier. */
const yearBefore = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
/** "Oktober 2026" or "Januari – Agustus 2026" / "November 2025 – Februari 2026". */
export function periodeLabel(from: string, to: string = from): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const name = (p: string) => BULAN[Number(p.slice(5, 7)) - 1] || p;
  if (a === b) return `${name(a)} ${a.slice(0, 4)}`;
  return a.slice(0, 4) === b.slice(0, 4) ? `${name(a)} – ${name(b)} ${b.slice(0, 4)}` : `${name(a)} ${a.slice(0, 4)} – ${name(b)} ${b.slice(0, 4)}`;
}

/** The date a deal was won -- PO, then delivery, then offer (same rule as reports.ts). */
function wonDate(r: Prospect): string {
  return r.tglPO || r.tglDelivery || r.tglPenawaran || '';
}

const inScope = (scope: ExecScope) => {
  const set = new Set(scope.cabangs.map((c) => c.toUpperCase()));
  // A record with no cabang is kept in the SE view (it's the user's own deal);
  // in branch-based views it can't be attributed and is reported under data quality instead.
  return (r: Prospect) => (scope.kind === 'se' ? true : set.has((r.cabang || '').trim().toUpperCase()));
};

export interface DataIssue {
  key: string;
  label: string;
  hint: string;
  count: number;
  examples: string[];
}

export interface ExecAnalysis {
  scope: ExecScope;
  /** First month of the period ("YYYY-MM"). */
  periode: string;
  /** Last month of the period; equals `periode` for a single month. */
  periodeTo: string;
  /** Number of months in the period. */
  monthCount: number;
  /** "Oktober 2026" / "Januari – Agustus 2026". */
  periodLabel: string;
  /** What prevWon/momPct compare against: last month (single month) or the same months a year earlier (range). */
  compareLabel: string;
  // money
  target: number;
  rencana: number;
  won: number;
  wonPo: number;
  wonDoGit: number;
  wonDoOmzet: number;
  wonCount: number;
  achievement: number;
  rencanaVsTarget: number;
  wonVsRencana: number;
  prevWon: number;
  momPct: number | null;
  gap: number;
  /** Working days left in the period (Mon-Sat), null for a past/future period. */
  daysLeft: number | null;
  requiredPerDay: number | null;
  weighted: number;
  /** weighted pipeline / remaining gap; >= 1 means the pipeline can cover the gap on paper. */
  coverage: number | null;
  avgDeal: number;
  // conversion
  lostCount: number;
  lostValue: number;
  winRate: number | null;
  topCompetitors: { name: string; count: number }[];
  funnel: { stage: number; count: number; value: number }[];
  // tables
  rows: ReturnType<typeof buildForecast>;
  regRows: ReturnType<typeof buildForecastByReg>;
  seRows: ReturnType<typeof buildForecastBySe>;
  topCustomers: { name: string; cabang: string; value: number; count: number }[];
  aging: ReturnType<typeof buildAgingList>;
  agingValue: number;
  gitOld: { customer: string; cabang: string; value: number; days: number }[];
  health: Record<string, number>;
  topDingin: ReturnType<typeof buildCustomerIntel>;
  dataIssues: DataIssue[];
  insights: string[];
}

function workingDaysLeft(periode: string, today = new Date()): number | null {
  // Only meaningful while the period's last month is still running.
  if (periode !== localPeriode(today)) return null;
  const [y, m] = periode.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = today.getDate(); d <= last; d++) if (new Date(y, m - 1, d).getDay() !== 0) n++;
  return n;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function buildExecAnalysis(
  allProspects: Prospect[],
  budgetTargets: BudgetTarget[],
  salesPlans: SalesPlan[],
  scope: ExecScope,
  periodeFrom: string,
  formatRp: (n: number) => string,
  today = new Date(),
  /** Last month of a range; omitted = single month. */
  periodeToArg?: string,
): ExecAnalysis {
  const months = periodeList(periodeFrom, periodeToArg || periodeFrom);
  const periode = months[0] || periodeFrom;
  const periodeTo = months[months.length - 1] || periode;
  const monthSet = new Set(months);
  const inMonths = (d: string) => monthSet.has(d.slice(0, 7));
  const prospects = allProspects.filter(inScope(scope));
  const plans = salesPlans.filter((p) => scope.kind === 'se' || scope.cabangs.includes((p.cabang || '').toUpperCase()));
  const rows = buildForecast(prospects, budgetTargets, periode, scope.cabangs, plans, periodeTo).filter((r) => scope.cabangs.includes(r.cabang) || r.won > 0 || r.openCount > 0);
  const regRows = buildForecastByReg(rows);
  const nas = buildForecastNasional(rows);

  const wonInPeriod = prospects.filter((r) => classify(r) === 'Won' && inMonths(wonDate(r)));
  const sum = (list: Prospect[]) => list.reduce((s, r) => s + num(r.value), 0);
  const wonPo = sum(wonInPeriod.filter((r) => num(r.status) === 4));
  const wonDoGit = sum(wonInPeriod.filter((r) => num(r.status) === 5 && !r.terfaktur));
  const wonDoOmzet = sum(wonInPeriod.filter((r) => num(r.status) === 5 && r.terfaktur));
  const won = nas.won;

  // One month: compare with last month. A range: with the same months a year
  // earlier (Jan-Aug 2026 vs Jan-Aug 2025), the comparison management uses.
  const prevMonths = new Set(months.length === 1 ? [prevPeriode(periode)] : months.map(yearBefore));
  const compareLabel = months.length === 1 ? 'bulan lalu' : 'periode sama tahun lalu';
  const prevWon = sum(prospects.filter((r) => classify(r) === 'Won' && prevMonths.has(wonDate(r).slice(0, 7))));
  const momPct = prevWon > 0 ? Math.round(((won - prevWon) / prevWon) * 100) : null;

  const gap = Math.max(0, nas.target - won);
  const daysLeft = workingDaysLeft(periodeTo, today);
  const requiredPerDay = daysLeft && gap > 0 ? gap / daysLeft : null;
  const open = prospects.filter((r) => classify(r) === 'Aktif');
  const weighted = open.reduce((s, r) => s + num(r.value) * (STAGE_PROBABILITY[num(r.status)] ?? 0), 0);
  const coverage = gap > 0 ? Math.round((weighted / gap) * 100) / 100 : null;

  // Lost in period: dated by when the deal moved to Lose (statusChangedAt).
  const lostInPeriod = prospects.filter((r) => classify(r) === 'Lost' && inMonths(String(r.statusChangedAt || '')));
  const decided = wonInPeriod.length + lostInPeriod.length;
  const compCount = new Map<string, { name: string; count: number }>();
  lostInPeriod.forEach((r) => {
    const n = (r.qcdKompetitor || '').trim();
    if (!n) return;
    const k = customerKey(n);
    const e = compCount.get(k) || { name: n, count: 0 };
    e.count++;
    compCount.set(k, e);
  });

  const funnel = [1, 2, 3, 4].map((stage) => {
    const list = open.filter((r) => num(r.status) === stage);
    return { stage, count: list.length, value: sum(list) };
  });

  const custMap = new Map<string, { name: string; cabang: string; value: number; count: number }>();
  wonInPeriod.forEach((r) => {
    const k = customerKey(r.customer);
    const e = custMap.get(k) || { name: r.customer, cabang: r.cabang || '-', value: 0, count: 0 };
    e.value += num(r.value);
    e.count++;
    custMap.set(k, e);
  });
  const topCustomers = Array.from(custMap.values()).sort((a, b) => b.value - a.value).slice(0, 10);

  const aging = buildAgingList(prospects);
  const agingValue = aging.reduce((s, a) => s + num(a.record.value), 0);

  // GIT (DO not yet invoiced) older than 30 days: revenue delivered but not billed.
  const gitOld = prospects
    .filter((r) => num(r.status) === 5 && !r.terfaktur)
    .map((r) => ({ customer: r.customer, cabang: r.cabang || '-', value: num(r.value), days: daysSince((r.tglDelivery || r.tglPO || String(r.statusChangedAt).slice(0, 10)) as string) }))
    .filter((x) => Number.isFinite(x.days) && x.days > 30)
    .sort((a, b) => b.value - a.value);

  const intel = buildCustomerIntel(prospects);
  const health: Record<string, number> = { Aktif: 0, Menghangat: 0, 'Dingin (Follow-up)': 0, 'Belum Pernah Order': 0 };
  intel.forEach((c) => (health[c.health] = (health[c.health] || 0) + 1));
  const topDingin = intel.filter((c) => c.health.startsWith('Dingin')).sort((a, b) => b.wonValue - a.wonValue).slice(0, 10);

  const dataIssues = buildDataIssues(allProspects.filter((r) => scope.kind === 'se' || inScope(scope)(r) || !(r.cabang || '').trim()), formatRp);

  const a: ExecAnalysis = {
    scope,
    periode,
    periodeTo,
    monthCount: months.length,
    periodLabel: periodeLabel(periode, periodeTo),
    compareLabel,
    target: nas.target,
    rencana: nas.rencana,
    won,
    wonPo,
    wonDoGit,
    wonDoOmzet,
    wonCount: wonInPeriod.length,
    achievement: nas.achievement,
    rencanaVsTarget: nas.rencanaVsTarget,
    wonVsRencana: nas.wonVsRencana,
    prevWon,
    momPct,
    gap,
    daysLeft,
    requiredPerDay,
    weighted,
    coverage,
    avgDeal: wonInPeriod.length ? won / wonInPeriod.length : 0,
    lostCount: lostInPeriod.length,
    lostValue: sum(lostInPeriod),
    winRate: decided ? pct(wonInPeriod.length, decided) : null,
    topCompetitors: Array.from(compCount.values()).sort((x, y) => y.count - x.count).slice(0, 5),
    funnel,
    rows,
    regRows,
    seRows: buildForecastBySe(prospects, periode, periodeTo),
    topCustomers,
    aging,
    agingValue,
    gitOld,
    health,
    topDingin,
    dataIssues,
    insights: [],
  };
  a.insights = buildInsights(a, formatRp);
  return a;
}

/**
 * Records that make the numbers above wrong or unattributable, so they can be
 * fixed at the source rather than silently skewing the analysis.
 */
export function buildDataIssues(prospects: Prospect[], formatRp: (n: number) => string): DataIssue[] {
  const issues: DataIssue[] = [];
  const add = (key: string, label: string, hint: string, list: Prospect[], fmt: (r: Prospect) => string = (r) => `${r.customer} (${r.cabang || '-'})`) => {
    if (list.length) issues.push({ key, label, hint, count: list.length, examples: list.slice(0, 5).map(fmt) });
  };
  add('noCabang', 'Prospek tanpa cabang', 'Tidak masuk perhitungan cabang/regional mana pun.', prospects.filter((r) => !(r.cabang || '').trim()));
  add('noSe', 'Prospek tanpa Kode SE', 'Tidak terhitung di peringkat SE.', prospects.filter((r) => !(r.se || '').trim() && num(r.status) !== 0));
  add('openNoValue', 'Pipeline aktif bernilai Rp 0', 'Weighted pipeline & coverage jadi terlalu kecil.', prospects.filter((r) => classify(r) === 'Aktif' && num(r.value) <= 0));
  add('wonNoValue', 'Won bernilai Rp 0', 'Realisasi tercatat lebih kecil dari kenyataan.', prospects.filter((r) => classify(r) === 'Won' && num(r.value) <= 0));
  add('wonNoDate', 'Won tanpa Tgl PO / Tgl Delivery', 'Masuk periode berdasar tanggal penawaran, bisa salah bulan.', prospects.filter((r) => classify(r) === 'Won' && !r.tglPO && !r.tglDelivery));
  add('wonNoPo', 'PO/DO tanpa No. PO', 'Tidak bisa dicocokkan dengan dokumen customer.', prospects.filter((r) => classify(r) === 'Won' && !(r.noPo || '').trim()));
  add('lostNoReason', 'Lose tanpa catatan QCD/kompetitor', 'Alasan kalah tidak bisa dianalisa.', prospects.filter((r) => classify(r) === 'Lost' && !(r.qcdKompetitor || r.qcdCatatan || r.qcdCost || r.qcdQuality || r.qcdDelivery || '').trim()));

  // Same company typed differently ("PT. X" / "pt x") -- grouped by the normalized key.
  const variants = new Map<string, Set<string>>();
  prospects.forEach((r) => {
    const raw = (r.customer || '').trim();
    if (!raw) return;
    const k = customerKey(raw);
    if (!variants.has(k)) variants.set(k, new Set());
    variants.get(k)!.add(raw);
  });
  const dup = Array.from(variants.values()).filter((s) => s.size > 1);
  if (dup.length) {
    issues.push({ key: 'dupCustomer', label: 'Nama customer ditulis berbeda-beda', hint: 'Sudah digabung di analisa ini; seragamkan penulisannya di data.', count: dup.length, examples: dup.slice(0, 5).map((s) => Array.from(s).join(' / ')) });
  }
  void formatRp;
  return issues;
}

function buildInsights(a: ExecAnalysis, rp: (n: number) => string): string[] {
  const out: string[] = [];
  const who = a.scope.kind === 'se' ? 'Anda' : a.scope.label;
  if (a.target > 0) {
    out.push(
      `${a.scope.kind === 'se' ? 'Kontribusi Anda' : `Realisasi ${who}`} ${a.achievement}% dari target${a.scope.kind === 'se' ? ' cabang' : ''} (${rp(a.won)} dari ${rp(a.target)}).` +
        (a.momPct != null ? ` ${a.momPct >= 0 ? 'Naik' : 'Turun'} ${Math.abs(a.momPct)}% dibanding ${a.compareLabel}.` : ''),
    );
  } else if (a.won > 0) {
    out.push(`Realisasi ${rp(a.won)} dari ${a.wonCount} deal; target periode ini belum diisi.`);
  }
  if (a.won > 0 && a.wonDoGit > 0) out.push(`${rp(a.wonDoGit)} (${pct(a.wonDoGit, a.won)}%) dari realisasi masih GIT — sudah DO tapi belum terfaktur.`);
  if (a.requiredPerDay != null && a.daysLeft) {
    out.push(`Sisa gap ${rp(a.gap)}: perlu rata-rata ${rp(a.requiredPerDay)} per hari kerja selama ${a.daysLeft} hari kerja tersisa${a.monthCount > 1 ? ' di bulan terakhir periode' : ''}.`);
  }
  if (a.monthCount > 1 && a.wonCount) out.push(`Rata-rata realisasi ${rp(a.won / a.monthCount)} per bulan selama ${a.monthCount} bulan.`);
  if (a.coverage != null) {
    out.push(
      a.coverage >= 1
        ? `Weighted pipeline ${rp(a.weighted)} menutup ${Math.round(a.coverage * 100)}% sisa gap — fokus pada konversi deal yang sudah ada.`
        : `Weighted pipeline ${rp(a.weighted)} hanya menutup ${Math.round(a.coverage * 100)}% sisa gap — perlu tambahan prospek baru, bukan hanya konversi.`,
    );
  }
  if (a.target > 0 && a.rencanaVsTarget < 100) out.push(`Rencana penjualan ${a.scope.kind === 'se' ? 'Anda' : ''} baru mencakup ${a.rencanaVsTarget}% dari target${a.scope.kind === 'se' ? ' cabang' : ''} — gap perencanaan.`.replace('  ', ' '));
  if (a.winRate != null) out.push(`Win rate periode ini ${a.winRate}% (${a.wonCount} menang, ${a.lostCount} kalah senilai ${rp(a.lostValue)}).${a.topCompetitors[0] ? ` Kompetitor paling sering: ${a.topCompetitors[0].name}.` : ''}`);
  if (a.scope.kind !== 'cabang' && a.scope.kind !== 'se') {
    const weak = a.rows.filter((r) => r.target > 0 && r.achievement < 50);
    if (weak.length) out.push(`${weak.length} cabang di bawah 50% target: ${weak.map((r) => `${r.cabang} ${r.achievement}%`).join(', ')}.`);
  }
  if (a.aging.length) out.push(`${a.aging.length} deal aktif mangkrak (>14 hari tanpa progres) senilai ${rp(a.agingValue)}.`);
  if (a.gitOld.length) out.push(`${a.gitOld.length} DO belum terfaktur lebih dari 30 hari senilai ${rp(a.gitOld.reduce((s, x) => s + x.value, 0))} — percepat penagihan/faktur.`);
  const dingin = a.health['Dingin (Follow-up)'] || 0;
  if (dingin) {
    const n = a.topDingin.length;
    out.push(`${dingin} customer tidak order >90 hari; ${n < dingin ? `${n} terbesar` : 'semuanya'} punya riwayat pembelian ${rp(a.topDingin.reduce((s, c) => s + c.wonValue, 0))} — prioritas reaktivasi.`);
  }
  const issues = a.dataIssues.reduce((s, d) => s + d.count, 0);
  if (issues) out.push(`${issues} catatan data perlu dirapikan agar angka di atas akurat (lihat bagian Kualitas Data).`);
  return out;
}
