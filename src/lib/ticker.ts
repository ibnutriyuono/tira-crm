import { CABANG_LIST } from './constants';
import { classify, getProspectMaterials, normalizeLine, num } from './format';
import { QCD_FAKTOR_LABEL } from './qcd';
import { buildForecast, customerKey } from './reports';
import type { BudgetTarget, Prospect } from './types';

/**
 * Running text. GM/Admin choose which items appear (checklist); the
 * company-wide items are computed on the server so everyone sees the same
 * headline, the personal reminders are computed in each user's browser from
 * their own (role-scoped) data.
 */

export type TickerItemKey =
  | 'topPo'
  | 'topCabang'
  | 'latestPo'
  | 'achievement'
  | 'cabangTembus'
  | 'newToday'
  | 'topSeDeals'
  | 'topKompetitor'
  | 'topLine'
  | 'kursUsd'
  | 'kursEur'
  | 'myFollowUp'
  | 'myQcd'
  | 'myGit'
  | 'myPlan'
  | 'custom';

export interface TickerItemDef {
  key: TickerItemKey;
  label: string;
  hint: string;
  group: 'Pencapaian & apresiasi' | 'Pasar' | 'Kurs' | 'Pengingat pribadi' | 'Pengumuman';
  default: boolean;
}

export const TICKER_ITEMS: TickerItemDef[] = [
  { key: 'topPo', group: 'Pencapaian & apresiasi', label: 'PO terbesar bulan ini', hint: 'Customer, nilai, SE & cabang', default: true },
  { key: 'topCabang', group: 'Pencapaian & apresiasi', label: 'Cabang dengan total PO terbesar', hint: 'Total & jumlah PO bulan ini', default: true },
  { key: 'latestPo', group: 'Pencapaian & apresiasi', label: 'PO terbaru', hint: 'PO paling baru (7 hari terakhir)', default: true },
  { key: 'achievement', group: 'Pencapaian & apresiasi', label: 'Pencapaian nasional vs target', hint: 'Dalam persen + sisa hari kerja', default: true },
  { key: 'cabangTembus', group: 'Pencapaian & apresiasi', label: 'Cabang tembus 100% target', hint: 'Daftar cabang yang sudah mencapai target', default: true },
  { key: 'newToday', group: 'Pencapaian & apresiasi', label: 'Prospek baru hari ini', hint: 'Jumlah prospek & SE yang input hari ini', default: true },
  { key: 'topSeDeals', group: 'Pencapaian & apresiasi', label: 'SE dengan deal terbanyak', hint: 'Jumlah PO terbanyak bulan ini', default: false },
  { key: 'topKompetitor', group: 'Pasar', label: 'Kompetitor paling sering mengalahkan', hint: 'Dari data QCD Lose bulan ini', default: false },
  { key: 'topLine', group: 'Pasar', label: 'Line produk paling laku', hint: 'Nilai PO terbesar per Line bulan ini', default: false },
  { key: 'kursUsd', group: 'Kurs', label: 'Kurs USD → IDR', hint: 'Kurs referensi harian', default: true },
  { key: 'kursEur', group: 'Kurs', label: 'Kurs EUR → IDR', hint: 'Kurs referensi harian', default: true },
  { key: 'myFollowUp', group: 'Pengingat pribadi', label: 'Follow-up jatuh tempo', hint: 'Per pengguna, sesuai datanya sendiri', default: true },
  { key: 'myQcd', group: 'Pengingat pribadi', label: 'QCD belum lengkap', hint: 'Deal ditutup bulan ini tanpa QCD lengkap', default: true },
  { key: 'myGit', group: 'Pengingat pribadi', label: 'DO belum terfaktur > 30 hari', hint: 'Agar penagihan dikejar', default: false },
  { key: 'myPlan', group: 'Pengingat pribadi', label: 'Rencana Penjualan belum diisi', hint: 'Untuk Sales, bulan berjalan', default: true },
  { key: 'custom', group: 'Pengumuman', label: 'Teks custom', hint: 'Pesan yang ditulis GM/Admin', default: true },
];

export interface TickerSettings {
  /** Kept for older stored values: custom messages on/off (mirrors items.custom). */
  enabled: boolean;
  messages: string[];
  items: Record<TickerItemKey, boolean>;
  /** Manual exchange rate (Rp per 1 unit); used instead of the online rate when filled. */
  kursManual: { usd: number | null; eur: number | null };
}
/** @deprecated name kept for existing imports. */
export type TickerCustom = TickerSettings;

export interface TickerKurs {
  usd: number | null;
  eur: number | null;
  date: string;
  source: string;
}

