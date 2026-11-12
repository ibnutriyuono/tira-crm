import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { getOpsRules } from '@/lib/ops-escalation';
import { saranHarga, stockGradeKey } from '@/lib/stock';
import { numOrNull } from '@/lib/kontrak';
import type { RfqItem } from '@/lib/types';

/**
 * Harga acuan untuk form kontrak (harga jual — tanpa HPP):
 *  - jawaban RFQ Purchasing (Rupiah, UOM kg) dengan grade & tebal sama, terbaru dulu;
 *  - saran harga stok gudang (HPP stok ÷ (1 − margin saran stok)) per kg.
 * GET ?grade=TC 8000[&tebal=12&lebar=2000&panjang=6000][&min=8&max=50]
 * Tanpa tebal: daftar acuan per tebal yang tersedia (untuk cakupan semua dimensi).
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'v');
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  // Material non-katalog dari prospek (Jadikan kontrak): jawaban RFQ prospek itu.
  const pid = String(sp.get('prospectId') || '');
  if (pid) {
    const rs = await prisma.rfq.findMany({ where: { prospectId: pid, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { noRfq: true, items: true } });
    const list: { label: string; acuan: number; uom: string; src: string }[] = [];
    rs.forEach((r) => ((Array.isArray(r.items) ? r.items : []) as unknown as RfqItem[]).forEach((it) => {
      if (it.noQuote || !(Number(it.hargaPurchasing) > 0) || (it.currency && String(it.currency).toUpperCase() !== 'IDR')) return;
      const label = [it.material, it.grade, it.thick ? `t${it.thick}` : '', it.width ? `× ${it.width}` : '', it.length ? `× ${it.length}` : ''].filter(Boolean).join(' ').trim() || 'item';
      list.push({ label, acuan: Number(it.hargaPurchasing), uom: String(it.uom || 'KG').toUpperCase(), src: `harga jual Purchasing · ${r.noRfq || 'RFQ'}` });
    }));
    return NextResponse.json({ rows: list.slice(0, 60) });
  }
  const grade = String(sp.get('grade') || '').trim();
  const key = stockGradeKey(grade).key;
  if (!key) return NextResponse.json({ rows: [] });
  const tebal = numOrNull(sp.get('tebal'));
  const lebar = numOrNull(sp.get('lebar'));
  const panjang = numOrNull(sp.get('panjang'));
  const min = numOrNull(sp.get('min'));
  const max = numOrNull(sp.get('max'));
  const okT = (t: number | null) => t != null && (tebal != null ? Math.abs(t - tebal) < 0.01 : (min == null || t >= min) && (max == null || t <= max));
  type Row = { tebal: number; lebar: number | null; panjang: number | null; acuan: number; src: string; at: string };
  const out: Row[] = [];
  const rfqs = await prisma.rfq.findMany({ where: { cancelledAt: null }, orderBy: { createdAt: 'desc' }, take: 400, select: { noRfq: true, items: true, createdAt: true, jawabanRfqAt: true } });
  rfqs.forEach((r) => {
    ((Array.isArray(r.items) ? r.items : []) as unknown as RfqItem[]).forEach((it) => {
      if (it.noQuote || !(Number(it.hargaPurchasing) > 0)) return;
      if (it.currency && String(it.currency).toUpperCase() !== 'IDR') return;
      if (it.uom && !/^kg$/i.test(String(it.uom).trim())) return;
      if (stockGradeKey(String(it.grade || '')).key !== key) return;
      const t = numOrNull(it.thick);
      if (!okT(t)) return;
      const w = numOrNull(it.width);
      const l = numOrNull(it.length);
      if (lebar != null && w != null && Math.abs(w - lebar) > 0.01) return;
      if (panjang != null && l != null && Math.abs(l - panjang) > 0.01) return;
      out.push({ tebal: t as number, lebar: w, panjang: l, acuan: Number(it.hargaPurchasing), src: `harga jual Purchasing · ${r.noRfq || 'RFQ'}`, at: (r.jawabanRfqAt || r.createdAt).toISOString().slice(0, 10) });
    });
  });
  const rules = await getOpsRules();
  const stock = await prisma.stockItem.findMany({ where: { gradeKey: key, hpp: { gt: 0 } }, select: { itemNo: true, unit: true, hpp: true, dim: true, bentuk: true, createdAt: true } });
  stock.forEach((s) => {
    if (s.unit && !/^kg/i.test(s.unit.trim())) return;
    const d = (s.dim || {}) as Record<string, unknown>;
    const t = numOrNull(d.tebal);
    if (!okT(t)) return;
    const sar = saranHarga(s.hpp, rules.stockMarginPct);
    if (!sar) return;
    out.push({ tebal: t as number, lebar: numOrNull(d.lebar), panjang: numOrNull(d.panjang), acuan: sar, src: `saran stok · ${s.itemNo}`, at: s.createdAt.toISOString().slice(0, 10) });
  });
  // RFQ (terbaru) didahulukan; satu baris per tebal untuk daftar semua dimensi.
  out.sort((a, b) => a.tebal - b.tebal || (a.src.startsWith('harga jual') === b.src.startsWith('harga jual') ? b.at.localeCompare(a.at) : a.src.startsWith('harga jual') ? -1 : 1));
  const rows = tebal != null ? out.slice(0, 8) : out.filter((r, i) => i === 0 || out[i - 1].tebal !== r.tebal).slice(0, 30);
  return NextResponse.json({ rows });
}
