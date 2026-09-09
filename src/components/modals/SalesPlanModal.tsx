'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconPlus, IconTrash } from '../icons';
import { formatRupiah, num } from '@/lib/format';
import { CABANG_LIST } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { SalesPlan, SalesPlanItem } from '@/lib/types';

const emptyItem = (): SalesPlanItem => ({ line: '', uraian: '', qty: 1, harga: '' });

function currentPeriode(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Rencana Penjualan — a monthly, per-material sales plan for one Sales
 * Engineer. Its total (sum of qty x harga per row) feeds the Rencana column
 * in ForecastModal, compared against the company Target and the actual Won
 * value for the same month.
 *
 * Field locks follow the same reg/cabang/se rule as ProspectFormModal
 * (prospectScopeLocks): sales fills only their own SE's plan; bm can fill
 * one in for any SE in their own branch; gm/admin can pick any SE/branch.
 * rm has no write path here — they aggregate across branches they don't
 * individually run (see canEditSalesPlan in lib/auth.ts).
 */
export function SalesPlanModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'salesPlan';
  const closeModal = useUiStore((s) => s.closeModal);
  const ctx = useUiStore((s) => s.salesPlanCtx);

  const currentUser = useDataStore((s) => s.currentUser);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const upsertSalesPlan = useDataStore((s) => s.upsertSalesPlan);
  const toast = useDataStore((s) => s.toast);

  const locks =
    currentUser?.role === 'sales' ? { cabang: true, se: true }
    : currentUser?.role === 'bm' ? { cabang: true, se: false }
    : { cabang: false, se: false };

  const [periode, setPeriode] = useState(currentPeriode());
  const [se, setSe] = useState('');
  const [cabang, setCabang] = useState('');
  const [items, setItems] = useState<SalesPlanItem[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    const p = ctx?.periode || currentPeriode();
    const s = ctx?.se || (locks.se ? currentUser?.se || '' : '');
    const c = ctx?.cabang || (locks.cabang ? currentUser?.cabang || '' : '');
    setPeriode(p);
    setSe(s);
    setCabang(c);
    const existing = salesPlans.find((pl) => pl.se.toLowerCase() === s.toLowerCase() && pl.periode === p);
    setItems(existing && existing.items.length > 0 ? existing.items.map((it) => ({ ...it })) : [emptyItem()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx]);

  const total = useMemo(() => items.reduce((sum, it) => sum + num(it.qty) * num(it.harga), 0), [items]);

  function updateItem(idx: number, patch: Partial<SalesPlanItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function onSave() {
    if (!se.trim()) return toast('Sales Engineer (SE) wajib diisi', 'error');
    if (!cabang.trim()) return toast('Cabang wajib diisi', 'error');
    if (!items.some((it) => (it.uraian || '').trim())) return toast('Isi minimal satu material rencana', 'error');

    setBusy(true);
    try {
      const { salesPlan } = await api.put<{ salesPlan: SalesPlan }>('/api/sales-plans', { se: se.trim(), cabang, periode, items });
      upsertSalesPlan(salesPlan);
      toast(`Rencana ${se} periode ${periode} tersimpan`, 'success');
      closeModal();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan rencana', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Rencana Penjualan"
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>
            Simpan Rencana
          </button>
        </>
      }
    >
      <div className="import-summary" style={{ marginBottom: 14 }}>
        Rencana bulanan per material — totalnya (jumlah qty x harga tiap baris) yang dibandingkan dengan Target dan
        Realisasi di tab Forecast. Mengisi ulang bulan yang sama akan menimpa rencana sebelumnya, bukan menambah baris
        baru — jadi ini selalu versi terakhir, bukan riwayat revisi.
      </div>

      <div className="form-grid">
        <div>
          <label>Periode</label>
          <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} />
        </div>
        <div>
          <label>Sales Engineer (SE)</label>
          <input type="text" value={se} readOnly={locks.se} onChange={(e) => setSe(e.target.value)} placeholder="Inisial SE" />
          {locks.se && <div className="field-note">Terkunci sesuai akun Anda</div>}
        </div>
        <div>
          <label>Cabang</label>
          {locks.cabang ? (
            <input type="text" value={cabang} readOnly />
          ) : (
            <select value={cabang} onChange={(e) => setCabang(e.target.value)}>
              <option value="">Pilih cabang</option>
              {CABANG_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {locks.cabang && <div className="field-note">Terkunci sesuai akun Anda</div>}
        </div>
        <div>
          <label>Total Rencana</label>
          <input type="text" readOnly value={formatRupiah(total)} style={{ background: 'var(--steel-100)', fontWeight: 700 }} />
        </div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 12.5, margin: '18px 0 8px' }}>Material yang Direncanakan</div>
      <div className="table-wrap" style={{ borderTop: 'none' }}>
        <table className="simple-table">
          <thead>
            <tr>
              <th style={{ width: '10%' }}>Line</th>
              <th>Uraian Material</th>
              <th style={{ width: '12%' }}>Qty</th>
              <th style={{ width: '18%' }}>Estimasi Harga</th>
              <th style={{ width: '18%' }}>Value</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td>
                  <input type="text" value={it.line} onChange={(e) => updateItem(idx, { line: e.target.value })} placeholder="cth. 02" />
                </td>
                <td>
                  <input type="text" value={it.uraian} onChange={(e) => updateItem(idx, { uraian: e.target.value })} placeholder="cth. Plate ASTM A36 Tbl 12mm" />
                </td>
                <td>
                  <input type="number" min={0} value={it.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} value={it.harga} onChange={(e) => updateItem(idx, { harga: e.target.value })} placeholder="per unit" />
                </td>
                <td className="mono">{formatRupiah(num(it.qty) * num(it.harga))}</td>
                <td>
                  {items.length > 1 && (
                    <button type="button" className="icon-btn danger" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>
                      <IconTrash />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setItems((prev) => [...prev, emptyItem()])}>
        <IconPlus /> Tambah Material
      </button>
    </Modal>
  );
}
