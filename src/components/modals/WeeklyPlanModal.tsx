'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { STATUS_META } from '@/lib/constants';
import { classify, formatRupiah, getProspectMaterials, materialUnitPrice, num } from '@/lib/format';
import { effectiveTarget } from '@/lib/reports';
import { canEditSalesPlanFor } from '@/lib/sales-plan-view';
import { currentWeek, labelPeriodeID, nextPeriode, periodeOf, prospectPlanRows, weeksOfMonth } from '@/lib/weekly-plan';
import type { SalesPlan, SalesPlanItem } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

/**
 * "+ Rencana Penjualan": masukkan satu prospek ke Rencana Penjualan pada
 * minggu target PO (W1–W5), pilih item yang direncanakan, atau pindahkan /
 * hapus (dengan alasan) bila sudah ada di rencana. Dibuka dari panel
 * prospek, kartu Kanban, daftar Pipeline, dan Forecast › Rencana Mingguan
 * (tanpa prospek: pilih prospek dulu).
 */
export function WeeklyPlanModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'weeklyPlan');
  const ctx = useUiStore((s) => s.weeklyPlanCtx);
  const closeModal = useUiStore((s) => s.closeModal);
  const prospects = useDataStore((s) => s.prospects);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const currentUser = useDataStore((s) => s.currentUser);
  const upsertSalesPlan = useDataStore((s) => s.upsertSalesPlan);
  const removeSalesPlan = useDataStore((s) => s.removeSalesPlan);
  const toast = useDataStore((s) => s.toast);

  const [seenKey, setSeenKey] = useState('');
  const [pid, setPid] = useState('');
  const [q, setQ] = useState('');
  const [periode, setPeriode] = useState(periodeOf());
  const [minggu, setMinggu] = useState(1);
  const [on, setOn] = useState<boolean[]>([]);
  const [catatan, setCatatan] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const p = prospects.find((x) => x.id === pid) || null;
  const mats = useMemo(() => (p ? getProspectMaterials(p) : []), [p]);
  const existing = useMemo(() => (p ? prospectPlanRows(salesPlans, p.id, periode) : []), [salesPlans, p, periode]);

  // Buka / ganti konteks → isi ulang form dari prospek & rencana yang ada.
  const key = show ? `${ctx?.prospectId || ''}|${ctx?.periode || ''}|${ctx?.minggu || ''}` : '';
  if (key !== seenKey) {
    setSeenKey(key);
    if (show) {
      const per = ctx?.periode || periodeOf();
      setPeriode(per);
      setPid(ctx?.prospectId || '');
      setQ('');
      setReason('');
      init(ctx?.prospectId || '', per, ctx?.minggu || 0);
    }
  }
  function init(id: string, per: string, wk: number) {
    const pr = prospects.find((x) => x.id === id);
    const ex = pr ? prospectPlanRows(salesPlans, pr.id, per) : [];
    const ms = pr ? getProspectMaterials(pr) : [];
    const cw = currentWeek(per);
    setMinggu(wk || num(ex[0]?.item.minggu) || Math.min(Math.max(cw, 1), 5));
    const match = ms.map((m) => ex.some((r) => r.item.uraian === m.uraian));
    setOn(ex.length && match.some(Boolean) ? match : ms.map(() => true));
    setCatatan(ex[0]?.item.catatan || '');
  }

  const weeks = weeksOfMonth(periode);
  const cw = currentWeek(periode);
  const total = mats.reduce((s, m, i) => s + (on[i] ? num(m.qty) * materialUnitPrice(m) : 0), 0);
  const exVal = existing.reduce((s, r) => s + num(r.item.qty) * num(r.item.harga), 0);
  const cabang = (p?.cabang || '').toUpperCase();
  const target = cabang ? effectiveTarget(budgetTargets, cabang, periode).amount : 0;
  const planCab = salesPlans.filter((x) => x.periode === periode && (x.cabang || '').toUpperCase() === cabang).reduce((s, x) => s + num(x.value), 0);
  const after = planCab - exVal + total;
  const canEdit = !!p && canEditSalesPlanFor(currentUser, p.se || '', p.cabang || null);
  const klas = p ? classify(p) : '';
  const blocked = p && ((num(p.status) === 5 && p.terfaktur) || num(p.status) === 6);
  const hasPo = p && (num(p.status) === 4 || num(p.status) === 5);

  // Pilih prospek (dibuka dari Rencana Mingguan tanpa prospek).
  const pickList = useMemo(() => {
    if (!show || ctx?.prospectId) return [];
    const ql = q.trim().toLowerCase();
    return prospects
      .filter((x) => classify(x) === 'Aktif' || (num(x.status) === 4 && !x.terfaktur))
      .filter((x) => (!ctx?.cabang || (x.cabang || '').toUpperCase() === ctx.cabang) && (!ctx?.se || (x.se || '').toUpperCase() === ctx.se))
      .filter((x) => canEditSalesPlanFor(currentUser, x.se || '', x.cabang || null))
      .filter((x) => !ql || `${x.customer} ${x.uraian || ''} ${x.se || ''}`.toLowerCase().includes(ql))
      .sort((a, b) => num(b.status) - num(a.status) || num(b.value) - num(a.value))
      .slice(0, 60);
  }, [show, ctx, prospects, q, currentUser]);

  async function save() {
    if (!p) return;
    const items: SalesPlanItem[] = mats
      .map((m, i) => (on[i] ? { line: m.line, uraian: m.uraian, qty: m.qty, harga: materialUnitPrice(m) } : null))
      .filter(Boolean) as SalesPlanItem[];
    if (!items.length) return toast(tr('Pilih minimal satu item'), 'error');
    setBusy(true);
    try {
      const res = await api.post<{ salesPlan: SalesPlan; change: { action: string } }>('/api/sales-plans/week', { prospectId: p.id, periode, minggu, items, catatan });
      upsertSalesPlan(res.salesPlan);
      toast(`${p.customer}: ${res.change.action === 'pindah' ? tr('dipindah ke') : tr('masuk rencana')} W${minggu} ${labelPeriodeID(periode)}`, 'success');
      closeModal();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!p) return;
    if (reason.trim().length < 3) return toast(tr('Tulis alasan menghapus dari rencana'), 'error');
    setBusy(true);
    try {
      const res = await api.del<{ salesPlan?: SalesPlan; deleted?: boolean; id?: string }>('/api/sales-plans/week', { periode, prospectId: p.id, reason });
      if (res.salesPlan) upsertSalesPlan(res.salesPlan);
      else if (res.id) removeSalesPlan(res.id);
      toast(`${p.customer} ${tr('dihapus dari rencana')}`, 'success');
      closeModal();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menghapus', 'error');
    } finally {
      setBusy(false);
    }
  }

  const per0 = periodeOf();
  const periodes = [per0, nextPeriode(per0)];
  if (!periodes.includes(periode)) periodes.unshift(periode);

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={existing.length ? tr('Rencana Penjualan') : tr('Tambah ke Rencana Penjualan')}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Batal')}</button>
          {p && canEdit && !blocked && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {existing.length ? `${tr('Simpan')} W${minggu}` : `${tr('Simpan ke rencana')} W${minggu}`}
            </button>
          )}
        </>
      }
    >
      {!p && (
        <div className="wpm-pick">
          <input type="search" className="search-grow" placeholder={tr('Cari customer / material / SE')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="wpm-plist">
            {pickList.length === 0 && <div className="muted">{tr('Tidak ada prospek aktif yang bisa direncanakan.')}</div>}
            {pickList.map((x) => {
              const inPlan = prospectPlanRows(salesPlans, x.id, periode)[0];
              return (
                <button key={x.id} type="button" className="wpm-prow" onClick={() => { setPid(x.id); init(x.id, periode, ctx?.minggu || 0); }}>
                  <b>{x.customer}</b>
                  <span className="muted">{x.cabang} · SE {x.se || '-'} · {STATUS_META[x.status]?.label}{inPlan ? ` · ${tr('sudah di')} W${inPlan.item.minggu || '?'}` : ''}</span>
                  <span className="mono">{formatRupiah(x.value)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {p && (
        <div className="wpm">
          <div className="wpm-head">
            <div><small>{tr('Customer')}</small><b>{p.customer}</b></div>
            <div><small>{tr('Cabang · SE')}</small><b>{p.cabang || '-'} · {p.se || '-'}</b></div>
            <div><small>{tr('Tahap')}</small><b>{STATUS_META[p.status]?.label || klas}</b></div>
            {!ctx?.prospectId && <button type="button" className="link-btn" onClick={() => setPid('')}>{tr('Ganti prospek')}</button>}
          </div>
          {existing.length > 0 && (
            <div className="wpm-in">
              {tr('Sudah di rencana')} <b>W{existing[0].item.minggu || '?'}</b> · <span className="mono">{formatRupiah(exVal)}</span>
              {existing[0].item.addedBy && <span className="muted"> · {tr('ditambahkan')} {existing[0].item.addedBy}</span>}
            </div>
          )}
          {blocked && <div className="import-summary if-warn" style={{ margin: 0 }}>{num(p.status) === 6 ? tr('Prospek Lose Order tidak bisa direncanakan.') : tr('Prospek sudah terfaktur — tidak perlu direncanakan lagi.')}</div>}
          {!canEdit && <div className="import-summary if-warn" style={{ margin: 0 }}>{tr('Anda hanya bisa melihat rencana Sales ini.')}</div>}

          <div className="wpm-row">
            <label>
              <span>{tr('Bulan')}</span>
              <select value={periode} onChange={(e) => { setPeriode(e.target.value); init(p.id, e.target.value, 0); }}>
                {periodes.map((x) => <option key={x} value={x}>{labelPeriodeID(x)}</option>)}
              </select>
            </label>
            <div>
              <span className="wpm-l">{tr('Minggu target PO')}</span>
              <div className="wpm-weeks">
                {weeks.map((w) => {
                  const past = cw > 0 && w.n < cw;
                  return (
                    <button key={w.n} type="button" disabled={past || !canEdit} className={`wpm-w${minggu === w.n ? ' on' : ''}${w.n === cw ? ' cur' : ''}`} onClick={() => setMinggu(w.n)}>
                      <b>W{w.n}</b>
                      <small>{w.label}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <span className="wpm-l">{tr('Item yang direncanakan')}</span>
            <div className="wpm-items">
              {mats.length === 0 && <div className="muted" style={{ padding: 10 }}>{tr('Prospek belum punya item material.')}</div>}
              {mats.map((m, i) => (
                <label key={i} className="wpm-item">
                  <input type="checkbox" checked={!!on[i]} disabled={!canEdit} onChange={() => setOn((o) => o.map((v, j) => (j === i ? !v : v)))} />
                  <span>{m.uraian}<small>{num(m.qty)} × {formatRupiah(materialUnitPrice(m))}</small></span>
                  <b className="mono">{formatRupiah(num(m.qty) * materialUnitPrice(m))}</b>
                </label>
              ))}
            </div>
          </div>

          <div className="wpm-row">
            <div className="wpm-total"><small>{tr('Nilai rencana')}</small><b className="mono">{formatRupiah(total)}</b><span className="muted">{tr('dari harga item prospek')}</span></div>
            <label style={{ flex: 1 }}>
              <span>{tr('Catatan')}</span>
              <input value={catatan} disabled={!canEdit} onChange={(e) => setCatatan(e.target.value)} placeholder={tr('cth. customer konfirmasi PO setelah rapat Kamis')} maxLength={300} />
            </label>
          </div>

          {target > 0 && (
            <div className="wpm-note">
              {tr('Target')} {cabang} {labelPeriodeID(periode)} <b className="mono">{formatRupiah(target)}</b> · {tr('rencana cabang')} <b className="mono">{formatRupiah(planCab)}</b> → {tr('setelah disimpan')} <b className="mono">{formatRupiah(after)}</b> ({Math.round((after / target) * 100)}% {tr('target')}). {tr('Realisasi PO & DO terfaktur masuk otomatis ke minggu sesuai tanggal PO / faktur.')}
            </div>
          )}

          {existing.length > 0 && canEdit && !hasPo && (
            <div className="wpm-del">
              <span className="wpm-l">{tr('Hapus dari rencana')}</span>
              <div className="wpm-row">
                <input style={{ flex: 1 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Alasan: pindah bulan, ditunda customer, kalah harga, …')} maxLength={300} />
                <button type="button" className="btn btn-outline danger" disabled={busy} onClick={() => void remove()}>{tr('Hapus')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
