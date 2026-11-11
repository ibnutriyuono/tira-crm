'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { CABANG_LIST, STATUS_META } from '@/lib/constants';
import { formatDateTimeID, num } from '@/lib/format';
import { effectiveTarget } from '@/lib/reports';
import { canEditSalesPlanFor } from '@/lib/sales-plan-view';
import { seTargetOf } from '@/lib/se-target';
import { currentWeek, itemValue, realisasiOf, weeksOfMonth } from '@/lib/weekly-plan';
import type { Prospect, SalesPlan, SalesPlanChange, SalesPlanItem } from '@/lib/types';
import { canNow } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

type Group = 'regional' | 'cabang' | 'sales';
interface Agg {
  target: number;
  plan: number[];
  po: number[];
  do: number[];
  add: number[];
  rem: number[];
  unsched: number;
}
interface PlanRow {
  plan: SalesPlan;
  item: SalesPlanItem;
  index: number;
  minggu: number;
  value: number;
  cabang: string;
  reg: number | null;
  se: string;
  prospect: Prospect | null;
}

const W = 5;
const zero = (): Agg => ({ target: 0, plan: Array(6).fill(0), po: Array(6).fill(0), do: Array(6).fill(0), add: Array(6).fill(0), rem: Array(6).fill(0), unsched: 0 });
const jt = (n: number) => (Math.round(n / 1e6) || (n ? '<1' : 0)).toLocaleString('id-ID');
const rpShort = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : `Rp ${Math.round(n / 1e6).toLocaleString('id-ID')} jt`);
const pc = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const sumArr = (a: number[]) => a.slice(1, W + 1).reduce((s, x) => s + x, 0);
const regLabel = (r: number | null) => (r == null ? 'Tanpa regional' : `Regional ${r}`);

/**
 * Forecast › Rencana Mingguan: rencana penjualan per minggu (W1–W5) dari
 * baris Rencana Penjualan yang diberi minggu, dibanding realisasi PO (tanggal
 * PO) dan DO terfaktur (tanggal faktur) — semuanya terhadap target bulan.
 * Bisa dikelompokkan per regional, cabang, atau Sales; tambah / hapus rencana
 * terlihat di tabel dan di rincian (baris yang dihapus tetap tampil dicoret).
 */
