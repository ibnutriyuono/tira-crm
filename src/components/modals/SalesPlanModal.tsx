'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconPlus, IconTrash } from '../icons';
import { classify, formatRupiah, getProspectMaterials, materialUnitPrice, num } from '@/lib/format';
import { CABANG_LIST, STATUS_META } from '@/lib/constants';
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
  const prospects = useDataStore((s) => s.prospects);
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
  const [pickedProspectId, setPickedProspectId] = useState('');

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
    setPickedProspectId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx]);

  // Open pipeline AND already-Won deals (PO/Kontrak, DO) belonging to this
  // plan's SE — the pool "Ambil dari Prospek" picks from. A signed PO or a
  // DO already in progress is still material Sales wants visible in the
  // plan (e.g. a deal that closed late in the month, feeding next month's
  // delivery) — Rencana isn't only "not yet won", so this stays broader
  // than Realisasi rather than trying to mirror it. Only Lost and mere
  // Activity logs (status 0/6) are excluded — neither is sellable material.
  // Re-filters whenever `se` itself changes (not just on open) since
  // admin/gm can retarget the plan to a different SE without closing and
  // reopening the modal.
  const sePipeline = useMemo(() => {
    const target = se.trim().toLowerCase();
    if (!target) return [];
    return prospects
      .filter((p) => (p.se || '').trim().toLowerCase() === target && (classify(p) === 'Aktif' || classify(p) === 'Won'))
      .sort((a, b) => b.value - a.value);
  }, [prospects, se]);

  function onAddFromProspect() {
    const prospect = sePipeline.find((p) => p.id === pickedProspectId);
    if (!prospect) return;
    const pulled: SalesPlanItem[] = getProspectMaterials(prospect).map((m) => ({
      line: m.line,
      uraian: m.uraian,
      qty: m.qty,
      harga: materialUnitPrice(m),
    }));
    setItems((prev) => {
      // An untouched blank starting row would otherwise sit there empty
      // above whatever gets pulled in — replace it instead of leaving Sales
      // to notice and delete it manually.
      const isUntouchedBlank = prev.length === 1 && !prev[0].line.trim() && !prev[0].uraian.trim() && !prev[0].harga;
      return isUntouchedBlank ? pulled : [...prev, ...pulled];
    });
    toast(`${pulled.length} material dari "${prospect.customer}" ditambahkan`, 'success');
    setPickedProspectId('');
  }

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

      <div style={{ fontWeight: 600, fontSize: 12.5, margin: '18px 0 8px' }}>Ambil dari Prospek (opsional)</div>
      {!se.trim() ? (
        <div className="field-note">Isi Sales Engineer (SE) dulu untuk melihat daftar prospeknya.</div>
      ) : sePipeline.length === 0 ? (
        <div className="field-note">Tidak ada prospek yang bisa ditarik untuk SE ini — isi material secara manual di bawah.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={pickedProspectId} onChange={(e) => setPickedProspectId(e.target.value)} style={{ maxWidth: 420 }}>
            <option value="">Pilih prospek milik {se}…</option>
            {sePipeline.map((p) => (
              <option key={p.id} value={p.id}>
                {p.customer} — {formatRupiah(p.value)} ({p.cabang || '-'}) · {STATUS_META[p.status]?.label ?? '-'}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-outline btn-sm" disabled={!pickedProspectId} onClick={onAddFromProspect}>
            <IconPlus /> Tambahkan Material
          </button>
        </div>
      )}
      <div className="field-note" style={{ marginTop: 4 }}>
        Menarik baris material dari prospek yang dipilih (harga per unit dihitung dari Berat/pc × Harga/Kg bila terisi,
        kalau tidak dari Harga langsung) — baris hasil tarikan tetap bisa diedit atau dihapus seperti biasa.
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
