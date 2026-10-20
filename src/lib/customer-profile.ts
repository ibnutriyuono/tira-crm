/**
 * Profil customer — dihitung di klien dari data yang sudah dimuat (prospek,
 * Aktivitas Harian, masalah pipeline, Key Account) ditambah field profil yang
 * diisi Sales di Kelola Customer (segmen, aplikasi, potensi, kompetitor,
 * peran PIC). Tidak ada tabel baru selain kolom profil di Customer.
 *
 * Isi: status (Andalan/Tumbuh/…), skor kesehatan 0–100 beserta alasannya,
 * siklus order, profil pembelian & tender, pembanding antar customer
 * sejenis, dan perbandingan antar SE yang pernah menangani customer.
 */
import { ACTIVITY_TYPES } from './constants';
import { liveLabels } from './i18n';
import { classify, materialsWithValue, normalizeLine, num } from './format';
import { isOpenIssue, type PipelineIssue } from './issues';
import { QCD_FAKTOR_LABEL } from './qcd';
import { customerKey } from './reports';
import { isStaffActivityKey } from './sales-activity';
import type { Customer, CustomerGroup, CustomerPic, Prospect, SalesActivity } from './types';

export type CustStatus = 'andalan' | 'tumbuh' | 'stabil' | 'jarang' | 'tidur' | 'hilang' | 'baru';

export const CUST_STATUS_META: Record<CustStatus, { label: string; color: string; hint: string }> = {
  andalan: { label: 'Andalan', color: 'green', hint: 'Order rutin (≥4× dalam 12 bulan) dan tidak turun tajam' },
  tumbuh: { label: 'Tumbuh', color: 'steel', hint: 'Omzet 12 bulan naik ≥20% dibanding 12 bulan sebelumnya' },
  stabil: { label: 'Stabil', color: 'slate', hint: 'Masih order sesuai siklusnya' },
  jarang: { label: 'Mulai jarang', color: 'amber', hint: 'Sudah melewati siklus order biasanya' },
  tidur: { label: 'Tidur', color: 'rust', hint: 'Jauh melewati siklus order (≥2× siklus)' },
  hilang: { label: 'Hilang', color: 'rust', hint: 'Tidak order lebih dari 12 bulan' },
  baru: { label: 'Belum order', color: 'slate', hint: 'Belum pernah PO — masih prospek' },
};
Object.values(CUST_STATUS_META).forEach((m) => liveLabels(m, ['label', 'hint']));
export const CUST_STATUS_ORDER: CustStatus[] = ['andalan', 'tumbuh', 'stabil', 'jarang', 'tidur', 'hilang', 'baru'];

