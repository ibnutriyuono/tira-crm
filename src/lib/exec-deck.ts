/**
 * Laporan Analisa (PPT) -- model presentasi lengkap dari seluruh data CRM yang
 * terlihat oleh user, sesuai role & hak Kelola Role. Murni (tanpa React /
 * pptxgenjs) supaya bisa diuji dan dipakai ulang; dirender oleh
 * lib/exec-ppt.ts.
 *
 * Setiap slide = satu pesan: judul berupa kesimpulan, grafik, lalu Temuan dan
 * Rekomendasi yang dihitung dari angka (bukan teks tetap).
 */
import { ACTIVITY_TYPES, STAGE_PROBABILITY, STATUS_META } from './constants';
import { classify, materialsWithValue, normalizeLine, num } from './format';
import { buildActivityKpi } from './activity-kpi';
import { buildForecast, buildForecastNasional, customerKey, daysSince, periodeList } from './reports';
import { inScope, periodeLabel, type ExecAnalysis } from './exec-analysis';
import { ISSUE_CATS, isOpenIssue, type PipelineIssue } from './issues';
import { QCD_DIMS, QCD_FAKTOR_LABEL } from './qcd';
import { fupaAsWorkflowDoc, rfqAsWorkflowDoc, workflowStage, WORKFLOW_META } from './purchasing-workflow';
import { isStaffActivityKey } from './sales-activity';
import type { ActivityTarget, BudgetTarget, CustomerGroup, Fupa, Prospect, Rfq, SalesActivity, SalesPlan, SeTarget, VisitTrip } from './types';

// ---------------------------------------------------------------- model

export type ChartKind = 'bar' | 'barH' | 'stacked' | 'line' | 'doughnut' | 'pie';
export type Unit = 'rpjt' | 'pct' | 'count' | 'ton' | 'hari';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  labels: string[];
  series: ChartSeries[];
  unit: Unit;
  /** Warna per seri (atau per kategori untuk pie/doughnut/satu seri). */
  colors?: string[];
  /** Garis acuan (mis. target 100%) untuk barH persen. */
}

export interface TableSpec {
  head: string[];
  rows: string[][];
  /** Lebar kolom relatif. */
  widths?: number[];
  /** Kolom rata kanan (angka). */
  right?: number[];
}

export interface DeckSlide {
  section: string;
  /** Judul = kesimpulan slide. */
  title: string;
  /** Penjelasan singkat di bawah judul (periode / cakupan / definisi). */
  kicker?: string;
  charts: ChartSpec[];
  table?: TableSpec;
  temuan: string[];
  aksi: string[];
}

export interface KpiTile {
  label: string;
  value: string;
  foot: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface DeckModel {
  scopeLabel: string;
  periodLabel: string;
  generatedFor: string;
  generatedAt: string;
  roleLabel: string;
  headline: string;
  kpis: KpiTile[];
  keyMessages: string[];
  agenda: string[];
  slides: DeckSlide[];
  /** Rekomendasi prioritas (gabungan semua slide, diurutkan). */
  actions: { text: string; section: string }[];
}

export interface DeckInput {
  a: ExecAnalysis;
  /** Semua prospek di store (sudah dicakup server per role). */
  prospects: Prospect[];
  budgetTargets: BudgetTarget[];
  seTargets: SeTarget[];
  salesPlans: SalesPlan[];
  rfqs: Rfq[];
  fupas: Fupa[];
  issues: PipelineIssue[];
  customerGroups: CustomerGroup[];
  activities: SalesActivity[] | null;
  activityTargets: ActivityTarget[] | null;
  trips: VisitTrip[] | null;
  /** Hak lihat modul (Kelola Role). */
  can: (mod: string) => boolean;
  user: { name: string; role: string; se: string | null };
  roleLabel: string;
  today?: Date;
}

// ---------------------------------------------------------------- helpers

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const mLabel = (m: string) => `${BLN[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const jt = (n: number) => Math.round(num(n) / 1e5) / 10; // Rp juta, 1 desimal
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/** "Rp 3,25 M" / "Rp 820 jt" / "Rp 950 rb". */
export function rp(n: number): string {
  const v = num(n);
  const a = Math.abs(v);
  if (a >= 1e9) return `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `Rp ${Math.round(v / 1e3).toLocaleString('id-ID')} rb`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}
const n0 = (n: number) => Math.round(n).toLocaleString('id-ID');
const d1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('id-ID');

/** Tanggal deal dimenangkan (PO, lalu kirim, lalu penawaran) -- sama dengan exec-analysis. */
const wonDate = (r: Prospect) => r.tglPO || r.tglDelivery || r.tglPenawaran || '';
const createdDate = (r: Prospect) => (r.tglPenawaran || String(r.createdAt || '')).slice(0, 10);