export function WeeklyPlanTab({ periode }: { periode: string }) {
  const tr = useT();
  const records = useDataStore((s) => s.prospects);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const seTargets = useDataStore((s) => s.seTargets);
  const currentUser = useDataStore((s) => s.currentUser);
  const upsertSalesPlan = useDataStore((s) => s.upsertSalesPlan);
  const removeSalesPlan = useDataStore((s) => s.removeSalesPlan);
  const toast = useDataStore((s) => s.toast);
  const setUi = useUiStore.setState;
  const openModal = useUiStore((s) => s.openModal);

  const [group, setGroup] = useState<Group>('regional');
  const [regF, setRegF] = useState('');
  const [cabF, setCabF] = useState('');
  const [showDelta, setShowDelta] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<{ key: string; label: string; cabang?: string; se?: string } | null>(null);
  const [week, setWeek] = useState<number>(() => Math.min(Math.max(currentWeek(periode), 1), W));
  const [changes, setChanges] = useState<SalesPlanChange[]>([]);
  const [busy, setBusy] = useState('');

  const weeks = useMemo(() => weeksOfMonth(periode), [periode]);
  const cur = currentWeek(periode);

  const loadChanges = useCallback(() => {
    api
      .get<{ changes: SalesPlanChange[] }>(`/api/sales-plans/week?periode=${periode}`)
      .then((r) => setChanges(r.changes))
      .catch(() => setChanges([]));
  }, [periode]);
  useEffect(() => {
    loadChanges();
  }, [loadChanges, salesPlans]);
  // Ganti periode → minggu berjalan (atau W1).
  const [seenPeriode, setSeenPeriode] = useState(periode);
  if (seenPeriode !== periode) {
    setSeenPeriode(periode);
    setWeek(Math.min(Math.max(currentWeek(periode), 1), W));
  }

  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const regOf = useMemo(() => {
    const m = new Map<string, number | null>();
    records.forEach((r) => {
      const cb = (r.cabang || '').toUpperCase();
      if (cb && r.reg != null && m.get(cb) == null) m.set(cb, r.reg);
    });
    salesPlans.forEach((p) => {
      const cb = (p.cabang || '').toUpperCase();
      if (cb && p.reg != null && m.get(cb) == null) m.set(cb, p.reg);
    });
    return m;
  }, [records, salesPlans]);

  const planRows = useMemo<PlanRow[]>(() => {
    const out: PlanRow[] = [];
    salesPlans
      .filter((pl) => pl.periode === periode)
      .forEach((pl) =>
        (pl.items || []).forEach((item, index) => {
          const cabang = (pl.cabang || '').toUpperCase() || '-';
          out.push({ plan: pl, item, index, minggu: num(item.minggu), value: itemValue(item), cabang, reg: pl.reg ?? regOf.get(cabang) ?? null, se: pl.se.toUpperCase(), prospect: item.sourceProspectId ? byId.get(item.sourceProspectId) || null : null });
        }),
      );
    return out;
  }, [salesPlans, periode, regOf, byId]);

  const inFilter = useCallback(
    (cabang: string, reg: number | null) => (!cabF || cabang === cabF) && (!regF || String(reg ?? '') === regF),
    [cabF, regF],
  );

  // Kunci pengelompokan: regional → cabang, cabang, atau Sales.
  const keyOf = useCallback(
    (cabang: string, se: string) => (group === 'sales' ? `se:${se}` : `cb:${cabang}`),
    [group],
  );

  const { aggs, meta } = useMemo(() => {
    const aggs = new Map<string, Agg>();
    const meta = new Map<string, { label: string; sub: string; cabang: string; reg: number | null; se?: string }>();
    const get = (k: string, label: string, sub: string, cabang: string, reg: number | null, se?: string) => {
      if (!aggs.has(k)) {
        aggs.set(k, zero());
        meta.set(k, { label, sub, cabang, reg, se });
      }
      return aggs.get(k)!;
    };
    // Target bulan
    if (group === 'sales') {
      const seCab = new Map<string, string>();
      planRows.forEach((r) => seCab.set(r.se, r.cabang));
      records.forEach((p) => p.se && !seCab.has(p.se.toUpperCase()) && seCab.set(p.se.toUpperCase(), (p.cabang || '').toUpperCase()));
      seTargets
        .filter((t) => t.periode === periode)
        .forEach((t) => {
          const se = t.se.toUpperCase();
          const cb = seCab.get(se) || (t as { cabang?: string }).cabang?.toUpperCase() || '-';
          const reg = regOf.get(cb) ?? null;
          if (!inFilter(cb, reg)) return;
          get(`se:${se}`, se, `${cb} · ${regLabel(reg)}`, cb, reg, se).target = seTargetOf(seTargets, se, periode);
        });
    } else {
      CABANG_LIST.forEach((c) => {
        const cb = c.toUpperCase();
        const reg = regOf.get(cb) ?? null;
        if (!inFilter(cb, reg)) return;
        get(`cb:${cb}`, cb, regLabel(reg), cb, reg).target = effectiveTarget(budgetTargets, cb, periode).amount;
      });
    }
    // Rencana
    planRows.forEach((r) => {
      if (!inFilter(r.cabang, r.reg)) return;
      const a = get(keyOf(r.cabang, r.se), group === 'sales' ? r.se : r.cabang, group === 'sales' ? `${r.cabang} · ${regLabel(r.reg)}` : regLabel(r.reg), r.cabang, r.reg, r.se);
      if (r.minggu >= 1 && r.minggu <= W) {
        a.plan[r.minggu] += r.value;
        const wk = weeks[r.minggu - 1];
        if (r.item.addedAt && wk && r.item.addedAt.slice(0, 10) > wk.start) a.add[r.minggu] += r.value;
      } else a.unsched += r.value;
    });
    // Realisasi PO & DO terfaktur
    records.forEach((p) => {
      const rz = realisasiOf(p, periode);
      if (!rz.po && !rz.do) return;
      const cb = (p.cabang || '').toUpperCase() || '-';
      const reg = p.reg ?? regOf.get(cb) ?? null;
      if (!inFilter(cb, reg)) return;
      const se = (p.se || '-').toUpperCase();
      const a = get(keyOf(cb, se), group === 'sales' ? se : cb, group === 'sales' ? `${cb} · ${regLabel(reg)}` : regLabel(reg), cb, reg, se);
      if (rz.po) a.po[rz.poWeek] += rz.po;
      if (rz.do) a.do[rz.doWeek] += rz.do;
    });
    // Dihapus
    changes
      .filter((c) => c.action === 'hapus' && c.minggu)
      .forEach((c) => {
        const cb = (c.cabang || '').toUpperCase() || '-';
        const reg = c.reg ?? regOf.get(cb) ?? null;
        if (!inFilter(cb, reg)) return;
        const k = keyOf(cb, c.se.toUpperCase());
        const a = aggs.get(k);
        if (a) a.rem[c.minggu!] += num(c.nilai);
      });
    return { aggs, meta };
  }, [group, planRows, records, changes, seTargets, budgetTargets, periode, regOf, inFilter, keyOf, weeks]);

  const merge = (list: Agg[]): Agg => {
    const z = zero();
    list.forEach((a) => {
      z.target += a.target;
      z.unsched += a.unsched;
      for (let i = 0; i <= W; i++) {
        z.plan[i] += a.plan[i];
        z.po[i] += a.po[i];
        z.do[i] += a.do[i];
        z.add[i] += a.add[i];
        z.rem[i] += a.rem[i];
      }
    });
    return z;
  };
  const total = merge(Array.from(aggs.values()));
  const T = total.target;
  const planT = sumArr(total.plan) + total.unsched;
  const poT = sumArr(total.po);
  const doT = sumArr(total.do);

  type Row = { key: string; label: string; sub: string; a: Agg; level: number; toggle?: () => void; isOpen?: boolean; pick?: () => void; total?: boolean };
  const rows: Row[] = [];
  const keys = Array.from(aggs.keys());
  const pickOf = (k: string) => () => {
    const m = meta.get(k)!;
    setSel({ key: k, label: m.label, cabang: group === 'sales' ? undefined : m.cabang, se: group === 'sales' ? m.se : undefined });
  };
  if (group === 'regional') {
    const regs = Array.from(new Set(keys.map((k) => meta.get(k)!.reg))).sort((a, b) => (a ?? 99) - (b ?? 99));
    regs.forEach((rg) => {
      const ks = keys.filter((k) => meta.get(k)!.reg === rg).sort();
      const id = String(rg);
      const isOpen = open[id] ?? true;
      rows.push({ key: `r${id}`, label: regLabel(rg), sub: ks.map((k) => meta.get(k)!.label).join(' · '), a: merge(ks.map((k) => aggs.get(k)!)), level: 0, toggle: () => setOpen((o) => ({ ...o, [id]: !isOpen })), isOpen });
      if (isOpen) ks.forEach((k) => rows.push({ key: k, label: meta.get(k)!.label, sub: meta.get(k)!.sub, a: aggs.get(k)!, level: 1, pick: pickOf(k) }));
    });
  } else {
    keys
      .sort((x, y) => aggs.get(y)!.target - aggs.get(x)!.target || meta.get(x)!.label.localeCompare(meta.get(y)!.label))
      .forEach((k) => rows.push({ key: k, label: meta.get(k)!.label, sub: meta.get(k)!.sub, a: aggs.get(k)!, level: 0, pick: pickOf(k) }));
  }
  rows.push({ key: 'total', label: tr('Total'), sub: `${keys.length} ${group === 'sales' ? 'Sales' : tr('cabang')}`, a: total, level: 0, total: true });

  // ---- rincian
  const selKey = sel && aggs.has(sel.key) ? sel : null;
  const matchSel = (cabang: string, se: string) => (selKey ? (selKey.se ? se === selKey.se : cabang === selKey.cabang) : inFilter(cabang, regOf.get(cabang) ?? null));
  const detailRows = planRows.filter((r) => (week === 0 ? !(r.minggu >= 1 && r.minggu <= W) : r.minggu === week) && matchSel(r.cabang, r.se));
  const detailRemoved = changes.filter((c) => c.action === 'hapus' && (week === 0 ? !c.minggu : c.minggu === week) && matchSel((c.cabang || '').toUpperCase(), c.se.toUpperCase()));
  const detailLog = changes.filter((c) => (week === 0 ? true : c.minggu === week || c.fromMinggu === week) && matchSel((c.cabang || '').toUpperCase(), c.se.toUpperCase())).slice(0, 30);
  const selAgg = selKey ? aggs.get(selKey.key)! : total;
  const canEditRow = (se: string, cabang: string) => canNow('rencana', 'e') && canEditSalesPlanFor(currentUser, se, cabang);

  async function removeRow(r: PlanRow) {
    const reason = window.prompt(`${tr('Alasan menghapus dari rencana')} (${r.prospect?.customer || r.item.uraian}):`, '');
    if (reason == null) return;
    if (reason.trim().length < 3) return toast(tr('Alasan wajib diisi'), 'error');
    setBusy(`${r.plan.id}|${r.index}`);
    try {
      const body = r.item.sourceProspectId ? { periode, prospectId: r.item.sourceProspectId, reason } : { periode, se: r.plan.se, index: r.index, uraian: r.item.uraian, reason };
      const res = await api.del<{ salesPlan?: SalesPlan; deleted?: boolean; id?: string }>('/api/sales-plans/week', body);
      if (res.salesPlan) upsertSalesPlan(res.salesPlan);
      else if (res.id) removeSalesPlan(res.id);
      toast(tr('Dihapus dari rencana'), 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menghapus', 'error');
    } finally {
      setBusy('');
    }
  }
  async function restore(c: SalesPlanChange) {
    if (!c.prospectId || !c.minggu) return;
    setBusy(c.id);
    try {
      const res = await api.post<{ salesPlan: SalesPlan }>('/api/sales-plans/week', { prospectId: c.prospectId, periode, minggu: c.minggu, items: c.items, catatan: 'Dikembalikan' });
      upsertSalesPlan(res.salesPlan);
      toast(tr('Dikembalikan ke rencana'), 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengembalikan', 'error');
    } finally {
      setBusy('');
    }
  }
  async function schedule(r: PlanRow, minggu: number) {
    setBusy(`${r.plan.id}|${r.index}`);
    try {
      const res = await api.patch<{ salesPlan: SalesPlan }>('/api/sales-plans/week', { se: r.plan.se, periode, index: r.index, uraian: r.item.uraian, minggu });
      upsertSalesPlan(res.salesPlan);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menjadwalkan', 'error');
    } finally {
      setBusy('');
    }
  }
  function addFromProspect() {
    setUi({ weeklyPlanCtx: { prospectId: null, periode, minggu: week || Math.max(cur, 1), cabang: selKey?.cabang || cabF || null, se: selKey?.se || null } });
    openModal('weeklyPlan');
  }

  async function exportXlsx() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const statusOf = (p: Prospect | null) => (p ? STATUS_META[p.status]?.label || '' : 'Manual');
    const items = planRows
      .filter((r) => inFilter(r.cabang, r.reg))
      .map((r) => ({
        Periode: periode,
        Minggu: r.minggu ? `W${r.minggu}` : 'Belum dijadwalkan',
        Regional: regLabel(r.reg),
        Cabang: r.cabang,
        SE: r.se,
        Customer: r.prospect?.customer || '',
        Uraian: r.item.uraian,
        Qty: num(r.item.qty),
        Harga: num(r.item.harga),
        Nilai: r.value,
        Tahap: statusOf(r.prospect),
        Catatan: r.item.catatan || '',
        Ditambahkan: r.item.addedAt ? formatDateTimeID(r.item.addedAt) : '',
        Oleh: r.item.addedBy || '',
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items), 'Rencana');
    const sum = rows.map((r) => {
      const o: Record<string, string | number> = { [group === 'sales' ? 'Sales' : 'Regional / Cabang']: r.label, 'Target bulan': Math.round(r.a.target) };
      for (let i = 1; i <= W; i++) {
        o[`W${i} rencana`] = Math.round(r.a.plan[i]);
        o[`W${i} PO`] = Math.round(r.a.po[i]);
        o[`W${i} DO terfaktur`] = Math.round(r.a.do[i]);
      }
      o['Belum dijadwalkan'] = Math.round(r.a.unsched);
      o['Total rencana'] = Math.round(sumArr(r.a.plan) + r.a.unsched);
      o['PO'] = Math.round(sumArr(r.a.po));
      o['DO terfaktur'] = Math.round(sumArr(r.a.do));
      o['Rencana % target'] = pc(sumArr(r.a.plan) + r.a.unsched, r.a.target);
      o['PO % target'] = pc(sumArr(r.a.po), r.a.target);
      o['DO % target'] = pc(sumArr(r.a.do), r.a.target);
      return o;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum), 'Ringkasan');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(changes.map((c) => ({ Waktu: formatDateTimeID(c.createdAt), Aksi: c.action, Minggu: c.minggu ? `W${c.minggu}` : '', 'Dari minggu': c.fromMinggu ? `W${c.fromMinggu}` : '', Cabang: c.cabang || '', SE: c.se, Customer: c.customer || '', Nilai: Math.round(num(c.nilai)), Alasan: c.reason || '', Oleh: c.byName || '' }))),
      'Riwayat',
    );
    XLSX.writeFile(wb, `Rencana-Mingguan-${periode}.xlsx`);
  }

  const regOptions = Array.from(new Set(Array.from(regOf.values()).filter((x) => x != null))).sort() as number[];
  const cabOptions = CABANG_LIST.map((c) => c.toUpperCase()).filter((c) => !regF || String(regOf.get(c) ?? '') === regF);
  const cum = (arr: number[], n: number) => arr.slice(1, n + 1).reduce((a, x) => a + x, 0);

  return (
    <div className="wp">
      <div className="wp-tools">
        <span className="seg-switch">
          {(
            [
              ['regional', tr('Regional')],
              ['cabang', tr('Cabang')],
              ['sales', 'Sales'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${group === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setGroup(k); setSel(null); }}>
              {l}
            </button>
          ))}
        </span>
        <select value={regF} onChange={(e) => { setRegF(e.target.value); setCabF(''); }} aria-label={tr('Regional')}>
          <option value="">{tr('Semua regional')}</option>
          {regOptions.map((r) => (
            <option key={r} value={String(r)}>{regLabel(r)}</option>
          ))}
        </select>
        <select value={cabF} onChange={(e) => setCabF(e.target.value)} aria-label={tr('Cabang')}>
          <option value="">{tr('Semua cabang')}</option>
          {cabOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="chk-inline"><input type="checkbox" checked={showDelta} onChange={(e) => setShowDelta(e.target.checked)} /> {tr('Tampilkan tambah / hapus')}</label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void exportXlsx()}>{tr('Export Excel')}</button>
        {canNow('rencana', 'e') && <button type="button" className="btn btn-primary btn-sm" onClick={addFromProspect}>+ {tr('Rencana Penjualan')}</button>}
      </div>

      <div className="wp-kpis">
        <div className="wp-kpi" style={{ borderLeftColor: '#1B2430' }}><small>{tr('Target bulan')}</small><b>{rpShort(T)}</b><em><i style={{ width: '100%', background: '#1B2430' }} /></em><span>{keys.length} {group === 'sales' ? 'Sales' : tr('cabang')}</span></div>
        <div className="wp-kpi" style={{ borderLeftColor: '#1F4E79' }}><small>{tr('Rencana bulan')}</small><b>{pc(planT, T)}%</b><em><i style={{ width: `${Math.min(100, pc(planT, T))}%`, background: '#1F4E79' }} /></em><span>{rpShort(planT)} {tr('dari target')}{total.unsched ? ` · ${rpShort(total.unsched)} ${tr('belum dijadwalkan')}` : ''}</span></div>
        <div className="wp-kpi" style={{ borderLeftColor: '#1D7A46' }}><small>{tr('Realisasi PO')}</small><b>{pc(poT, T)}%</b><em><i style={{ width: `${Math.min(100, pc(poT, T))}%`, background: '#1D7A46' }} /></em><span>{rpShort(poT)} {tr('dari target')}</span></div>
        <div className="wp-kpi" style={{ borderLeftColor: '#6B3FA0' }}><small>{tr('Realisasi DO terfaktur')}</small><b>{pc(doT, T)}%</b><em><i style={{ width: `${Math.min(100, pc(doT, T))}%`, background: '#6B3FA0' }} /></em><span>{rpShort(doT)} {tr('dari target')}</span></div>
        <div className="wp-kpi" style={{ borderLeftColor: '#B4432A' }}><small>{tr('Gap PO ke target')}</small><b>{rpShort(Math.max(0, T - poT))}</b><em><i style={{ width: `${Math.min(100, pc(Math.max(0, T - poT), T))}%`, background: '#B4432A' }} /></em><span>{tr('sisa rencana')} {cur <= W ? `W${Math.max(cur, 1)}–W${W}` : ''} {rpShort(total.plan.slice(Math.max(cur, 1), W + 1).reduce((s, x) => s + x, 0))}</span></div>
      </div>

      <div className="wp-weeks">
        <div className="wp-weeks-h"><b>{tr('Kumulatif terhadap target bulan')}</b><span>{tr('target')} {rpShort(T)}</span></div>
        <div className="wp-week-grid">
          {weeks.map((w) => {
            const cP = cum(total.plan, w.n);
            const cPo = cum(total.po, w.n);
            const cDo = cum(total.do, w.n);
            const run = w.n <= cur;
            return (
              <button key={w.n} type="button" className={`wp-week${w.n === cur ? ' cur' : ''}${week === w.n ? ' sel' : ''}`} onClick={() => setWeek(w.n)}>
                <div className="wp-week-t"><b>W{w.n}</b><span>{w.label}</span></div>
                <div className="wp-week-s">{w.n < cur ? tr('Selesai') : w.n === cur ? tr('Berjalan') : tr('Belum berjalan')}</div>
                <div className="wp-bars">
                  <span>{tr('Rencana')}</span><em><i style={{ width: `${Math.min(100, pc(cP, T))}%`, background: '#1F4E79' }} /></em>
                  <span>PO</span><em><i style={{ width: `${run ? Math.min(100, pc(cPo, T)) : 0}%`, background: '#1D7A46' }} /></em>
                  <span>{tr('DO faktur')}</span><em><i style={{ width: `${run ? Math.min(100, pc(cDo, T)) : 0}%`, background: '#6B3FA0' }} /></em>
                </div>
                <div className="wp-week-n mono">
                  <span><small>{tr('Rencana')}</small>{jt(total.plan[w.n])}</span>
                  <span className="po"><small>PO</small>{run ? jt(total.po[w.n]) : '–'}</span>
                  <span className="do"><small>{tr('DO faktur')}</small>{run ? jt(total.do[w.n]) : '–'}</span>
                </div>
                {showDelta && (total.add[w.n] > 0 || total.rem[w.n] > 0) && (
                  <div className="wp-delta mono">{total.add[w.n] > 0 && <span className="add">+{jt(total.add[w.n])}</span>} {total.rem[w.n] > 0 && <span className="rem">−{jt(total.rem[w.n])}</span>}</div>
                )}
                <div className="wp-week-c">{tr('Kumulatif PO')} <b className="mono">{run ? `${pc(cPo, T)}%` : '–'}</b></div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wp-main">
        <div className="wp-tbl">
          <div className="wp-tbl-h">
            <b>{group === 'regional' ? tr('Per regional & cabang') : group === 'cabang' ? tr('Per cabang') : tr('Per Sales Engineer')}</b>
            <span>{tr('Rp juta · per minggu: rencana / PO / DO terfaktur · klik baris untuk rincian')}</span>
          </div>
          <div className="table-wrap">
            <table className="simple-table wp-table">
              <thead>
                <tr>
                  <th>{group === 'sales' ? 'Sales' : group === 'cabang' ? tr('Cabang') : tr('Regional / Cabang')}</th>
                  <th className="r">{tr('Target bulan')}</th>
                  {weeks.map((w) => (
                    <th key={w.n} className={`r${w.n === cur ? ' cur' : ''}`}>W{w.n}<small>{w.label}</small></th>
                  ))}
                  <th className="r sep">{tr('Rencana')}<small>% {tr('target')}</small></th>
                  <th className="r">PO<small>% {tr('target')}</small></th>
                  <th className="r">{tr('DO terfaktur')}<small>% {tr('target')}</small></th>
                  <th className="r">{tr('Gap PO')}<small>{tr('ke target')}</small></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pT = sumArr(r.a.plan) + r.a.unsched;
                  const oT = sumArr(r.a.po);
                  const dT = sumArr(r.a.do);
                  return (
                    <tr key={r.key} className={`${r.total ? 'tot' : r.toggle ? 'grp' : ''}${selKey?.key === r.key ? ' sel' : ''}${r.pick ? ' click' : ''}`} onClick={r.pick}>
                      <td style={{ paddingLeft: 10 + r.level * 22 }}>
                        <div className="wp-name">
                          {r.toggle && (
                            <button type="button" className="wp-caret" aria-label={tr('Buka tutup regional')} onClick={(e) => { e.stopPropagation(); r.toggle!(); }}>{r.isOpen ? '▾' : '▸'}</button>
                          )}
                          <div><b>{r.label}</b><small>{r.sub}</small></div>
                        </div>
                      </td>
                      <td className="r mono"><b>{jt(r.a.target)}</b></td>
                      {weeks.map((w) => (
                        <td key={w.n} className={`r mono wp-cell${w.n === cur ? ' cur' : ''}`}>
                          <div>{jt(r.a.plan[w.n])}</div>
                          <div className="po">{w.n <= cur ? jt(r.a.po[w.n]) : '·'}</div>
                          <div className="do">{w.n <= cur ? jt(r.a.do[w.n]) : '·'}</div>
                          {showDelta && (r.a.add[w.n] > 0 || r.a.rem[w.n] > 0) && (
                            <div className="wp-delta">{r.a.add[w.n] > 0 && <span className="add">+{jt(r.a.add[w.n])}</span>} {r.a.rem[w.n] > 0 && <span className="rem">−{jt(r.a.rem[w.n])}</span>}</div>
                          )}
                        </td>
                      ))}
                      <td className="r mono sep">
                        <b>{jt(pT)}</b>
                        <small className={pc(pT, r.a.target) >= 100 ? 'ok' : 'bad'}>{r.a.target ? `${pc(pT, r.a.target)}%` : '–'}</small>
                        {r.a.unsched > 0 && <small className="muted" title={tr('Belum dijadwalkan ke minggu')}>{jt(r.a.unsched)} {tr('tanpa minggu')}</small>}
                      </td>
                      <td className="r mono"><b className="po">{jt(oT)}</b><small>{r.a.target ? `${pc(oT, r.a.target)}%` : '–'}</small></td>
                      <td className="r mono"><b className="do">{jt(dT)}</b><small>{r.a.target ? `${pc(dT, r.a.target)}%` : '–'}</small></td>
                      <td className="r mono"><b className="bad">{jt(Math.max(0, r.a.target - oT))}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="wp-legend">
            <span><i style={{ background: '#1F4E79' }} />{tr('Rencana')}</span>
            <span><i style={{ background: '#1D7A46' }} />{tr('PO (tanggal PO)')}</span>
            <span><i style={{ background: '#6B3FA0' }} />{tr('DO terfaktur (tanggal faktur)')}</span>
            <span><i className="cur" />{tr('Minggu berjalan')}</span>
            <span className="add mono">+ {tr('ditambah setelah minggu mulai')}</span>
            <span className="rem mono">− {tr('dihapus')}</span>
          </div>
        </div>

        <div className="wp-detail">
          <small className="wp-cap">{tr('Rincian rencana')}</small>
          <h4>{selKey ? selKey.label : cabF || tr('Semua')} · {week ? `W${week} (${weeks[week - 1]?.label})` : tr('Belum dijadwalkan')}</h4>
          <div className="wp-wsel">
            {weeks.map((w) => (
              <button key={w.n} type="button" className={`btn btn-sm ${week === w.n ? 'btn-primary' : 'btn-outline'}`} onClick={() => setWeek(w.n)}>W{w.n}</button>
            ))}
            {planRows.some((r) => !(r.minggu >= 1 && r.minggu <= W)) && (
              <button type="button" className={`btn btn-sm ${week === 0 ? 'btn-primary' : 'btn-outline'}`} onClick={() => setWeek(0)}>{tr('Tanpa minggu')}</button>
            )}
          </div>
          <div className="wp-dsum">
            <div><small>{tr('Rencana')}</small><b className="mono">{rpShort(week ? selAgg.plan[week] : selAgg.unsched)}</b></div>
            <div><small>PO</small><b className="mono po">{week && week <= cur ? rpShort(selAgg.po[week]) : '–'}</b></div>
            <div><small>{tr('DO terfaktur')}</small><b className="mono do">{week && week <= cur ? rpShort(selAgg.do[week]) : '–'}</b></div>
          </div>
          {selAgg.target > 0 && <div className="wp-dnote">{tr('Target bulan')} <b className="mono">{rpShort(selAgg.target)}</b> · PO {tr('s.d. sekarang')} <b className="mono">{pc(sumArr(selAgg.po), selAgg.target)}%</b> {tr('target')}</div>}

          <div className="wp-items">
            {detailRows.length === 0 && detailRemoved.length === 0 && <div className="muted">{tr('Belum ada rencana di minggu ini.')}</div>}
            {detailRows.map((r) => {
              const p = r.prospect;
              const rz = p ? realisasiOf(p, periode) : null;
              const st = rz?.do ? tr('DO terfaktur') : rz?.po ? tr('PO masuk') : p ? STATUS_META[p.status]?.label || '' : tr('Manual');
              const stCls = rz?.do ? 'violet' : rz?.po ? 'green' : 'steel';
              const added = r.item.addedAt && week && weeks[week - 1] && r.item.addedAt.slice(0, 10) > weeks[week - 1].start;
              const k = `${r.plan.id}|${r.index}`;
              const can = canEditRow(r.plan.se, r.cabang);
              return (
                <div key={k} className={`wp-item${added ? ' added' : ''}`}>
                  <div className="wp-item-h">
                    <b>{p?.customer || r.item.uraian}</b>
                    <span className="mono">{rpShort(r.value)}</span>
                  </div>
                  {p && <div className="wp-item-m">{r.item.uraian}</div>}
                  <div className="wp-item-f">
                    <span className="muted">SE {r.se} · {r.cabang}{r.item.catatan ? ` · ${r.item.catatan}` : ''}</span>
                    <span className="wp-item-a">
                      <span className={`badge ${stCls}`}>{st}</span>
                      {can && week === 0 && (
                        <select aria-label={tr('Jadwalkan ke minggu')} disabled={busy === k} value="" onChange={(e) => e.target.value && void schedule(r, Number(e.target.value))}>
                          <option value="">{tr('Jadwalkan…')}</option>
                          {weeks.map((w) => <option key={w.n} value={w.n}>W{w.n}</option>)}
                        </select>
                      )}
                      {can && p && !rz?.po && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setUi({ weeklyPlanCtx: { prospectId: p.id, periode } }); openModal('weeklyPlan'); }}>{tr('Pindah')}</button>
                      )}
                      {can && !rz?.po && <button type="button" className="btn btn-outline btn-sm danger" disabled={busy === k} onClick={() => void removeRow(r)}>{tr('Hapus')}</button>}
                    </span>
                  </div>
                  <div className={`wp-trail${added ? ' add' : ''}`}>{tr('Ditambahkan')} {r.item.addedBy || r.plan.requestedBy || ''} {r.item.addedAt ? `· ${formatDateTimeID(r.item.addedAt)}` : ''}</div>
                </div>
              );
            })}
            {detailRemoved.map((c) => (
              <div key={c.id} className="wp-item removed">
                <span className="wp-tag">{tr('Dihapus')}</span>
                <div className="wp-item-h"><b>{c.customer || c.items[0]?.uraian}</b><span className="mono">−{rpShort(num(c.nilai))}</span></div>
                <div className="wp-item-m">{c.items.map((i) => i.uraian).join(' · ')}</div>
                <div className="wp-item-f">
                  <span className="muted">SE {c.se} · {c.cabang}</span>
                  {c.prospectId && canEditRow(c.se, c.cabang || '') && !planRows.some((r) => r.item.sourceProspectId === c.prospectId) && (
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy === c.id} onClick={() => void restore(c)}>{tr('Kembalikan')}</button>
                  )}
                </div>
                <div className="wp-trail rem">{tr('Dihapus')} {c.byName} · {formatDateTimeID(c.createdAt)} — {c.reason}</div>
              </div>
            ))}
          </div>
          {canNow('rencana', 'e') && week > 0 && <button type="button" className="wp-add" onClick={addFromProspect}>+ {tr('Tambah dari prospek ke')} W{week}</button>}

          {detailLog.length > 0 && (
            <div className="wp-log">
              <small className="wp-cap">{tr('Riwayat perubahan')}</small>
              {detailLog.map((c) => (
                <div key={c.id} className="wp-log-r">
                  <span className={`mono ${c.action === 'hapus' ? 'rem' : 'add'}`}>{c.action === 'hapus' ? '−' : c.action === 'pindah' ? '⇄' : '+'}{jt(num(c.nilai))}</span>
                  <span>
                    <span>{c.action === 'hapus' ? tr('Hapus') : c.action === 'pindah' ? `${tr('Pindah')} W${c.fromMinggu ?? '–'} → W${c.minggu}` : c.action === 'ubah' ? tr('Ubah') : tr('Tambah')} {c.customer || c.items[0]?.uraian}
                    {c.reason ? ` — ${c.reason}` : ''}</span>
                    <small className="muted">{c.byName} · {formatDateTimeID(c.createdAt)}</small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