/** "Rp 3,25 M" / "Rp 820 jt" / "Rp 950 rb". */
export function rpShort(n: number): string {
  const v = num(n);
  const a = Math.abs(v);
  if (a >= 1e9) return `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `Rp ${Math.round(v / 1e3).toLocaleString('id-ID')} rb`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const CUSTOMER_TIPE = new Set<string>(ACTIVITY_TYPES.map((t) => t.key));

export const wonDate = (r: Prospect) => (r.tglPO || r.tglDelivery || r.tglPenawaran || String(r.createdAt || '').slice(0, 10)) || '';
const lostDate = (r: Prospect) => String(r.statusChangedAt || r.updatedAt || '').slice(0, 10);
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000);
const diffDays = (from: string, to: string) => dayNum(to) - dayNum(from);
const ymOf = (iso: string) => iso.slice(0, 7);
const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
export const ymLabel = (ym: string, withYear = false) => {
  const [y, m] = ym.split('-');
  return `${BULAN[Number(m) - 1] || m}${withYear ? ` ${y}` : ''}`;
};
function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/** Label produk untuk profil pembelian: grade + Line, Line 05 = Fabrikasi. */
export function productLabel(m: { line?: string; uraian?: string; grade?: unknown }): string {
  const line = normalizeLine(m.line).split(/\s*,\s*/)[0] || '';
  if (line === '05') return 'Fabrikasi (Line 05)';
  const grade = String(m.grade ?? '').trim().toUpperCase();
  const base = grade || String(m.uraian || '').trim().toUpperCase().split(/\s+/).slice(0, 2).join(' ').slice(0, 24) || '-';
  return line ? `${base} · Line ${line}` : base;
}

export interface ProductRow {
  label: string;
  nilai: number;
  orders: number;
  firstDate: string;
  lastDate: string;
}

export interface Reason {
  v: number;
  t: string;
}

export interface CustomerFacts {
  key: string;
  name: string;
  cabang: string;
  segmen: string | null;
  customer: Customer | null;
  group: CustomerGroup | null;
  records: Prospect[];
  /** Kontak customer yang sudah dilakukan (tanpa rencana & pekerjaan internal), terbaru dulu. */
  acts: SalesActivity[];
  /** SE dengan aktivitas/prospek terbanyak 6 bulan terakhir. */
  se: string;
  wonAll: Prospect[];
  omzet12: number;
  omzetPrev12: number;
  /** % perubahan omzet 12 bln vs 12 bln sebelumnya; null bila tidak ada pembanding. */
  yoy: number | null;
  orders12: number;
  avgOrder12: number;
  lastOrder: string | null;
  daysSinceOrder: number | null;
  /** Median jeda antar-order (hari); null bila order < 3. */
  cycleDays: number | null;
  nextOrderDate: string | null;
  wins12: number;
  losses12: number;
  winRate12: number | null;
  /** Median hari dari penawaran ke PO. */
  decideDays: number | null;
  lastContact: SalesActivity | null;
  daysSinceContact: number | null;
  contacts90: number;
  visits90: number;
  mangkrak: { r: Prospect; days: number }[];
  aktif: Prospect[];
  openIssues: PipelineIssue[];
  gitOld: Prospect[];
  gitOldValue: number;
  products: ProductRow[];
  months12: { ym: string; nilai: number; orders: number }[];
  status: CustStatus;
  score: number;
  reasons: Reason[];
  potensi: number | null;
  /** omzet12 / potensi (0–100+), null bila potensi belum diisi. */
  share: number | null;
}

function dominantSe(records: Prospect[], acts: SalesActivity[], since: string): string {
  const w = new Map<string, number>();
  const add = (se: string | null | undefined, n: number) => {
    const s = (se || '').trim().toUpperCase();
    if (!s || isStaffActivityKey(s)) return;
    w.set(s, (w.get(s) || 0) + n);
  };
  acts.forEach((a) => { if (a.tanggal >= since) add(a.se, 1); });
  records.forEach((r) => { if (String(r.createdAt).slice(0, 10) >= since || wonDate(r) >= since) add(r.se, 2); });
  if (w.size === 0) {
    records.forEach((r) => add(r.se, 1));
    acts.forEach((a) => add(a.se, 1));
  }
  return [...w.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

/** Fakta satu customer. `records`/`acts` sudah difilter ke customer ini. */
export function buildFacts(opts: {
  name: string;
  records: Prospect[];
  acts: SalesActivity[];
  customer: Customer | null;
  group: CustomerGroup | null;
  issues: PipelineIssue[];
  today: string;
}): CustomerFacts {
  const { name, records, customer, group, issues, today } = opts;
  const acts = opts.acts
    .filter((a) => a.status !== 'rencana' && CUSTOMER_TIPE.has(a.tipe) && a.tanggal <= today)
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  const d365 = addDays(today, -365);
  const d730 = addDays(today, -730);
  const d90 = addDays(today, -90);

  const wonAll = records.filter((r) => classify(r) === 'Won' && wonDate(r)).sort((a, b) => wonDate(a).localeCompare(wonDate(b)));
  const won12 = wonAll.filter((r) => wonDate(r) > d365 && wonDate(r) <= today);
  const wonPrev = wonAll.filter((r) => wonDate(r) > d730 && wonDate(r) <= d365);
  const omzet12 = won12.reduce((s, r) => s + num(r.value), 0);
  const omzetPrev12 = wonPrev.reduce((s, r) => s + num(r.value), 0);
  const yoy = omzetPrev12 > 0 ? ((omzet12 - omzetPrev12) / omzetPrev12) * 100 : null;
  const lastOrder = wonAll.length ? wonDate(wonAll[wonAll.length - 1]) : null;
  const daysSinceOrder = lastOrder ? Math.max(0, diffDays(lastOrder, today)) : null;

  const orderDays = Array.from(new Set(wonAll.map(wonDate)));
  const gaps: number[] = [];
  for (let i = 1; i < orderDays.length; i++) gaps.push(diffDays(orderDays[i - 1], orderDays[i]));
  const gapMed = orderDays.length >= 3 ? median(gaps.filter((g) => g > 0)) : null;
  const cycleDays = gapMed != null ? Math.min(365, Math.max(14, Math.round(gapMed))) : null;
  const nextOrderDate = cycleDays && lastOrder ? addDays(lastOrder, cycleDays) : null;

  const lost12 = records.filter((r) => classify(r) === 'Lost' && lostDate(r) > d365);
  const wins12 = won12.length;
  const losses12 = lost12.length;
  const winRate12 = wins12 + losses12 > 0 ? Math.round((wins12 / (wins12 + losses12)) * 100) : null;
  const decideDays = median(
    wonAll.filter((r) => r.tglPenawaran && r.tglPO).map((r) => diffDays(r.tglPenawaran as string, r.tglPO as string)).filter((d) => d >= 0),
  );

  const lastContact = acts[0] || null;
  const daysSinceContact = lastContact ? Math.max(0, diffDays(lastContact.tanggal, today)) : null;
  const contacts90 = acts.filter((a) => a.tanggal > d90).length;
  const visits90 = acts.filter((a) => a.tanggal > d90 && a.tipe === 'kunjungan').length;

  const aktif = records.filter((r) => classify(r) === 'Aktif');
  const mangkrak = aktif
    .map((r) => ({ r, days: Math.max(0, diffDays(String(r.statusChangedAt || r.updatedAt).slice(0, 10), today)) }))
    .filter((x) => x.days > 30)
    .sort((a, b) => b.days - a.days);
  const ids = new Set(records.map((r) => r.id));
  const k = customerKey(name);
  const openIssues = issues.filter((i) => isOpenIssue(i) && (ids.has(i.prospectId) || customerKey(i.customer) === k));
  const gitOld = records.filter((r) => num(r.status) === 5 && !r.terfaktur && r.tglDelivery && diffDays(r.tglDelivery, today) > 30);
  const gitOldValue = gitOld.reduce((s, r) => s + num(r.value), 0);

  const prod = new Map<string, ProductRow>();
  wonAll.forEach((r) => {
    const dt = wonDate(r);
    const seen = new Set<string>();
    materialsWithValue(r).forEach((m) => {
      const label = productLabel(m as { line: string; uraian: string; grade?: unknown });
      const e = prod.get(label) || { label, nilai: 0, orders: 0, firstDate: dt, lastDate: dt };
      e.nilai += m.nilai;
      if (!seen.has(label)) e.orders += 1;
      seen.add(label);
      if (dt < e.firstDate) e.firstDate = dt;
      if (dt > e.lastDate) e.lastDate = dt;
      prod.set(label, e);
    });
  });
  const products = [...prod.values()].sort((a, b) => b.nilai - a.nilai);

  const months12 = lastMonths(today, 12).map((ym) => {
    const l = wonAll.filter((r) => ymOf(wonDate(r)) === ym);
    return { ym, nilai: l.reduce((s, r) => s + num(r.value), 0), orders: l.length };
  });

  const segmen = (customer?.segmen || group?.segmen || '').trim() || null;
  const potensi = customer?.potensi && customer.potensi > 0 ? customer.potensi : null;
  const share = potensi ? Math.round((omzet12 / potensi) * 100) : null;

  // ---- status
  let status: CustStatus;
  if (!lastOrder) status = 'baru';
  else {
    const d = daysSinceOrder ?? 0;
    const limit = cycleDays ?? 60;
    if (d > 365) status = 'hilang';
    else if (d > Math.max(limit * 2, 120)) status = 'tidur';
    else if (d > Math.max(limit * 1.3, 45)) status = 'jarang';
    else if (won12.length >= 4 && (yoy == null || yoy > -20)) status = 'andalan';
    else if (yoy != null && yoy >= 20 && omzet12 > 0) status = 'tumbuh';
    else status = 'stabil';
  }

  // ---- skor kesehatan
  const reasons: Reason[] = [];
  const push = (v: number, t: string) => { if (v) reasons.push({ v, t }); };
  const cyc = cycleDays ? ` (biasanya tiap ±${cycleDays} hari)` : '';
  if (status === 'andalan' || status === 'tumbuh' || status === 'stabil') push(15, `Order terakhir ${daysSinceOrder} hari lalu — masih sesuai siklus${cyc}`);
  else if (status === 'jarang') push(-10, `Belum order ${daysSinceOrder} hari${cyc}`);
  else if (status === 'tidur') push(-20, `Belum order ${daysSinceOrder} hari${cyc}`);
  else if (status === 'hilang') push(-30, `Tidak order lebih dari 12 bulan (${daysSinceOrder} hari)`);
  if (won12.length >= 6) push(10, `Order ${won12.length}× dalam 12 bulan`);
  else if (won12.length >= 3) push(5, `Order ${won12.length}× dalam 12 bulan`);
  else if (lastOrder && won12.length === 0) push(-5, 'Tidak ada order dalam 12 bulan');
  if (yoy != null && yoy >= 15) push(10, `Omzet 12 bulan naik ${Math.round(yoy)}% YoY`);
  else if (yoy != null && yoy <= -15) push(-10, `Omzet 12 bulan turun ${Math.abs(Math.round(yoy))}% YoY`);
  if (daysSinceContact == null) push(-10, 'Belum ada kontak tercatat di Aktivitas Harian');
  else if (daysSinceContact <= 14) push(10, daysSinceContact === 0 ? 'Dihubungi hari ini' : `Dihubungi ${daysSinceContact} hari lalu`);
  else if (daysSinceContact <= 30) push(5, `Dihubungi ${daysSinceContact} hari lalu`);
  else if (daysSinceContact > 60) push(-10, `Tidak ada kontak ${daysSinceContact} hari`);
  if (mangkrak.length) push(-Math.min(15, mangkrak.length * 5), `${mangkrak.length} deal tidak bergerak > 30 hari (${rpShort(mangkrak.reduce((s, x) => s + num(x.r.value), 0))})`);
  if (openIssues.length) push(-Math.min(10, openIssues.length * 5), `${openIssues.length} masalah pipeline masih terbuka`);
  if (gitOld.length) push(-5, `GIT ${rpShort(gitOldValue)} berumur > 30 hari belum terfaktur`);
  if (winRate12 != null && wins12 + losses12 >= 3) {
    if (winRate12 >= 60) push(5, `Win rate 12 bulan ${winRate12}%`);
    else if (winRate12 < 40) push(-5, `Win rate 12 bulan hanya ${winRate12}%`);
  }
  const score = Math.max(0, Math.min(100, 50 + reasons.reduce((s, r) => s + r.v, 0)));
  reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));

  const cabang = customer?.cabang || records.find((r) => r.cabang)?.cabang || '';
  return {
    key: k,
    name,
    cabang: cabang || '',
    segmen,
    customer,
    group,
    records,
    acts,
    se: dominantSe(records, acts, addDays(today, -183)),
    wonAll,
    omzet12,
    omzetPrev12,
    yoy,
    orders12: won12.length,
    avgOrder12: won12.length ? omzet12 / won12.length : 0,
    lastOrder,
    daysSinceOrder,
    cycleDays,
    nextOrderDate,
    wins12,
    losses12,
    winRate12,
    decideDays,
    lastContact,
    daysSinceContact,
    contacts90,
    visits90,
    mangkrak,
    aktif,
    openIssues,
    gitOld,
    gitOldValue,
    products,
    months12,
    status,
    score,
    reasons,
    potensi,
    share,
  };
}

export const scoreColor = (s: number) => (s >= 70 ? 'green' : s >= 45 ? 'amber' : 'rust');
export const scoreLabel = (s: number) => (s >= 70 ? 'sehat' : s >= 45 ? 'perlu perhatian' : 'berisiko');

/** Fakta untuk setiap customer (nama dari Kelola Customer ∪ prospek). */
export function buildProfileIndex(opts: {
  prospects: Prospect[];
  activities: SalesActivity[];
  customers: Customer[];
  groups: CustomerGroup[];
  issues: PipelineIssue[];
  today: string;
}): Map<string, CustomerFacts> {
  const recs = new Map<string, { name: string; records: Prospect[] }>();
  opts.prospects.forEach((r) => {
    const n = (r.customer || '').trim();
    if (!n) return;
    const k = customerKey(n);
    const e = recs.get(k) || { name: n, records: [] };
    e.records.push(r);
    recs.set(k, e);
  });
  const acts = new Map<string, SalesActivity[]>();
  opts.activities.forEach((a) => {
    const k = customerKey(a.customer || '');
    if (!k) return;
    const l = acts.get(k);
    if (l) l.push(a);
    else acts.set(k, [a]);
  });
  const cust = new Map<string, Customer>();
  opts.customers.forEach((c) => cust.set(customerKey(c.name), c));
  const grp = new Map<string, CustomerGroup>();
  opts.groups.forEach((g) => (g.entities || []).forEach((e) => grp.set(customerKey(e), g)));

  const keys = new Set<string>([...recs.keys(), ...cust.keys()]);
  const out = new Map<string, CustomerFacts>();
  keys.forEach((k) => {
    const c = cust.get(k) || null;
    const r = recs.get(k);
    out.set(
      k,
      buildFacts({ name: c?.name || r?.name || k, records: r?.records || [], acts: acts.get(k) || [], customer: c, group: grp.get(k) || null, issues: opts.issues, today: opts.today }),
    );
  });
  return out;
}

/** Langkah berikutnya yang disarankan, dengan alasannya. */
export function nextStep(f: CustomerFacts, today: string): { title: string; why: string } {
  const pics = (f.customer?.pics || []) as CustomerPic[];
  const dm = pics.find((p) => p.peran === 'dm') || pics.find((p) => p.isPrimary);
  if (f.openIssues.length) {
    const i = f.openIssues[0];
    return { title: `Tuntaskan masalah ${i.kategori}${i.targetDate ? ` (target ${i.targetDate})` : ''}`, why: `${f.openIssues.length} masalah pipeline masih terbuka di customer ini` };
  }
  if (f.status === 'tidur' || f.status === 'jarang' || f.status === 'hilang') {
    return {
      title: `Reaktivasi: hubungi ${dm ? dm.nama : 'PIC customer'}`,
      why: `Belum order ${f.daysSinceOrder} hari${f.cycleDays ? `, biasanya tiap ±${f.cycleDays} hari` : ''}${f.daysSinceContact != null ? ` · kontak terakhir ${f.daysSinceContact} hari lalu` : ' · belum ada kontak tercatat'}`,
    };
  }
  if (f.mangkrak.length) {
    const m = f.mangkrak[0];
    return { title: `Dorong deal ${m.r.uraian || m.r.line || ''} (${rpShort(num(m.r.value))})`.replace(/\s+\(/, ' ('), why: `Tidak bergerak ${m.days} hari di tahap yang sama` };
  }
  const fu = f.aktif.filter((r) => r.followUpAt && r.followUpAt >= today).sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)))[0];
  if (fu) return { title: `Follow-up ${fu.followUpAt}: ${fu.followUpNote || fu.uraian || 'prospek aktif'}`, why: 'Jadwal follow-up yang sudah direncanakan' };
  if (f.daysSinceContact == null || f.daysSinceContact > 30) {
    return { title: 'Jadwalkan kunjungan / telepon', why: f.daysSinceContact == null ? 'Belum ada kontak tercatat di Aktivitas Harian' : `Kontak terakhir ${f.daysSinceContact} hari lalu` };
  }
  if (f.nextOrderDate && f.nextOrderDate >= today) {
    return { title: `Siapkan penawaran sebelum ${f.nextOrderDate}`, why: `Perkiraan order berikutnya dari siklus ±${f.cycleDays} hari` };
  }
  return { title: 'Pertahankan ritme kontak', why: 'Tidak ada sinyal risiko saat ini' };
}

/** Bulan paling ramai order (seluruh histori), bila datanya cukup. */
export function seasonNote(f: CustomerFacts): string {
  if (f.wonAll.length < 4) return f.wonAll.length ? 'Order masih terlalu sedikit untuk melihat pola musiman.' : 'Belum ada order.';
  const byM = new Array(12).fill(0);
  f.wonAll.forEach((r) => { byM[Number(wonDate(r).slice(5, 7)) - 1] += num(r.value); });
  const tot = byM.reduce((s, v) => s + v, 0) || 1;
  const top = byM.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 2).filter((x) => x.v > 0);
  const quiet = byM.map((v, i) => ({ v, i })).filter((x) => x.v === 0).map((x) => BULAN[x.i]);
  const pct = Math.round((top.reduce((s, x) => s + x.v, 0) / tot) * 100);
  return `Order paling ramai di ${top.map((x) => BULAN[x.i]).join(' dan ')} (${pct}% nilai).${quiet.length && quiet.length <= 6 ? ` Belum pernah order di ${quiet.join(', ')}.` : ''}`;
}

/** Faktor menang/kalah & kompetitor dari QCD. */
export function tenderBreakdown(f: CustomerFacts) {
  const lost = f.records.filter((r) => classify(r) === 'Lost');
  const won = f.wonAll;
  const count = (list: Prospect[]) => {
    const m = new Map<string, number>();
    list.forEach((r) => { const k = String(r.qcdFaktor || '').trim(); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, n]) => ({ key: k, label: QCD_FAKTOR_LABEL[k] || k, n })).sort((a, b) => b.n - a.n);
  };
  const comp = new Map<string, { n: number; nilai: number; last: string }>();
  lost.forEach((r) => {
    const n = String(r.qcdKompetitor || '').trim();
    if (!n) return;
    const e = comp.get(n) || { n: 0, nilai: 0, last: '' };
    e.n += 1;
    e.nilai += num(r.value);
    const d = lostDate(r);
    if (d > e.last) e.last = d;
    comp.set(n, e);
  });
  return {
    lostReasons: count(lost),
    wonReasons: count(won),
    lostWithReason: lost.filter((r) => r.qcdFaktor).length,
    lostTotal: lost.length,
    competitors: [...comp.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n),
  };
}

/** Produk yang dibeli banyak customer sejenis tetapi belum di customer ini. */
export function crossSell(f: CustomerFacts, peers: CustomerFacts[]) {
  const buyers = peers.filter((p) => p.key !== f.key && p.products.length);
  if (buyers.length < 2) return [];
  const mine = new Set(f.products.map((p) => p.label));
  const m = new Map<string, number>();
  buyers.forEach((p) => new Set(p.products.map((x) => x.label)).forEach((l) => m.set(l, (m.get(l) || 0) + 1)));
  return [...m.entries()]
    .filter(([l, n]) => !mine.has(l) && n >= 2 && n / buyers.length >= 0.3 && l !== '-')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, n]) => ({ label, n, of: buyers.length }));
}

// ===================================================================== SE

export interface SePeriod {
  se: string;
  startYm: string;
  endYm: string;
  months: number;
  current: boolean;
  omzetPerBulan: number;
  orderPerBulan: number;
  winRate: number | null;
  penawaranPerBulan: number;
  kunjunganPerBulan: number;
  kontakPerBulan: number;
  /** Rata-rata jeda antar-kontak SE ini (hari). */
  jedaKontak: number | null;
  produkBaru: number;
}

export interface HandoverCheck {
  t: string;
  ok: boolean;
  s: string;
}

/**
 * Siapa yang menangani customer per bulan (24 bulan terakhir), dari bobot
 * aktivitas (1), prospek dibuat (2) dan order (3) tiap SE. Bulan tanpa data
 * mengikuti SE sebelumnya; selingan satu bulan di tengah SE yang sama
 * dianggap noise.
 */
export function sePeriods(f: CustomerFacts, today: string): SePeriod[] {
  const months = lastMonths(today, 24);
  const w = new Map<string, Map<string, number>>();
  const add = (ym: string, se: string | null | undefined, n: number) => {
    const s = (se || '').trim().toUpperCase();
    if (!s || isStaffActivityKey(s) || !months.includes(ym)) return;
    const m = w.get(ym) || new Map<string, number>();
    m.set(s, (m.get(s) || 0) + n);
    w.set(ym, m);
  };
  f.acts.forEach((a) => add(ymOf(a.tanggal), a.se, 1));
  f.records.forEach((r) => {
    add(ymOf(String(r.createdAt).slice(0, 10)), r.se, 2);
    if (classify(r) === 'Won') add(ymOf(wonDate(r)), r.se, 3);
  });
  let prev = '';
  const per: { ym: string; se: string }[] = [];
  months.forEach((ym) => {
    const m = w.get(ym);
    let se = prev;
    if (m && m.size) {
      const top = Math.max(...m.values());
      const tied = [...m.entries()].filter(([, v]) => v === top).map(([k]) => k).sort();
      se = tied.includes(prev) ? prev : tied[0];
    }
    if (se) per.push({ ym, se });
    prev = se;
  });
  // runs
  let runs: { se: string; yms: string[] }[] = [];
  per.forEach((p) => {
    const last = runs[runs.length - 1];
    if (last && last.se === p.se) last.yms.push(p.ym);
    else runs.push({ se: p.se, yms: [p.ym] });
  });
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 1; i < runs.length - 1; i++) {
      if (runs[i].yms.length === 1 && runs[i - 1].se === runs[i + 1].se) {
        runs[i - 1].yms.push(...runs[i].yms, ...runs[i + 1].yms);
        runs = [...runs.slice(0, i), ...runs.slice(i + 2)];
        changed = true;
        break;
      }
    }
  }
  const firstBuy = new Map<string, string>();
  f.products.forEach((p) => firstBuy.set(p.label, p.firstDate));
  return runs.map((r, i) => {
    const set = new Set(r.yms);
    const n = r.yms.length;
    const inP = (d: string) => !!d && set.has(ymOf(d));
    const won = f.wonAll.filter((x) => inP(wonDate(x)));
    const lost = f.records.filter((x) => classify(x) === 'Lost' && inP(lostDate(x)));
    const mine = f.acts.filter((a) => (a.se || '').toUpperCase() === r.se && inP(a.tanggal)).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    const gaps: number[] = [];
    for (let j = 1; j < mine.length; j++) gaps.push(diffDays(mine[j - 1].tanggal, mine[j].tanggal));
    return {
      se: r.se,
      startYm: r.yms[0],
      endYm: r.yms[n - 1],
      months: n,
      current: i === runs.length - 1,
      omzetPerBulan: won.reduce((s, x) => s + num(x.value), 0) / n,
      orderPerBulan: won.length / n,
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      penawaranPerBulan: f.records.filter((x) => (x.se || '').toUpperCase() === r.se && inP(x.tglPenawaran || '')).length / n,
      kunjunganPerBulan: mine.filter((a) => a.tipe === 'kunjungan').length / n,
      kontakPerBulan: mine.length / n,
      jedaKontak: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null,
      produkBaru: [...firstBuy.values()].filter((d) => inP(d)).length,
    };
  });
}

/** Checklist serah terima untuk SE yang sekarang (bila ada SE sebelumnya). */
export function handoverChecklist(f: CustomerFacts, periods: SePeriod[]): HandoverCheck[] {
  if (periods.length < 2) return [];
  const cur = periods[periods.length - 1];
  const start = `${cur.startYm}-01`;
  const mine = f.acts.filter((a) => (a.se || '').toUpperCase() === cur.se && a.tanggal >= start).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const first = mine[0];
  const out: HandoverCheck[] = [];
  out.push(
    first
      ? { t: 'Kontak pertama SE baru', ok: diffDays(start, first.tanggal) <= 14, s: `${first.tanggal} · hari ke-${diffDays(start, first.tanggal) + 1}` }
      : { t: 'Kontak pertama SE baru', ok: false, s: `belum ada kontak sejak ${start}` },
  );
  const visit = mine.find((a) => a.tipe === 'kunjungan');
  out.push({ t: 'Kunjungan tatap muka', ok: !!visit, s: visit ? visit.tanggal : 'belum ada kunjungan' });
  const dms = ((f.customer?.pics || []) as CustomerPic[]).filter((p) => p.peran === 'dm').map((p) => p.nama.trim().toLowerCase());
  const metDm = mine.find((a) => (Array.isArray(a.pics) ? a.pics : []).some((p) => dms.includes(String(p.nama || '').trim().toLowerCase())));
  out.push({
    t: 'Bertemu pengambil keputusan',
    ok: !!metDm,
    s: dms.length === 0 ? 'belum ada PIC berperan pengambil keputusan di Kelola Customer' : metDm ? metDm.tanggal : 'belum pernah tercatat bertemu',
  });
  const inherited = f.records.filter((r) => String(r.createdAt).slice(0, 10) < start && [1, 2, 3].includes(num(r.status)));
  const moved = inherited.filter((r) => String(r.statusChangedAt).slice(0, 10) >= start);
  out.push({ t: 'Deal warisan dilanjutkan', ok: moved.length === inherited.length, s: inherited.length ? `${moved.length} dari ${inherited.length} deal bergerak sejak serah terima` : 'tidak ada deal terbuka saat serah terima' });
  out.push({ t: 'Masalah terbuka', ok: f.openIssues.length === 0, s: f.openIssues.length ? `${f.openIssues.length} masih terbuka` : 'tidak ada' });
  return out;
}

// ============================================================ Benchmark segmen

export const BENCH_KEYS = ['omzet12', 'yoy', 'orders12', 'avgOrder12', 'winRate12', 'decideDays', 'contacts90', 'score', 'share'] as const;
export type BenchKey = (typeof BENCH_KEYS)[number];

export function benchValue(f: CustomerFacts, k: BenchKey): number | null {
  if (k === 'avgOrder12') return f.orders12 ? f.avgOrder12 : null;
  const v = f[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Rata-rata per segmen tanpa nama customer — dihitung server dari SEMUA data
 * (lihat /api/customer-benchmarks) supaya Sales yang hanya melihat customer
 * sendiri tetap punya pembanding segmen yang berarti.
 */
export interface SegmentBenchmark {
  segmen: string;
  /** Jumlah customer di segmen yang punya prospek/transaksi. */
  n: number;
  avg: Record<BenchKey, number | null>;
  /** Customer yang pernah membeli (dasar persentase produk). */
  buyers: number;
  products: { label: string; buyers: number; pct: number }[];
}

export function segmentBenchmarks(index: Map<string, CustomerFacts>): SegmentBenchmark[] {
  const groups = new Map<string, CustomerFacts[]>();
  index.forEach((f) => {
    if (!f.records.length) return;
    for (const s of [f.segmen, '__all']) {
      if (!s) continue;
      const l = groups.get(s);
      if (l) l.push(f);
      else groups.set(s, [f]);
    }
  });
  return [...groups.entries()].map(([segmen, list]) => {
    const avg = {} as Record<BenchKey, number | null>;
    BENCH_KEYS.forEach((k) => {
      const v = list.map((f) => benchValue(f, k)).filter((x): x is number => x != null);
      avg[k] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    });
    const buyersList = list.filter((f) => f.products.length);
    const m = new Map<string, number>();
    buyersList.forEach((f) => new Set(f.products.map((p) => p.label)).forEach((l) => m.set(l, (m.get(l) || 0) + 1)));
    const buyers = buyersList.length;
    const products = [...m.entries()]
      .filter(([l]) => l !== '-')
      .map(([label, n]) => ({ label, buyers: n, pct: buyers ? Math.round((n / buyers) * 100) : 0 }))
      .sort((a, b) => b.buyers - a.buyers)
      .slice(0, 15);
    return { segmen, n: list.length, avg, buyers, products };
  });
}

/** Cross-sell dari benchmark segmen (dipakai bila customer sejenis dalam cakupan < 2). */
export function crossSellFromBench(f: CustomerFacts, b: SegmentBenchmark | undefined) {
  if (!b || b.buyers < 3) return [];
  const mine = new Set(f.products.map((p) => p.label));
  return b.products
    .filter((p) => !mine.has(p.label) && p.buyers >= 2 && p.pct >= 30)
    .slice(0, 3)
    .map((p) => ({ label: p.label, n: p.buyers, of: b.buyers }));
}