export interface TickerData {
  periode: string;
  today: string;
  topPo: { customer: string; value: number; se: string; cabang: string; noPo: string | null } | null;
  topCabang: { cabang: string; total: number; count: number } | null;
  latestPo: { customer: string; value: number; se: string; cabang: string; date: string } | null;
  achievement: { won: number; target: number; pct: number; daysLeft: number } | null;
  cabangTembus: { cabang: string; pct: number }[];
  newToday: { count: number; seCount: number };
  topSeDeals: { se: string; cabang: string; count: number; value: number } | null;
  topKompetitor: { name: string; count: number; faktor: string } | null;
  topLine: { line: string; value: number; count: number } | null;
  kurs: TickerKurs | null;
  custom: TickerSettings;
}

export const TICKER_SETTING_KEY = 'runningText';
export const TICKER_MAX_MESSAGES = 10;

const jakartaParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { y: get('year'), m: get('month'), d: get('day') };
};

/** YYYY-MM in Jakarta time -- the server runs in UTC, so on the 1st before 07:00 WIB UTC is still last month. */
export function jakartaPeriode(d = new Date()): string {
  const p = jakartaParts(d);
  return `${p.y}-${p.m}`;
}

/** YYYY-MM-DD in Jakarta time. */
export function jakartaToday(d = new Date()): string {
  const p = jakartaParts(d);
  return `${p.y}-${p.m}-${p.d}`;
}

/** Working days (Mon-Sat) from `today` through the end of its month, today included. */
export function workingDaysLeftInMonth(today: string): number {
  const [y, m, d] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let day = d; day <= last; day++) if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() !== 0) n++;
  return n;
}

type Row = Pick<
  Prospect,
  'status' | 'value' | 'customer' | 'se' | 'cabang' | 'reg' | 'noPo' | 'tglPO' | 'tglDelivery' | 'tglPenawaran' | 'createdAt' | 'updatedAt' | 'statusChangedAt' | 'qcdKompetitor' | 'qcdFaktor' | 'materials' | 'line' | 'uraian' | 'qty' | 'terfaktur'
>;

const wonDate = (r: Pick<Prospect, 'tglPO' | 'tglDelivery' | 'tglPenawaran'>) => r.tglPO || r.tglDelivery || r.tglPenawaran || '';

/**
 * The month's POs: prospects at PO/Kontrak (4) or DO (5) dated in `periode`
 * by Tgl PO (falling back to delivery, then offer date -- same rule as the
 * forecast/analysis screens, so the ticker agrees with them).
 */
export function buildTickerHighlights(prospects: Pick<Prospect, 'status' | 'value' | 'customer' | 'se' | 'cabang' | 'noPo' | 'tglPO' | 'tglDelivery' | 'tglPenawaran'>[], periode: string) {
  const pos = prospects.filter((r) => {
    const st = num(r.status);
    return (st === 4 || st === 5) && wonDate(r).slice(0, 7) === periode && num(r.value) > 0;
  });
  let topPo: TickerData['topPo'] = null;
  for (const r of pos) {
    if (!topPo || num(r.value) > topPo.value) {
      topPo = { customer: r.customer, value: num(r.value), se: (r.se || '-').toUpperCase(), cabang: (r.cabang || '-').toUpperCase(), noPo: r.noPo || null };
    }
  }
  const byCabang = new Map<string, { total: number; count: number }>();
  pos.forEach((r) => {
    const c = (r.cabang || '').trim().toUpperCase();
    if (!c) return;
    const e = byCabang.get(c) || { total: 0, count: 0 };
    e.total += num(r.value);
    e.count++;
    byCabang.set(c, e);
  });
  let topCabang: TickerData['topCabang'] = null;
  byCabang.forEach((v, cabang) => {
    if (!topCabang || v.total > topCabang.total) topCabang = { cabang, ...v };
  });
  return { topPo, topCabang };
}

