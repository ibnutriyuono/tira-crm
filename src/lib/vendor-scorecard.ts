import { normalizeLine } from './format';
import { cleanEtaLog } from './item-stock';
import { flowItems } from './item-flow';
import type { Prospect, RfqItem } from './types';

/**
 * Scorecard vendor untuk GM Operation / Purchasing. Semua angka diturunkan
 * dari data yang sudah ada:
 *  - permintaan harga (Quotation / Minta Harga ke Vendor): dibalas %, lama balas;
 *  - jawaban RFQ yang memakai vendor (vendorId per item) dan hasil prospeknya
 *    (PO/DO = menang, Lose = kalah);
 *  - ketepatan kedatangan: item PO Indent yang vendornya = vendor jawaban RFQ
 *    item yang sama (Line + grade), tiba ≤ target pertama = tepat;
 *  - tren harga: HPP terakhir vs sebelumnya per grade + tebal.
 */
export interface VendorScore {
  vendorId: string;
  diminta: number;
  dibalasPct: number | null;
  lamaBalas: number | null;
  dipakai: number;
  menang: number;
  kalah: number;
  winPct: number | null;
  tiba: number;
  tepat: number;
  tepatPct: number | null;
  telatHari: number | null;
  hargaTren: number | null;
  skor: number | null;
}

type ReqRow = { vendorId: string | null; status: string; sentAt: string | null; balasAt: string | null; createdAt: string };
type RfqRow = { prospectId: string | null; tglRfq: string | null; items: unknown };

const low = (s: unknown) => String(s ?? '').trim().toLowerCase();
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

export function buildScorecard(vendorIds: string[], reqs: ReqRow[], rfqs: RfqRow[], prospects: Prospect[]): VendorScore[] {
  const pmap = new Map(prospects.map((p) => [p.id, p]));
  const acc = new Map<string, { req: ReqRow[]; used: number; won: number; lost: number; prices: { key: string; tgl: string; hpp: number }[]; arr: { onTime: boolean; late: number }[] }>();
  const get = (id: string) => {
    if (!acc.has(id)) acc.set(id, { req: [], used: 0, won: 0, lost: 0, prices: [], arr: [] });
    return acc.get(id)!;
  };
  vendorIds.forEach(get);
  reqs.forEach((r) => r.vendorId && get(r.vendorId).req.push(r));

  // Vendor per item prospek (dari jawaban RFQ) untuk ketepatan kedatangan.
  const itemVendor = new Map<string, string>();
  rfqs.forEach((r) => {
    const p = r.prospectId ? pmap.get(r.prospectId) : undefined;
    const st = p ? Number(p.status) : 0;
    const counted = new Set<string>();
    ((Array.isArray(r.items) ? r.items : []) as (RfqItem & { vendorId?: string; hpp?: number; kurs?: number; hppCur?: string })[]).forEach((it) => {
      if (!it.vendorId) return;
      const a = get(it.vendorId);
      a.used++;
      if (!counted.has(it.vendorId)) {
        counted.add(it.vendorId);
        if (st === 4 || st === 5) a.won++;
        else if (st === 6) a.lost++;
      }
      if (Number(it.hpp) > 0) {
        const idr = Number(it.hpp) * ((it.hppCur || 'IDR').toUpperCase() === 'IDR' ? 1 : Number(it.kurs) || 0);
        if (idr > 0) a.prices.push({ key: `${low(it.grade || it.material)}|${String(it.thick || it.dia || '')}`, tgl: r.tglRfq || '', hpp: idr });
      }
      if (r.prospectId) itemVendor.set(`${r.prospectId}|${normalizeLine(it.line)}|${low(it.grade)}`, it.vendorId);
    });
  });

  prospects.forEach((p) => {
    const mats = (Array.isArray(p.materials) ? p.materials : []) as unknown as Record<string, unknown>[];
    flowItems(p).forEach((f) => {
      const m = mats[f.idx] || {};
      if (m.etaStat !== 'tiba') return;
      const v = itemVendor.get(`${p.id}|${normalizeLine(m.line)}|${low(m.grade)}`);
      if (!v) return;
      const log = cleanEtaLog(m.etaLog);
      const first = log.find((e) => e.to)?.to || (typeof m.eta === 'string' ? m.eta : '');
      const arrived = [...log].reverse().find((e) => e.sTo === 'tiba')?.at?.slice(0, 10) || '';
      if (!first || !arrived) return;
      const late = Math.max(0, Math.round(days(first, arrived)));
      get(v).arr.push({ onTime: late === 0, late });
    });
  });

  return Array.from(acc.entries()).map(([vendorId, a]) => {
    const done = a.req.filter((r) => r.status !== 'menunggu');
    const lama = done.map((r) => (r.balasAt ? days(r.sentAt || r.createdAt, r.balasAt) : null)).filter((x): x is number => x != null && x >= 0);
    const dibalasPct = a.req.length ? Math.round((a.req.filter((r) => r.status === 'dibalas').length / a.req.length) * 100) : null;
    const lamaBalas = lama.length ? Math.round((lama.reduce((s, x) => s + x, 0) / lama.length) * 10) / 10 : null;
    const winPct = a.won + a.lost ? Math.round((a.won / (a.won + a.lost)) * 100) : null;
    const tepat = a.arr.filter((x) => x.onTime).length;
    const tepatPct = a.arr.length ? Math.round((tepat / a.arr.length) * 100) : null;
    const lateOnly = a.arr.filter((x) => !x.onTime);
    const telatHari = lateOnly.length ? Math.round(lateOnly.reduce((s, x) => s + x.late, 0) / lateOnly.length) : null;
    // Tren harga: rata-rata perubahan HPP terakhir vs sebelumnya per grade/tebal.
    const byKey = new Map<string, { tgl: string; hpp: number }[]>();
    a.prices.forEach((x) => byKey.set(x.key, [...(byKey.get(x.key) || []), x]));
    const ch: number[] = [];
    byKey.forEach((list) => {
      const s = list.sort((x, y) => (x.tgl < y.tgl ? 1 : -1));
      if (s.length >= 2 && s[1].hpp > 0) ch.push((s[0].hpp / s[1].hpp - 1) * 100);
    });
    const hargaTren = ch.length ? Math.round((ch.reduce((s, x) => s + x, 0) / ch.length) * 10) / 10 : null;
    // Skor 0–100: ketepatan kirim 40, balasan 30, menang 30 (komponen tanpa data tidak dihitung).
    const parts: [number | null, number][] = [
      [tepatPct, 40],
      [dibalasPct == null ? null : Math.max(0, Math.min(100, dibalasPct - (lamaBalas != null && lamaBalas > 2 ? Math.min(30, (lamaBalas - 2) * 10) : 0))), 30],
      [winPct, 30],
    ];
    const w = parts.filter((p) => p[0] != null).reduce((s, p) => s + p[1], 0);
    const skor = w ? Math.round(parts.filter((p) => p[0] != null).reduce((s, p) => s + (p[0] as number) * p[1], 0) / w) : null;
    return { vendorId, diminta: a.req.length, dibalasPct, lamaBalas, dipakai: a.used, menang: a.won, kalah: a.lost, winPct, tiba: a.arr.length, tepat, tepatPct, telatHari, hargaTren, skor };
  });
}