/** n bulan terakhir s/d `to` (inklusif), urut lama -> baru. */
function lastMonths(to: string, n: number): string[] {
  const [y, m] = to.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const daysBetween = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return Number.isFinite(d) && d >= 0 ? d : null;
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- builder

export function buildDeck(inp: DeckInput): DeckModel {
  const { a } = inp;
  const today = inp.today || new Date();
  const scope = a.scope;
  const isSe = scope.kind === 'se';
  const prospects = inp.prospects.filter(inScope(scope));
  const months = periodeList(a.periode, a.periodeTo);
  const monthSet = new Set(months);
  const inPeriod = (d: string | null | undefined) => !!d && monthSet.has(d.slice(0, 7));
  const trend = lastMonths(a.periodeTo, 12);
  const slides: DeckSlide[] = [];
  const who = isSe ? 'Anda' : scope.label;

  // ============================================================ 1. Tren realisasi vs target
  {
    const plans = inp.salesPlans.filter((p) => isSe || scope.cabangs.includes(up(p.cabang)));
    const seKey = up(inp.user.se);
    const rows = trend.map((m) => {
      const nas = buildForecastNasional(buildForecast(prospects, inp.budgetTargets, m, scope.cabangs, plans).filter((r) => scope.cabangs.includes(r.cabang) || r.won > 0));
      const seT = isSe ? sum(inp.seTargets.filter((t) => up(t.se) === seKey && t.periode === m).map((t) => num(t.amount))) : 0;
      return { m, won: nas.won, target: isSe ? seT : nas.target };
    });
    const hasTarget = rows.some((r) => r.target > 0);
    const won = rows.map((r) => r.won);
    const best = rows.reduce((b, r) => (r.won > b.won ? r : b), rows[0]);
    const last3 = sum(won.slice(-3)) / 3;
    const prev3 = sum(won.slice(-6, -3)) / 3;
    const trendPct = prev3 > 0 ? Math.round(((last3 - prev3) / prev3) * 100) : null;
    const ytdMonths = rows.filter((r) => r.m.slice(0, 4) === a.periodeTo.slice(0, 4));
    const ytdWon = sum(ytdMonths.map((r) => r.won));
    const ytdTarget = sum(ytdMonths.map((r) => r.target));
    const missed = rows.filter((r) => r.target > 0 && r.won < r.target).length;
    const temuan = [
      `Rata-rata realisasi 3 bulan terakhir ${rp(last3)}/bulan${trendPct != null ? `, ${trendPct >= 0 ? 'naik' : 'turun'} ${Math.abs(trendPct)}% dibanding 3 bulan sebelumnya` : ''}.`,
      `Bulan terbaik: ${mLabel(best.m)} (${rp(best.won)}).`,
    ];
    if (ytdTarget > 0) temuan.push(`YTD ${a.periodeTo.slice(0, 4)}: ${rp(ytdWon)} dari ${rp(ytdTarget)} (${pct(ytdWon, ytdTarget)}%).`);
    if (hasTarget) temuan.push(`${missed} dari ${rows.filter((r) => r.target > 0).length} bulan bertarget berada di bawah target.`);
    const aksi: string[] = [];
    if (trendPct != null && trendPct < -10) aksi.push(`Realisasi melambat ${Math.abs(trendPct)}% — tinjau ulang pipeline 3 tahap terakhir dan percepat deal Negosiasi.`);
    if (ytdTarget > 0 && pct(ytdWon, ytdTarget) < 90) aksi.push(`Kejar ketertinggalan YTD ${rp(ytdTarget - ytdWon)}: tetapkan target bulanan tambahan di sisa tahun.`);
    if (!hasTarget) aksi.push(isSe ? 'Target pribadi belum dibagi BM — minta pembagian target di Forecast → Target per Sales.' : 'Target belum diisi untuk periode ini — lengkapi di Forecast agar achievement terukur.');
    slides.push({
      section: 'Kinerja Penjualan',
      title: trendPct == null ? `Realisasi ${who} 12 bulan terakhir` : `Realisasi ${trendPct >= 0 ? 'tumbuh' : 'melambat'} ${Math.abs(trendPct)}% dalam 3 bulan terakhir`,
      kicker: `Realisasi (PO/DO) vs ${isSe ? 'target pribadi' : 'target'} per bulan, ${mLabel(trend[0])} – ${mLabel(trend[11])}, Rp juta`,
      charts: [
        {
          kind: 'bar',
          title: 'Realisasi vs Target per bulan (Rp juta)',
          labels: rows.map((r) => mLabel(r.m)),
          series: hasTarget ? [{ name: 'Target', values: rows.map((r) => jt(r.target)) }, { name: 'Realisasi', values: rows.map((r) => jt(r.won)) }] : [{ name: 'Realisasi', values: rows.map((r) => jt(r.won)) }],
          unit: 'rpjt',
          colors: hasTarget ? ['C9D3DD', '2E5C7E'] : ['2E5C7E'],
        },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 2. Regional / cabang
  if (!isSe) {
    const rows = a.rows.filter((r) => r.target > 0 || r.won > 0 || r.openCount > 0).sort((x, y) => y.achievement - x.achievement || y.won - x.won);
    if (rows.length > 1) {
      const top = rows[0];
      const weak = rows.filter((r) => r.target > 0 && r.achievement < 80);
      const noTarget = rows.filter((r) => r.target <= 0);
      const share = rows.map((r) => ({ c: r.cabang, s: pct(r.won, a.won) })).sort((x, y) => y.s - x.s);
      const temuan = [
        `Achievement tertinggi: ${top.cabang} ${top.achievement}% (${rp(top.won)}).`,
        weak.length ? `${weak.length} cabang di bawah 80%: ${weak.slice(0, 5).map((r) => `${r.cabang} ${r.achievement}%`).join(', ')}.` : 'Semua cabang bertarget mencapai ≥80%.',
        a.won > 0 ? `${share[0].c} menyumbang ${share[0].s}% realisasi ${scope.label}${share[1] ? `, ${share[1].c} ${share[1].s}%` : ''}.` : 'Belum ada realisasi pada periode ini.',
      ];
      if (noTarget.length) temuan.push(`${noTarget.length} cabang belum memiliki target: ${noTarget.slice(0, 4).map((r) => r.cabang).join(', ')}.`);
      const aksi: string[] = [];
      weak.slice(0, 3).forEach((r) => aksi.push(`${r.cabang}: sisa gap ${rp(Math.max(0, r.target - r.won))}; pipeline berbobot ${rp(r.weighted)}${r.weighted < r.target - r.won ? ' — kurang, perlu prospek baru' : ' — cukup, fokus konversi'}.`));
      slides.push({
        section: 'Kinerja Penjualan',
        title: weak.length ? `${weak.length} cabang tertinggal dari target ${a.periodLabel}` : `Semua cabang on-track ${a.periodLabel}`,
        kicker: `Achievement realisasi vs target per cabang, ${a.periodLabel}`,
        charts: [
          { kind: 'barH', title: 'Achievement per cabang (%)', labels: rows.slice(0, 13).map((r) => r.cabang).reverse(), series: [{ name: 'Achievement', values: rows.slice(0, 13).map((r) => r.achievement).reverse() }], unit: 'pct', colors: ['2E5C7E'] },
        ],
        table: {
          head: ['Cabang', 'Target', 'Realisasi', 'Ach.', 'Weighted', 'Mangkrak'],
          rows: rows.slice(0, 13).map((r) => [r.cabang, rp(r.target), rp(r.won), `${r.achievement}%`, rp(r.weighted), String(r.agingCount)]),
          widths: [14, 18, 18, 10, 18, 12],
          right: [1, 2, 3, 4, 5],
        },
        temuan,
        aksi,
      });
    }
  }

  // ============================================================ 3. SE ranking / kontribusi
  if (!isSe && a.seRows.length > 1) {
    const se = [...a.seRows].sort((x, y) => y.won - x.won);
    const top10 = se.slice(0, 10);
    const totalWon = sum(se.map((r) => r.won));
    const top3Share = pct(sum(se.slice(0, 3).map((r) => r.won)), totalWon);
    const zero = se.filter((r) => r.won <= 0);
    const highPipe = [...se].sort((x, y) => y.weighted - x.weighted).filter((r) => r.weighted > 0 && r.won <= 0).slice(0, 3);
    const temuan = [
      totalWon > 0 ? `3 SE teratas menyumbang ${top3Share}% realisasi (${top10.slice(0, 3).map((r) => r.se).join(', ')}).` : 'Belum ada realisasi SE pada periode ini.',
      `${zero.length} dari ${se.length} SE belum mencatat realisasi pada periode ini.`,
    ];
    if (highPipe.length) temuan.push(`Pipeline besar tapi belum closing: ${highPipe.map((r) => `${r.se} (${rp(r.weighted)})`).join(', ')}.`);
    const aksi: string[] = [];
    if (top3Share >= 70) aksi.push('Ketergantungan tinggi pada 3 SE — dampingi SE lain lewat joint visit dan review pipeline mingguan.');
    highPipe.forEach((r) => aksi.push(`Coaching closing untuk ${r.se}: pipeline berbobot ${rp(r.weighted)} belum menjadi PO.`));
    slides.push({
      section: 'Kinerja Penjualan',
      title: totalWon > 0 ? `Realisasi terkonsentrasi: 3 SE = ${top3Share}% dari total` : 'Peringkat SE periode ini',
      kicker: `Realisasi dan pipeline berbobot per SE, ${a.periodLabel}, Rp juta`,
      charts: [
        {
          kind: 'barH',
          title: 'Realisasi & weighted pipeline per SE (Rp juta)',
          labels: top10.map((r) => `${r.se} · ${r.cabang}`).reverse(),
          series: [{ name: 'Realisasi', values: top10.map((r) => jt(r.won)).reverse() }, { name: 'Weighted pipeline', values: top10.map((r) => jt(r.weighted)).reverse() }],
          unit: 'rpjt',
          colors: ['2E5C7E', 'C47F2C'],
        },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 4. Pipeline: funnel & umur
  {
    const open = prospects.filter((r) => classify(r) === 'Aktif');
    const stages = [1, 2, 3];
    const byStage = stages.map((s) => open.filter((r) => num(r.status) === s));
    const ageOf = (r: Prospect) => daysSince(String(r.statusChangedAt || r.updatedAt || '').slice(0, 10));
    const buckets = [
      { l: '0–14 hari', f: (d: number) => d <= 14 },
      { l: '15–30 hari', f: (d: number) => d > 14 && d <= 30 },
      { l: '31–60 hari', f: (d: number) => d > 30 && d <= 60 },
      { l: '> 60 hari', f: (d: number) => d > 60 },
    ];
    const ages = open.map((r) => ({ r, d: ageOf(r) })).filter((x) => Number.isFinite(x.d));
    const old = ages.filter((x) => x.d > 30);
    const oldVal = sum(old.map((x) => num(x.r.value)));
    const openVal = sum(open.map((r) => num(r.value)));
    // Konversi kohort: prospek dibuat dalam 12 bulan terakhir.
    const cohort = prospects.filter((r) => trend.includes(createdDate(r).slice(0, 7)) && num(r.status) >= 1);
    const reachedQuote = cohort.filter((r) => num(r.status) >= 2 && num(r.status) !== 6 || (num(r.status) === 6 && !!r.tglPenawaran));
    const reachedWon = cohort.filter((r) => classify(r) === 'Won');
    const temuan = [
      `Pipeline aktif ${open.length} deal senilai ${rp(openVal)}; berbobot ${rp(a.weighted)}.`,
      `Tahap terbesar: ${STATUS_META[stages[byStage.map((l) => sum(l.map((r) => num(r.value)))).indexOf(Math.max(...byStage.map((l) => sum(l.map((r) => num(r.value))))))]]?.label ?? '-'}.`,
      old.length ? `${old.length} deal (${rp(oldVal)}, ${pct(oldVal, openVal)}% nilai) tidak bergerak lebih dari 30 hari.` : 'Tidak ada deal aktif yang diam lebih dari 30 hari.',
    ];
    if (cohort.length) temuan.push(`Konversi 12 bulan: ${pct(reachedQuote.length, cohort.length)}% permintaan sampai penawaran, ${pct(reachedWon.length, cohort.length)}% menjadi PO/DO.`);
    const aksi: string[] = [];
    if (old.length) aksi.push(`Review ${Math.min(old.length, 10)} deal tertua (>30 hari): putuskan dorong, turunkan tahap, atau tandai Lose agar forecast jujur.`);
    if (byStage[0].length > byStage[1].length * 2 && byStage[0].length > 3) aksi.push(`Banyak permintaan belum ditawar (${byStage[0].length} deal) — percepat RFQ & surat penawaran.`);
    slides.push({
      section: 'Pipeline',
      title: old.length ? `${pct(oldVal, openVal)}% nilai pipeline diam lebih dari 30 hari` : `Pipeline aktif ${rp(openVal)} bergerak sehat`,
      kicker: 'Nilai pipeline aktif per tahap (kiri) dan umur sejak perubahan status terakhir (kanan)',
      charts: [
        { kind: 'bar', title: 'Nilai per tahap (Rp juta)', labels: stages.map((s) => STATUS_META[s]?.label ?? String(s)), series: [{ name: 'Nilai', values: byStage.map((l) => jt(sum(l.map((r) => num(r.value))))) }], unit: 'rpjt', colors: ['2E5C7E'] },
        { kind: 'bar', title: 'Jumlah deal per umur', labels: buckets.map((b) => b.l), series: [{ name: 'Deal', values: buckets.map((b) => ages.filter((x) => b.f(x.d)).length) }], unit: 'count', colors: ['2F8F5B', '2E5C7E', 'C47F2C', 'B94A3D'] },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 5. Forecast & coverage
  {
    const open = prospects.filter((r) => classify(r) === 'Aktif');
    const commit = sum(open.filter((r) => num(r.status) === 3).map((r) => num(r.value) * (STAGE_PROBABILITY[3] ?? 0.6)));
    const best = sum(open.filter((r) => num(r.status) === 2).map((r) => num(r.value) * (STAGE_PROBABILITY[2] ?? 0.3)));
    const early = sum(open.filter((r) => num(r.status) === 1).map((r) => num(r.value) * (STAGE_PROBABILITY[1] ?? 0.1)));
    const landing = a.won + a.weighted;
    const temuan = [
      `Realisasi ${rp(a.won)} + pipeline berbobot ${rp(a.weighted)} = proyeksi ${rp(landing)}${a.target > 0 ? ` (${pct(landing, a.target)}% target)` : ''}.`,
      `Komposisi berbobot: Negosiasi ${rp(commit)}, Penawaran ${rp(best)}, Permintaan ${rp(early)}.`,
    ];
    if (a.coverage != null) temuan.push(`Coverage pipeline terhadap sisa gap: ${Math.round(a.coverage * 100)}%${a.coverage < 1 ? ' — belum cukup menutup gap' : ''}.`);
    if (a.requiredPerDay) temuan.push(`Perlu ${rp(a.requiredPerDay)} per hari kerja selama ${a.daysLeft} hari kerja tersisa.`);
    const aksi: string[] = [];
    if (a.coverage != null && a.coverage < 1) aksi.push(`Tambah pipeline baru minimal ${rp(Math.max(0, a.gap - a.weighted) / 0.3)} (nilai penawaran) untuk menutup gap pada tingkat konversi 30%.`);
    if (commit > 0) aksi.push(`Prioritaskan deal Negosiasi (berbobot ${rp(commit)}) — paling dekat ke PO.`);
    slides.push({
      section: 'Pipeline',
      title: a.target > 0 ? `Proyeksi akhir ${pct(landing, a.target)}% dari target bila pipeline terkonversi sesuai bobot` : `Proyeksi ${rp(landing)} dari realisasi + pipeline berbobot`,
      kicker: `Bobot tahap: Permintaan 10%, Penawaran 30%, Negosiasi 60% · ${a.periodLabel}`,
      charts: [
        {
          kind: 'bar',
          title: 'Target, realisasi, dan proyeksi (Rp juta)',
          labels: ['Target', 'Realisasi', '+ Negosiasi', '+ Penawaran', '+ Permintaan', 'Proyeksi'],
          series: [{ name: 'Nilai', values: [a.target, a.won, commit, best, early, landing].map(jt) }],
          unit: 'rpjt',
          colors: ['6B7684', '2E5C7E', 'C47F2C', 'D9A35E', 'E8CBA2', '2F8F5B'],
        },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 6. Win / loss & kompetitor & QCD
  {
    const decided = prospects.filter((r) => (classify(r) === 'Won' && inPeriod(wonDate(r))) || (classify(r) === 'Lost' && inPeriod(String(r.statusChangedAt || ''))));
    const closed12 = prospects.filter((r) => (classify(r) === 'Won' && trend.includes(wonDate(r).slice(0, 7))) || (classify(r) === 'Lost' && trend.includes(String(r.statusChangedAt || '').slice(0, 7))));
    const lost12 = closed12.filter((r) => classify(r) === 'Lost');
    const wr12 = closed12.length ? pct(closed12.length - lost12.length, closed12.length) : null;
    const faktor = new Map<string, { n: number; v: number }>();
    lost12.forEach((r) => {
      const k = QCD_FAKTOR_LABEL[r.qcdFaktor || ''] || 'Tidak diisi';
      const e = faktor.get(k) || { n: 0, v: 0 };
      e.n++;
      e.v += num(r.value);
      faktor.set(k, e);
    });
    const fList = Array.from(faktor.entries()).sort((x, y) => y[1].v - x[1].v).slice(0, 6);
    const qcd = QCD_DIMS.map((d) => {
      const rows = closed12.filter((r) => r[d.field]);
      return { d, unggul: rows.filter((r) => r[d.field] === 'unggul').length, setara: rows.filter((r) => r[d.field] === 'setara').length, kalah: rows.filter((r) => r[d.field] === 'kalah').length };
    });
    const worstDim = [...qcd].sort((x, y) => y.kalah - x.kalah)[0];
    const temuan = [
      a.winRate != null ? `Win rate ${a.periodLabel}: ${a.winRate}% (${a.wonCount} menang, ${a.lostCount} kalah ${rp(a.lostValue)}).` : `Belum ada deal yang ditutup pada ${a.periodLabel}.`,
      wr12 != null ? `Win rate 12 bulan: ${wr12}% dari ${closed12.length} deal yang ditutup.` : 'Belum ada deal yang ditutup dalam 12 bulan.',
    ];
    if (fList.length) temuan.push(`Penyebab kalah terbesar (nilai): ${fList.slice(0, 2).map(([k, v]) => `${k} ${rp(v.v)}`).join(', ')}.`);
    if (a.topCompetitors[0]) temuan.push(`Kompetitor paling sering menang: ${a.topCompetitors.slice(0, 3).map((c) => `${c.name} (${c.count}×)`).join(', ')}.`);
    if (worstDim && worstDim.kalah > 0) temuan.push(`Dimensi QCD terlemah: ${worstDim.d.label} — kalah di ${worstDim.kalah} deal.`);
    const aksi: string[] = [];
    if (fList[0] && fList[0][0] === 'Harga') aksi.push('Harga jadi penyebab kalah utama — siapkan skema harga volume / Key Account dan review harga beli dengan Purchasing.');
    if (fList.some(([k]) => k === 'Tidak diisi')) aksi.push('Wajibkan isian faktor penentu & kompetitor saat Lose agar analisa kekalahan akurat.');
    if (worstDim && worstDim.d.key === 'delivery' && worstDim.kalah > 0) aksi.push('Delivery sering kalah — koordinasikan stok cepat-laku dan lead time dengan Purchasing.');
    void decided;
    slides.push({
      section: 'Menang & Kalah',
      title: wr12 != null ? `Win rate 12 bulan ${wr12}%${fList[0] ? ` — ${fList[0][0].toLowerCase()} penyebab kalah terbesar` : ''}` : 'Belum ada data menang/kalah',
      kicker: 'Deal yang ditutup 12 bulan terakhir: faktor kalah (nilai) dan posisi QCD terhadap kompetitor',
      charts: [
        { kind: 'barH', title: 'Nilai kalah per faktor (Rp juta)', labels: fList.map(([k]) => k).reverse(), series: [{ name: 'Nilai kalah', values: fList.map(([, v]) => jt(v.v)).reverse() }], unit: 'rpjt', colors: ['B94A3D'] },
        {
          kind: 'stacked',
          title: 'Posisi QCD vs kompetitor (jumlah deal)',
          labels: qcd.map((q) => q.d.label),
          series: [{ name: 'Lebih unggul', values: qcd.map((q) => q.unggul) }, { name: 'Setara', values: qcd.map((q) => q.setara) }, { name: 'Lebih lemah', values: qcd.map((q) => q.kalah) }],
          unit: 'count',
          colors: ['2F8F5B', 'C9D3DD', 'B94A3D'],
        },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 7. Produk / Line & grade
  {
    const byLine = new Map<string, { won: number; pipe: number }>();
    const byGrade = new Map<string, number>();
    prospects.forEach((r) => {
      const c = classify(r);
      const isWon = c === 'Won' && inPeriod(wonDate(r));
      const isPipe = c === 'Aktif';
      if (!isWon && !isPipe) return;
      materialsWithValue(r).forEach((m) => {
        const line = normalizeLine(m.line).split(/\s*,\s*/)[0] || '-';
        const e = byLine.get(line) || { won: 0, pipe: 0 };
        if (isWon) e.won += m.nilai;
        else e.pipe += m.nilai * (STAGE_PROBABILITY[num(r.status)] ?? 0);
        byLine.set(line, e);
        if (isWon) {
          // Fabrikasi (Line 05) tidak punya grade; material lain tanpa grade memakai 2 kata awal uraian.
          const g = line === '05' ? 'Fabrikasi (Line 05)' : up((m as { grade?: string }).grade) || up(m.uraian).split(/\s+/).slice(0, 2).join(' ').slice(0, 24) || '-';
          byGrade.set(g, (byGrade.get(g) || 0) + m.nilai);
        }
      });
    });
    const lines = Array.from(byLine.entries()).sort((x, y) => y[1].won + y[1].pipe - (x[1].won + x[1].pipe)).slice(0, 8);
    const grades = Array.from(byGrade.entries()).sort((x, y) => y[1] - x[1]).slice(0, 8);
    const totWon = sum(lines.map(([, v]) => v.won));
    const topLine = [...lines].sort((x, y) => y[1].won - x[1].won)[0];
    const growthLine = [...lines].sort((x, y) => y[1].pipe - x[1].pipe)[0];
    const temuan: string[] = [];
    if (topLine && topLine[1].won > 0) temuan.push(`Line ${topLine[0]} menyumbang ${pct(topLine[1].won, totWon)}% realisasi (${rp(topLine[1].won)}).`);
    if (growthLine && growthLine[1].pipe > 0) temuan.push(`Pipeline berbobot terbesar ada di Line ${growthLine[0]} (${rp(growthLine[1].pipe)}) — potensi realisasi berikutnya.`);
    if (grades[0]) temuan.push(`Grade/material terlaris: ${grades.slice(0, 3).map(([g, v]) => `${g} (${rp(v)})`).join(', ')}.`);
    const aksi: string[] = [];
    if (growthLine && topLine && growthLine[0] !== topLine[0]) aksi.push(`Siapkan stok & harga untuk Line ${growthLine[0]} yang pipeline-nya sedang naik.`);
    if (grades[0]) aksi.push(`Pastikan ketersediaan ${grades[0][0]} — grade dengan realisasi terbesar periode ini.`);
    if (lines.length) {
      slides.push({
        section: 'Produk',
        title: topLine && topLine[1].won > 0 ? (growthLine && growthLine[0] !== topLine[0] && growthLine[1].pipe > 0 ? `Line ${topLine[0]} memimpin realisasi; Line ${growthLine[0]} memimpin pipeline` : `Line ${topLine[0]} memimpin realisasi dan pipeline`) : 'Komposisi produk pada pipeline',
        kicker: `Realisasi ${a.periodLabel} dan pipeline berbobot per Line (Rp juta); grade terlaris dari realisasi`,
        charts: [
          { kind: 'stacked', title: 'Per Line (Rp juta)', labels: lines.map(([l]) => `Line ${l}`), series: [{ name: 'Realisasi', values: lines.map(([, v]) => jt(v.won)) }, { name: 'Pipeline berbobot', values: lines.map(([, v]) => jt(v.pipe)) }], unit: 'rpjt', colors: ['2E5C7E', 'C47F2C'] },
          ...(grades.length ? [{ kind: 'barH' as const, title: 'Grade terlaris (Rp juta)', labels: grades.map(([g]) => g).reverse(), series: [{ name: 'Realisasi', values: grades.map(([, v]) => jt(v)).reverse() }], unit: 'rpjt' as const, colors: ['2E5C7E'] }] : []),
        ],
        temuan,
        aksi,
      });
    }
  }

  // ============================================================ 8. Customer: konsentrasi & kesehatan
  {
    const wonP = prospects.filter((r) => classify(r) === 'Won' && trend.includes(wonDate(r).slice(0, 7)));
    const cust = new Map<string, { name: string; v: number }>();
    wonP.forEach((r) => {
      const k = customerKey(r.customer);
      const e = cust.get(k) || { name: r.customer, v: 0 };
      e.v += num(r.value);
      cust.set(k, e);
    });
    const list = Array.from(cust.values()).sort((x, y) => y.v - x.v);
    const tot = sum(list.map((c) => c.v));
    const top10 = list.slice(0, 10);
    const top5Share = pct(sum(list.slice(0, 5).map((c) => c.v)), tot);
    // Customer baru: order pertama jatuh di periode ini.
    const firstWon = new Map<string, string>();
    prospects.filter((r) => classify(r) === 'Won').forEach((r) => {
      const k = customerKey(r.customer);
      const d = wonDate(r);
      if (d && (!firstWon.has(k) || d < firstWon.get(k)!)) firstWon.set(k, d);
    });
    const newCust = Array.from(firstWon.values()).filter((d) => inPeriod(d)).length;
    const h = a.health;
    const temuan = [
      tot > 0 ? (list.length > 5 ? `5 customer terbesar = ${top5Share}% realisasi 12 bulan (${rp(tot)} dari ${list.length} customer).` : `Realisasi 12 bulan ${rp(tot)} hanya berasal dari ${list.length} customer.`) : 'Belum ada realisasi 12 bulan.',
      `${newCust} customer baru melakukan order pertama pada ${a.periodLabel}.`,
      `Status customer: ${h['Aktif'] || 0} aktif, ${h['Menghangat'] || 0} menghangat, ${h['Dingin (Follow-up)'] || 0} dingin.`,
    ];
    if (a.topDingin[0]) temuan.push(`Customer dingin bernilai terbesar: ${a.topDingin.slice(0, 3).map((c) => c.name).join(', ')}.`);
    const aksi: string[] = [];
    if (top5Share >= 60 || (tot > 0 && list.length <= 5)) aksi.push(`Risiko konsentrasi: ${list.length <= 5 ? `seluruh realisasi dari ${list.length} customer` : `${top5Share}% bergantung pada 5 customer`} — jaga lewat Key Account dan perluas basis customer.`);
    if ((h['Dingin (Follow-up)'] || 0) > 0) aksi.push(`Jalankan program reaktivasi untuk ${h['Dingin (Follow-up)']} customer dingin, mulai dari ${a.topDingin[0]?.name || 'yang bernilai terbesar'}.`);
    if (newCust === 0) aksi.push('Belum ada customer baru — alokasikan kunjungan prospek baru di Aktivitas Harian.');
    slides.push({
      section: 'Customer',
      title: tot > 0 ? (list.length > 5 ? `${top5Share}% realisasi bergantung pada 5 customer` : `Realisasi bertumpu pada ${list.length} customer — basis perlu diperluas`) : 'Kesehatan basis customer',
      kicker: 'Customer terbesar 12 bulan (Rp juta) dan status kesehatan customer',
      charts: [
        { kind: 'barH', title: 'Customer terbesar 12 bulan (Rp juta)', labels: top10.map((c) => c.name.slice(0, 30)).reverse(), series: [{ name: 'Realisasi', values: top10.map((c) => jt(c.v)).reverse() }], unit: 'rpjt', colors: ['2E5C7E'] },
        { kind: 'doughnut', title: 'Status customer', labels: ['Aktif', 'Menghangat', 'Dingin', 'Belum order'], series: [{ name: 'Customer', values: [h['Aktif'] || 0, h['Menghangat'] || 0, h['Dingin (Follow-up)'] || 0, h['Belum Pernah Order'] || 0] }], unit: 'count', colors: ['2F8F5B', 'C47F2C', 'B94A3D', 'C9D3DD'] },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 9. Key Account
  if (inp.can('kam') && inp.customerGroups.length) {
    const TIERS = ['strategic', 'key', 'development', 'monitor'];
    const TL: Record<string, string> = { strategic: 'Strategic', key: 'Key Account', development: 'Development', monitor: 'Monitor' };
    const g = inp.customerGroups.filter((x) => isSe || !x.homeCabang || scope.cabangs.includes(up(x.homeCabang)) || scope.kind === 'nasional');
    const per = TIERS.map((t) => {
      const l = g.filter((x) => String(x.tier).toLowerCase() === t);
      return { t, n: l.length, v: sum(l.map((x) => num(x.l12m))) };
    });
    const noPlan = g.filter((x) => (String(x.tier).toLowerCase() === 'strategic' || String(x.tier).toLowerCase() === 'key') && !(x.actions || []).some((ac) => ac.status === 'belum' || ac.status === 'berjalan'));
    const stale = g.filter((x) => x.lastTrx && daysSince(x.lastTrx) > 90);
    const totL12 = sum(per.map((p) => p.v));
    const temuan = [
      `${g.length} grup Key Account; omzet 12 bulan ${rp(totL12)}.`,
      `Strategic + Key = ${per[0].n + per[1].n} grup (${pct(per[0].v + per[1].v, totL12)}% omzet).`,
    ];
    if (noPlan.length) temuan.push(`${noPlan.length} grup Strategic/Key belum punya rencana aksi aktif.`);
    if (stale.length) temuan.push(`${stale.length} grup tanpa transaksi lebih dari 90 hari.`);
    const aksi: string[] = [];
    if (noPlan.length) aksi.push(`Lengkapi account plan untuk ${noPlan.slice(0, 3).map((x) => x.name).join(', ')}${noPlan.length > 3 ? ', dst.' : ''}.`);
    if (stale.length) aksi.push(`Jadwalkan kunjungan ketua tim ke grup yang diam >90 hari: ${stale.slice(0, 3).map((x) => x.name).join(', ')}.`);
    slides.push({
      section: 'Customer',
      title: noPlan.length ? `${noPlan.length} grup Strategic/Key belum punya rencana aksi` : `Key Account: ${g.length} grup, omzet ${rp(totL12)}`,
      kicker: 'Jumlah grup dan omzet 12 bulan per tier Key Account',
      charts: [
        { kind: 'bar', title: 'Omzet 12 bulan per tier (Rp juta)', labels: per.map((p) => TL[p.t]), series: [{ name: 'Omzet', values: per.map((p) => jt(p.v)) }], unit: 'rpjt', colors: ['1A222B', '2E5C7E', 'C47F2C', 'C9D3DD'] },
      ],
      table: {
        head: ['Grup', 'Tier', 'Omzet 12 bln', 'Transaksi terakhir'],
        rows: [...g].sort((x, y) => num(y.l12m) - num(x.l12m)).slice(0, 8).map((x) => [x.name, TL[String(x.tier).toLowerCase()] || String(x.tier), rp(num(x.l12m)), x.lastTrx || '-']),
        widths: [40, 18, 22, 20],
        right: [2],
      },
      temuan,
      aksi,
    });
  }

  // ============================================================ 10. Aktivitas Harian
  if (inp.can('aktivitas') && inp.activities) {
    const own = up(inp.user.se);
    const acts = inp.activities.filter((x) => x.status !== 'rencana' && (isSe ? up(x.se) === own || !own : !isStaffActivityKey(x.se)) && (isSe || !x.cabang || scope.cabangs.includes(up(x.cabang)) || scope.kind === 'nasional'));
    const six = lastMonths(a.periodeTo, 6);
    const custTypes = ACTIVITY_TYPES.map((t) => t.key as string);
    const perMonth = ACTIVITY_TYPES.map((t) => ({ name: t.short, values: six.map((m) => acts.filter((x) => x.tipe === t.key && x.tanggal.startsWith(m)).length) }));
    const inPer = acts.filter((x) => inPeriod(x.tanggal) && custTypes.includes(x.tipe));
    const custTouched = new Set(inPer.map((x) => customerKey(x.customer))).size;
    const converted = inPer.filter((x) => x.prospectId).length;
    const kpi = inp.activityTargets && !isSe ? buildActivityKpi(inPer, inp.activityTargets.filter((t) => !isStaffActivityKey(t.se)), prospects, { periode: a.periodeTo }) : [];
    const ranked = kpi.filter((r) => r.overall != null).sort((x, y) => (y.overall ?? 0) - (x.overall ?? 0));
    const low = ranked.filter((r) => (r.overall ?? 0) < 0.6);
    const visits = inPer.filter((x) => x.tipe === 'kunjungan').length;
    const temuan = [
      `${inPer.length} aktivitas pada ${a.periodLabel}: ${ACTIVITY_TYPES.map((t) => `${t.short} ${inPer.filter((x) => x.tipe === t.key).length}`).join(', ')}.`,
      `${custTouched} customer berbeda disentuh; ${converted} aktivitas (${pct(converted, inPer.length)}%) berlanjut ke pipeline.`,
    ];
    if (ranked.length) temuan.push(`Pencapaian target aktivitas tertinggi: ${ranked.slice(0, 2).map((r) => `${r.se} ${Math.round((r.overall ?? 0) * 100)}%`).join(', ')}.`);
    if (low.length) temuan.push(`${low.length} SE di bawah 60% target aktivitas: ${low.slice(0, 4).map((r) => r.se).join(', ')}.`);
    const aksi: string[] = [];
    if (inPer.length && pct(converted, inPer.length) < 10) aksi.push('Konversi aktivitas ke pipeline rendah — dorong tombol "→ Permintaan/Penawaran" saat kunjungan menghasilkan peluang.');
    if (low.length) aksi.push(`Review disiplin input aktivitas bersama ${low.slice(0, 3).map((r) => r.se).join(', ')}.`);
    if (visits < inPer.length * 0.2 && inPer.length > 10) aksi.push('Proporsi kunjungan tatap muka rendah — jadwalkan kunjungan ke customer prioritas.');
    slides.push({
      section: 'Aktivitas & Operasional',
      title: inPer.length ? `${inPer.length} aktivitas menyentuh ${custTouched} customer; ${pct(converted, inPer.length)}% menjadi pipeline` : 'Belum ada aktivitas tercatat pada periode ini',
      kicker: `Aktivitas customer per jenis, 6 bulan terakhir${isSe ? ' (aktivitas Anda)' : ' (Sales & BM)'}`,
      charts: [
        { kind: 'stacked', title: 'Aktivitas per bulan', labels: six.map(mLabel), series: perMonth, unit: 'count', colors: ['2E5C7E', 'C47F2C', '2F8F5B', '6B7684'] },
        ...(ranked.length
          ? [{ kind: 'barH' as const, title: 'Pencapaian target aktivitas per SE (%)', labels: ranked.slice(0, 10).map((r) => r.se).reverse(), series: [{ name: 'Pencapaian', values: ranked.slice(0, 10).map((r) => Math.round((r.overall ?? 0) * 100)).reverse() }], unit: 'pct' as const, colors: ['2E5C7E'] }]
          : []),
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 11. RFQ / FUP A & respons Purchasing
  if (inp.can('rfq') && (inp.rfqs.length || inp.fupas.length)) {
    const inSc = (c: string | null) => isSe || scope.kind === 'nasional' || scope.cabangs.includes(up(c));
    const rfqs = inp.rfqs.filter((r) => inSc(r.cabang) && r.status !== 'Draft');
    const fupas = inp.fupas.filter((f) => inSc(f.cabang) && f.status !== 'Draft');
    const six = lastMonths(a.periodeTo, 6);
    const sentMonth = (d: { sentToPurchasingAt: string | null; createdAt: string }) => (d.sentToPurchasingAt || d.createdAt || '').slice(0, 7);
    const resp = rfqs.map((r) => daysBetween(r.sentToPurchasingAt, r.jawabanRfqAt)).filter((x): x is number => x != null);
    const respF = fupas.map((f) => daysBetween(f.sentToPurchasingAt, f.jawabanFupaAt)).filter((x): x is number => x != null);
    const med = median(resp);
    const stages = [1, 2, 3, 4, 5, 6] as const;
    const stageCount = stages.map((s) => rfqs.filter((r) => workflowStage(rfqAsWorkflowDoc(r)) === s).length + fupas.filter((f) => workflowStage(fupaAsWorkflowDoc(f)) === s).length);
    const pending = rfqs.filter((r) => [1, 2].includes(workflowStage(rfqAsWorkflowDoc(r)))).map((r) => ({ r, d: daysSince((r.sentToPurchasingAt || r.createdAt).slice(0, 10)) })).filter((x) => x.d > 3);
    const items = rfqs.flatMap((r) => r.items || []);
    const nq = items.filter((it) => it.noQuote).length;
    const toFupa = rfqs.filter((r) => r.fupaId).length;
    const temuan = [
      `${rfqs.length} RFQ dan ${fupas.length} FUP A dikirim ke Purchasing (total, dalam cakupan).`,
      med != null ? `Median waktu jawab RFQ ${d1(med)} hari${respF.length ? `; FUP A ${d1(median(respF) || 0)} hari` : ''}.` : 'Belum ada RFQ yang dijawab.',
      `${pct(nq, items.length)}% material berstatus No Quote; ${pct(toFupa, rfqs.length)}% RFQ berlanjut menjadi FUP A.`,
    ];
    if (pending.length) temuan.push(`${pending.length} RFQ menunggu jawaban lebih dari 3 hari.`);
    const aksi: string[] = [];
    if (pending.length) aksi.push(`Eskalasi ${pending.length} RFQ yang menunggu >3 hari: ${pending.slice(0, 3).map((x) => x.r.noRfq || x.r.customer).join(', ')}.`);
    if (med != null && med > 3) aksi.push('Waktu jawab RFQ melebihi 3 hari — sepakati SLA jawaban dengan Purchasing.');
    if (items.length && pct(nq, items.length) > 15) aksi.push('No Quote tinggi — perluas database vendor untuk grade yang sering tidak tersedia.');
    slides.push({
      section: 'Aktivitas & Operasional',
      title: med != null ? `RFQ dijawab Purchasing dalam ${d1(med)} hari (median)${toFupa ? `; ${pct(toFupa, rfqs.length)}% berlanjut ke FUP A` : ''}` : 'Alur RFQ & FUP A ke Purchasing',
      kicker: 'Dokumen dikirim per bulan (6 bulan) dan posisi status Purchasing saat ini',
      charts: [
        { kind: 'bar', title: 'Dokumen dikirim per bulan', labels: six.map(mLabel), series: [{ name: 'RFQ', values: six.map((m) => rfqs.filter((r) => sentMonth(r) === m).length) }, { name: 'FUP A', values: six.map((m) => fupas.filter((f) => sentMonth(f) === m).length) }], unit: 'count', colors: ['2E5C7E', 'C47F2C'] },
        { kind: 'barH', title: 'Status Purchasing (dokumen)', labels: stages.map((s) => WORKFLOW_META[s].label).reverse(), series: [{ name: 'Dokumen', values: [...stageCount].reverse() }], unit: 'count', colors: ['2E5C7E'] },
      ],
      temuan,
      aksi,
    });
  }

  // ============================================================ 12. Masalah pipeline
  if (inp.can('masalah') && inp.issues.length) {
    const iss = inp.issues.filter((i) => (isSe ? up(i.se) === up(inp.user.se) : scope.kind === 'nasional' || scope.cabangs.includes(up(i.cabang))) && i.status !== 'diabaikan');
    if (iss.length) {
      const pv = new Map(prospects.map((p) => [p.id, num(p.value)]));
      const cats = ISSUE_CATS.map((c) => {
        const l = iss.filter((i) => i.kategori === c.key && isOpenIssue(i));
        return { c, n: l.length, v: sum(l.map((i) => pv.get(i.prospectId) || 0)) };
      }).filter((x) => x.n > 0).sort((x, y) => y.v - x.v);
      const open = iss.filter(isOpenIssue);
      const overdue = open.filter((i) => i.targetDate && i.targetDate < today.toISOString().slice(0, 10));
      const done = iss.filter((i) => i.status === 'selesai');
      const dealDone = done.filter((i) => i.hasil === 'deal').length;
      const solveDays = median(done.map((i) => daysBetween(i.dilaporAt || i.createdAt, i.selesaiAt)).filter((x): x is number => x != null));
      const openVal = sum(open.map((i) => pv.get(i.prospectId) || 0));
      const temuan = [
        `${open.length} masalah terbuka menahan pipeline ${rp(openVal)}; ${overdue.length} melewati target selesai.`,
        cats[0] ? `Kategori terbesar: ${cats.slice(0, 2).map((x) => `${x.c.label} (${x.n}, ${rp(x.v)})`).join('; ')}.` : 'Tidak ada masalah terbuka.',
        done.length ? `${done.length} masalah selesai, ${pct(dealDone, done.length)}% berakhir deal${solveDays != null ? `; median penyelesaian ${Math.round(solveDays)} hari` : ''}.` : 'Belum ada masalah yang diselesaikan.',
      ];
      const aksi: string[] = [];
      if (overdue.length) aksi.push(`Tindak ${overdue.length} masalah yang lewat target — eskalasi ke PJ dan BM.`);
      if (cats[0]) aksi.push(`Akar masalah utama "${cats[0].c.label}" — bahas solusi sistemik di rapat cabang, bukan kasus per kasus.`);
      slides.push({
        section: 'Aktivitas & Operasional',
        title: open.length ? `${open.length} masalah terbuka menahan pipeline ${rp(openVal)}` : 'Masalah pipeline terkendali',
        kicker: 'Masalah terbuka per kategori (nilai prospek tertahan, Rp juta)',
        charts: [{ kind: 'barH', title: 'Nilai tertahan per kategori (Rp juta)', labels: cats.map((x) => x.c.label).reverse(), series: [{ name: 'Nilai', values: cats.map((x) => jt(x.v)).reverse() }], unit: 'rpjt', colors: ['B94A3D'] }],
        temuan,
        aksi,
      });
    }
  }

  // ============================================================ 13. Perjalanan dinas
  if (inp.can('trip') && inp.trips && inp.trips.length) {
    const trips = inp.trips.filter((t) => monthSet.has(t.tglBerangkat.slice(0, 7)) || trend.slice(-3).includes(t.tglBerangkat.slice(0, 7)));
    if (trips.length) {
      const visits = trips.filter((t) => t.status === 'disetujui' || t.status === 'selesai').flatMap((t) => t.visits || []);
      const hasil = ['tercapai', 'sebagian', 'tidak', 'batal'].map((k) => visits.filter((v) => v.hasil === k).length);
      const noReal = visits.filter((v) => !v.hasil).length;
      const byStatus = ['draft', 'diajukan', 'disetujui', 'ditolak', 'selesai', 'batal'].map((s) => trips.filter((t) => t.status === s).length);
      const realized = sum(hasil.slice(0, 3));
      const temuan = [
        `${trips.length} perjalanan dinas (3 bulan terakhir), ${visits.length} kunjungan customer direncanakan.`,
        realized ? `Kunjungan terealisasi ${realized}: ${pct(hasil[0], realized)}% tujuan tercapai, ${pct(hasil[1], realized)}% sebagian.` : 'Belum ada realisasi kunjungan.',
      ];
      if (noReal) temuan.push(`${noReal} kunjungan pada perjalanan disetujui belum diisi realisasinya.`);
      if (byStatus[1]) temuan.push(`${byStatus[1]} rencana perjalanan masih menunggu persetujuan.`);
      const aksi: string[] = [];
      if (noReal) aksi.push('Lengkapi realisasi kunjungan agar tercatat di Aktivitas Harian dan laporan reimbursement final.');
      if (realized && pct(hasil[0], realized) < 50) aksi.push('Tingkat tercapai < 50% — perjelas tujuan kunjungan dan PIC sebelum berangkat.');
      slides.push({
        section: 'Aktivitas & Operasional',
        title: realized ? `${pct(hasil[0], realized)}% kunjungan perjalanan dinas mencapai tujuannya` : `${trips.length} perjalanan dinas dalam 3 bulan terakhir`,
        kicker: 'Hasil kunjungan perjalanan dinas yang disetujui/selesai (3 bulan terakhir)',
        charts: [
          { kind: 'doughnut', title: 'Hasil kunjungan', labels: ['Tercapai', 'Sebagian', 'Tidak tercapai', 'Batal dikunjungi'], series: [{ name: 'Kunjungan', values: hasil }], unit: 'count', colors: ['2F8F5B', 'C47F2C', 'B94A3D', 'C9D3DD'] },
          { kind: 'bar', title: 'Status perjalanan', labels: ['Draft', 'Diajukan', 'Disetujui', 'Ditolak', 'Selesai', 'Batal'], series: [{ name: 'Perjalanan', values: byStatus }], unit: 'count', colors: ['2E5C7E'] },
        ],
        temuan,
        aksi,
      });
    }
  }

  // ============================================================ 14. GIT & faktur
  if (!isSe || inp.can('faktur')) {
    const git = prospects.filter((r) => num(r.status) === 5 && !r.terfaktur).map((r) => ({ r, d: daysSince((r.tglDelivery || r.tglPO || String(r.statusChangedAt).slice(0, 10)) as string) })).filter((x) => Number.isFinite(x.d));
    if (git.length) {
      const B = [
        { l: '0–30 hari', f: (d: number) => d <= 30 },
        { l: '31–60 hari', f: (d: number) => d > 30 && d <= 60 },
        { l: '61–90 hari', f: (d: number) => d > 60 && d <= 90 },
        { l: '> 90 hari', f: (d: number) => d > 90 },
      ];
      const vals = B.map((b) => sum(git.filter((x) => b.f(x.d)).map((x) => num(x.r.value))));
      const tot = sum(vals);
      const over30 = tot - vals[0];
      const six = lastMonths(a.periodeTo, 6);
      const omzet = six.map((m) => sum(prospects.filter((r) => num(r.status) === 5 && r.terfaktur && (r.tglFaktur || r.tglDelivery || '').startsWith(m)).map((r) => num(r.value))));
      const temuan = [
        `GIT (DO belum terfaktur) ${rp(tot)} dari ${git.length} DO; ${rp(over30)} (${pct(over30, tot)}%) berumur > 30 hari.`,
        `Omzet terfaktur 6 bulan: ${rp(sum(omzet))}; bulan tertinggi ${mLabel(six[omzet.indexOf(Math.max(...omzet))])}.`,
      ];
      const aksi: string[] = [];
      if (over30 > 0) aksi.push(`Percepat faktur ${git.filter((x) => x.d > 30).length} DO berumur >30 hari (${rp(over30)}) melalui Antrian Admin.`);
      slides.push({
        section: 'Aktivitas & Operasional',
        title: over30 > 0 ? `${rp(over30)} sudah dikirim tapi belum difaktur lebih dari 30 hari` : `GIT ${rp(tot)}, seluruhnya di bawah 30 hari`,
        kicker: 'Umur GIT (Rp juta) dan omzet terfaktur per bulan',
        charts: [
          { kind: 'bar', title: 'Umur GIT (Rp juta)', labels: B.map((b) => b.l), series: [{ name: 'GIT', values: vals.map(jt) }], unit: 'rpjt', colors: ['2F8F5B', 'C47F2C', 'D9822B', 'B94A3D'] },
          { kind: 'line', title: 'Omzet terfaktur per bulan (Rp juta)', labels: six.map(mLabel), series: [{ name: 'Omzet', values: omzet.map(jt) }], unit: 'rpjt', colors: ['2E5C7E'] },
        ],
        temuan,
        aksi,
      });
    }
  }

  // ============================================================ 15. Kualitas data
  if (a.dataIssues.length) {
    const tot = sum(a.dataIssues.map((d) => d.count));
    slides.push({
      section: 'Penutup',
      title: `${tot} catatan data perlu dirapikan agar analisa akurat`,
      kicker: 'Data yang membuat angka di atas bisa meleset',
      charts: [],
      table: { head: ['Masalah', 'Jumlah', 'Dampak', 'Contoh'], rows: a.dataIssues.map((d) => [d.label, String(d.count), d.hint, d.examples.slice(0, 2).join('; ')]), widths: [24, 9, 33, 34], right: [1] },
      temuan: [],
      aksi: a.dataIssues.slice(0, 2).map((d) => `Rapikan "${d.label}" (${d.count} data).`),
    });
  }

  // ---------------------------------------------------------------- ringkasan
  const tone = (v: number, good: number, warn: number): KpiTile['tone'] => (v >= good ? 'good' : v >= warn ? 'warn' : 'bad');
  const kpis: KpiTile[] = [
    { label: isSe ? 'Realisasi Anda' : 'Realisasi', value: rp(a.won), foot: `${a.wonCount} deal${a.momPct != null ? ` · ${a.momPct >= 0 ? '▲' : '▼'} ${Math.abs(a.momPct)}% vs ${a.compareLabel}` : ''}`, tone: a.momPct == null ? 'neutral' : a.momPct >= 0 ? 'good' : 'bad' },
    { label: isSe ? 'Kontribusi ke target cabang' : 'Achievement', value: a.target > 0 ? `${a.achievement}%` : '-', foot: a.target > 0 ? `${isSe ? 'Target cabang' : 'Target'} ${rp(a.target)}` : 'Target belum diisi', tone: a.target > 0 ? tone(a.achievement, 100, 80) : 'neutral' },
    { label: 'Pipeline berbobot', value: rp(a.weighted), foot: a.coverage != null ? `Coverage gap ${Math.round(a.coverage * 100)}%` : 'Gap tertutup', tone: a.coverage == null ? 'good' : tone(a.coverage * 100, 100, 60) },
    { label: 'Win rate', value: a.winRate != null ? `${a.winRate}%` : '-', foot: `${a.wonCount} menang · ${a.lostCount} kalah`, tone: a.winRate == null ? 'neutral' : tone(a.winRate, 50, 30) },
    { label: 'Deal mangkrak', value: n0(a.aging.length), foot: rp(a.agingValue), tone: a.aging.length ? 'warn' : 'good' },
    { label: 'GIT > 30 hari', value: n0(a.gitOld.length), foot: rp(sum(a.gitOld.map((g) => g.value))), tone: a.gitOld.length ? 'warn' : 'good' },
  ];
  const actions = slides.flatMap((s) => s.aksi.map((t) => ({ text: t, section: s.section })));
  const headline =
    a.target > 0
      ? `${isSe ? 'Kontribusi Anda' : `Realisasi ${scope.label}`} ${a.achievement}% dari target ${a.periodLabel}${a.coverage != null ? (a.coverage >= 1 ? ' — pipeline cukup untuk menutup gap' : ' — pipeline belum cukup menutup gap') : ' — target tercapai'}`
      : `Realisasi ${rp(a.won)} pada ${a.periodLabel}`;
  const keyMessages = slides.filter((s) => s.section !== 'Penutup').slice(0, 5).map((s) => s.title);

  return {
    scopeLabel: scope.label,
    periodLabel: periodeLabel(a.periode, a.periodeTo),
    generatedFor: inp.user.name,
    generatedAt: today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    roleLabel: inp.roleLabel,
    headline,
    kpis,
    keyMessages,
    agenda: Array.from(new Set(slides.map((s) => s.section))),
    slides,
    actions,
  };
}