/** Everything company-wide besides topPo/topCabang. */
export function buildTickerExtras(rows: Row[], targets: BudgetTarget[], periode: string, today: string) {
  const isPo = (r: Row) => num(r.status) === 4 || num(r.status) === 5;
  const pos = rows.filter((r) => isPo(r) && wonDate(r).slice(0, 7) === periode && num(r.value) > 0);

  // Latest PO within the last 7 days.
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400e3).toISOString().slice(0, 10);
  const recent = rows
    .filter((r) => isPo(r) && num(r.value) > 0 && (r.tglPO || '') >= weekAgo && (r.tglPO || '') <= today)
    .sort((a, b) => (b.tglPO || '').localeCompare(a.tglPO || '') || String(b.statusChangedAt || '').localeCompare(String(a.statusChangedAt || '')));
  const lp = recent[0];
  const latestPo = lp ? { customer: lp.customer, value: num(lp.value), se: (lp.se || '-').toUpperCase(), cabang: (lp.cabang || '-').toUpperCase(), date: lp.tglPO || '' } : null;

  // Target vs realisasi (same rule as the Forecast tab: carried-forward targets).
  const fc = buildForecast(rows as Prospect[], targets, periode, CABANG_LIST);
  const won = fc.reduce((s, r) => s + r.won, 0);
  const target = fc.reduce((s, r) => s + r.target, 0);
  const achievement = target > 0 ? { won, target, pct: Math.round((won / target) * 100), daysLeft: workingDaysLeftInMonth(today) } : null;
  const cabangTembus = fc.filter((r) => r.target > 0 && r.won >= r.target).map((r) => ({ cabang: r.cabang, pct: r.achievement })).sort((a, b) => b.pct - a.pct);

  // New prospects today (Jakarta date of createdAt).
  const created = rows.filter((r) => r.createdAt && jakartaToday(new Date(r.createdAt)) === today);
  const newToday = { count: created.length, seCount: new Set(created.map((r) => (r.se || '').toUpperCase()).filter(Boolean)).size };

  // SE with the most POs this month.
  const bySe = new Map<string, { se: string; cabang: string; count: number; value: number }>();
  pos.forEach((r) => {
    const se = (r.se || '').trim().toUpperCase();
    if (!se) return;
    const e = bySe.get(se) || { se, cabang: (r.cabang || '-').toUpperCase(), count: 0, value: 0 };
    e.count++;
    e.value += num(r.value);
    bySe.set(se, e);
  });
  const topSeDeals = Array.from(bySe.values()).sort((a, b) => b.count - a.count || b.value - a.value)[0] || null;

  // Competitor that beat us most often this month (Lose, dated by status change).
  const lost = rows.filter((r) => classify(r) === 'Lost' && String(r.statusChangedAt || '').slice(0, 7) === periode);
  const comp = new Map<string, { name: string; count: number; faktor: Map<string, number> }>();
  lost.forEach((r) => {
    const n = (r.qcdKompetitor || '').trim();
    if (!n) return;
    const k = customerKey(n);
    const e = comp.get(k) || { name: n, count: 0, faktor: new Map() };
    e.count++;
    if (r.qcdFaktor) e.faktor.set(r.qcdFaktor, (e.faktor.get(r.qcdFaktor) || 0) + 1);
    comp.set(k, e);
  });
  const tk = Array.from(comp.values()).sort((a, b) => b.count - a.count)[0];
  const topF = tk ? Array.from(tk.faktor.entries()).sort((a, b) => b[1] - a[1])[0] : undefined;
  const topKompetitor = tk ? { name: tk.name, count: tk.count, faktor: topF ? QCD_FAKTOR_LABEL[topF[0]] || '' : '' } : null;

  // Best-selling product line this month (by material value).
  const byLine = new Map<string, { line: string; value: number; count: number }>();
  pos.forEach((r) => {
    getProspectMaterials(r as Prospect).forEach((m) => {
      const line = normalizeLine(m.line);
      if (!line) return;
      const unit = num(m.beratPc) > 0 && num(m.hargaKg) > 0 ? num(m.beratPc) * num(m.hargaKg) : num(m.harga);
      const e = byLine.get(line) || { line, value: 0, count: 0 };
      e.value += num(m.qty) * unit;
      e.count++;
      byLine.set(line, e);
    });
  });
  const topLine = Array.from(byLine.values()).sort((a, b) => b.value - a.value)[0] || null;

  return { latestPo, achievement, cabangTembus, newToday, topSeDeals, topKompetitor, topLine };
}

const posNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Stored setting -> full settings with defaults (older values only had enabled/messages). */
export function normalizeTickerCustom(raw: unknown): TickerSettings {
  const r = (raw ?? {}) as { enabled?: unknown; messages?: unknown; items?: unknown; kursManual?: unknown };
  const list = Array.isArray(r.messages) ? r.messages : [];
  const storedItems = (r.items && typeof r.items === 'object' ? r.items : {}) as Record<string, unknown>;
  const items = {} as Record<TickerItemKey, boolean>;
  TICKER_ITEMS.forEach((it) => {
    items[it.key] = typeof storedItems[it.key] === 'boolean' ? (storedItems[it.key] as boolean) : it.default;
  });
  // Older settings: "enabled" was the custom-text switch.
  if (typeof storedItems.custom !== 'boolean' && r.enabled === false) items.custom = false;
  const km = (r.kursManual ?? {}) as { usd?: unknown; eur?: unknown };
  return {
    enabled: items.custom,
    messages: list.map((m) => String(m ?? '').trim().slice(0, 300)).filter(Boolean).slice(0, TICKER_MAX_MESSAGES),
    items,
    kursManual: { usd: posNum(km.usd), eur: posNum(km.eur) },
  };
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const bulanLabel = (periode: string) => `${BULAN[Number(periode.slice(5, 7)) - 1] || ''} ${periode.slice(0, 4)}`.trim();
const tglPendek = (d: string) => (d ? `${Number(d.slice(8, 10))} ${BLN[Number(d.slice(5, 7)) - 1] || ''} ${d.slice(0, 4)}` : '');
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export interface TickerPersonalInput {
  followUp: number;
  qcdMissing: number;
  gitOld: { count: number; value: number };
  planMissing: boolean;
}

/** The running-text messages, in display order, for the items switched on. */
export function buildTickerLines(data: TickerData, personal: TickerPersonalInput | null): string[] {
  const on = data.custom.items;
  const bln = bulanLabel(data.periode);
  const out: string[] = [];
  if (on.topPo) {
    if (data.topPo) out.push(`🏆 PO terbesar ${bln}: ${data.topPo.customer} — ${rp(data.topPo.value)} · SE ${data.topPo.se} (cabang ${data.topPo.cabang}). Selamat!`);
    else out.push(`Belum ada PO tercatat di ${bln} — ayo jadi yang pertama!`);
  }
  if (on.topCabang && data.topCabang) out.push(`🏢 Cabang dengan total PO terbesar ${bln}: ${data.topCabang.cabang} — ${rp(data.topCabang.total)} dari ${data.topCabang.count} PO`);
  if (on.latestPo && data.latestPo) out.push(`🆕 PO terbaru (${tglPendek(data.latestPo.date)}): ${data.latestPo.customer} — ${rp(data.latestPo.value)} · SE ${data.latestPo.se} (${data.latestPo.cabang})`);
  if (on.achievement && data.achievement) {
    out.push(`🎯 Pencapaian nasional ${bln}: ${data.achievement.pct}% dari target · sisa ${data.achievement.daysLeft} hari kerja`);
  }
  if (on.cabangTembus && data.cabangTembus.length) out.push(`🚀 Tembus target ${bln}: ${data.cabangTembus.map((c) => `${c.cabang} ${c.pct}%`).join(', ')}. Luar biasa!`);
  if (on.newToday && data.newToday.count > 0) out.push(`✍️ Hari ini: ${data.newToday.count} prospek baru dari ${data.newToday.seCount} SE`);
  if (on.topSeDeals && data.topSeDeals) out.push(`⭐ SE dengan deal terbanyak ${bln}: ${data.topSeDeals.se} (${data.topSeDeals.cabang}) — ${data.topSeDeals.count} PO`);
  if (on.topKompetitor && data.topKompetitor) {
    out.push(`⚔️ Kompetitor paling sering mengalahkan kita ${bln}: ${data.topKompetitor.name} (${data.topKompetitor.count} deal${data.topKompetitor.faktor ? `, faktor utama: ${data.topKompetitor.faktor}` : ''})`);
  }
  if (on.topLine && data.topLine) out.push(`📦 Line terlaris ${bln}: Line ${data.topLine.line} — ${rp(data.topLine.value)}`);
  const k = data.kurs;
  const kursParts = [on.kursUsd && k?.usd ? `USD 1 = ${rp(k.usd)}` : '', on.kursEur && k?.eur ? `EUR 1 = ${rp(k.eur)}` : ''].filter(Boolean);
  if (k && kursParts.length) {
    const meta = [k.source === 'internal' ? 'kurs internal' : k.source.startsWith('internal') ? 'kurs internal/referensi' : `referensi ${k.source}`, tglPendek(k.date)].filter(Boolean).join(', ');
    out.push(`💱 Kurs (${meta}): ${kursParts.join(' · ')}`);
  }
  if (personal) {
    if (on.myFollowUp && personal.followUp > 0) out.push(`📅 Anda punya ${personal.followUp} follow-up yang perlu segera ditindaklanjuti`);
    if (on.myQcd && personal.qcdMissing > 0) out.push(`📝 ${personal.qcdMissing} deal yang ditutup bulan ini belum lengkap QCD-nya`);
    if (on.myGit && personal.gitOld.count > 0) out.push(`🧾 ${personal.gitOld.count} DO belum terfaktur lebih dari 30 hari (${rp(personal.gitOld.value)}) — percepat penagihan`);
    if (on.myPlan && personal.planMissing) out.push(`🗓️ Rencana Penjualan ${bln} Anda belum diisi`);
  }
  if (on.custom) data.custom.messages.forEach((m) => out.push(`📣 ${m}`));
  return out;
}
