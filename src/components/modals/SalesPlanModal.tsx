'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconPlus, IconTrash } from '../icons';
import { classify, formatRupiah, getProspectMaterials, normalizeLine, materialUnitPrice, num } from '@/lib/format';
import { CABANG_LIST, STATUS_META } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { planItemStatus } from '@/lib/sales-plan-view';
import type { SalesPlan, SalesPlanItem } from '@/lib/types';

const CELL_INPUT = { width: '100%', minWidth: 0, boxSizing: 'border-box' as const };

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
  const removeSalesPlan = useDataStore((s) => s.removeSalesPlan);
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
  // Which saved plan (se|periode) the rows on screen came from. Changing SE or
  // periode loads that plan's saved materials; rows typed for a key that has
  // no saved plan yet are kept rather than wiped.
  const [loadedKey, setLoadedKey] = useState('');

  const planKey = (s: string, p: string) => `${s.trim().toLowerCase()}|${p}`;
  const findPlan = (s: string, p: string) => salesPlans.find((pl) => pl.se.toLowerCase() === s.trim().toLowerCase() && pl.periode === p) || null;
  const savedPlan = se.trim() ? findPlan(se, periode) : null;

  useEffect(() => {
    if (!show) return;
    const p = ctx?.periode || currentPeriode();
    const s = ctx?.se || (locks.se ? currentUser?.se || '' : '');
    const c = ctx?.cabang || (locks.cabang ? currentUser?.cabang || '' : '');
    setPeriode(p);
    setSe(s);
    setCabang(c);
    const existing = s ? findPlan(s, p) : null;
    setItems(existing && existing.items.length > 0 ? existing.items.map((it) => ({ ...it })) : [emptyItem()]);
    setLoadedKey(existing ? planKey(s, p) : '');
    setPickedProspectId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx]);

  // SE / periode changed inside the open form: show what is already planned
  // for that SE in that month.
  useEffect(() => {
    if (!show) return;
    const key = planKey(se, periode);
    if (key === loadedKey) return;
    const existing = se.trim() ? findPlan(se, periode) : null;
    if (existing) {
      setItems(existing.items.length > 0 ? existing.items.map((it) => ({ ...it })) : [emptyItem()]);
      setLoadedKey(key);
    } else if (loadedKey) {
      // Rows on screen belong to another SE/month's saved plan: don't carry
      // them over as if they were this one's.
      setItems([emptyItem()]);
      setLoadedKey('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [se, periode, salesPlans]);

  // Saved plans this user can see for the chosen month (role-scoped by the
  // API): quick way for BM/RM/GM to open an SE's plan.
  const savedThisPeriode = useMemo(
    () => salesPlans.filter((pl) => pl.periode === periode && (pl.items || []).length > 0).sort((a, b) => num(b.value) - num(a.value)),
    [salesPlans, periode],
  );
  const prospectById = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const seSuggestions = useMemo(() => {
    const set = new Set<string>();
    prospects.forEach((p) => p.se && set.add(p.se.trim().toUpperCase()));
    salesPlans.forEach((p) => set.add(p.se.trim().toUpperCase()));
    return Array.from(set).sort();
  }, [prospects, salesPlans]);

  // Open pipeline AND already-Won deals (PO/Kontrak, DO) belonging to this
  // plan's SE — the pool "Ambil dari Prospek" picks from. A signed PO or a
  // DO already in progress is still material Sales wants visible in the
  // plan (e.g. a deal that closed late in the month, feeding next month's
  // delivery) — Rencana isn't only "not yet won", so this stays broader
  // than Realisasi rather than trying to mirror it. Lost and mere
  // Activity logs (status 0/6) are excluded — neither is sellable material —
  // and so is a DO that is already invoiced (terfaktur).
  // Re-filters whenever `se` itself changes (not just on open) since
  // admin/gm can retarget the plan to a different SE without closing and
  // reopening the modal.
  const sePipeline = useMemo(() => {
    const target = se.trim().toLowerCase();
    if (!target) return [];
    return prospects
      .filter((p) => (p.se || '').trim().toLowerCase() === target && (classify(p) === 'Aktif' || classify(p) === 'Won'))
      // Already invoiced (DO terfaktur) = finished revenue, not something to
      // plan: hidden from the picker (the API rejects it too).
      .filter((p) => !(num(p.status) === 5 && p.terfaktur))
      .sort((a, b) => b.value - a.value);
  }, [prospects, se]);

  // ★ marker per prospect: how many different periods it has been planned in,
  // counting this form's unsaved rows as the current period (the saved copy
  // of this same SE+periode plan is replaced by what's on screen). Same rule
  // as the ★ badge on the Prospek list (buildProspectStarCounts).
  const planMarks = useMemo(() => {
    const others = salesPlans.filter((pl) => !(pl.se.toLowerCase() === se.trim().toLowerCase() && pl.periode === periode));
    const periodsById = new Map<string, Set<string>>();
    const add = (id: string | null | undefined, per: string) => {
      if (!id) return;
      if (!periodsById.has(id)) periodsById.set(id, new Set());
      periodsById.get(id)!.add(per);
    };
    others.forEach((pl) => pl.items.forEach((it) => add(it.sourceProspectId, pl.periode)));
    const inThisPlan = new Set<string>();
    items.forEach((it) => {
      if (it.sourceProspectId) {
        add(it.sourceProspectId, periode);
        inThisPlan.add(it.sourceProspectId);
      }
    });
    return { stars: new Map(Array.from(periodsById.entries()).map(([id, set]) => [id, set.size])), inThisPlan };
  }, [salesPlans, se, periode, items]);

  function onAddFromProspect() {
    const prospect = sePipeline.find((p) => p.id === pickedProspectId);
    if (!prospect) return;
    if (planMarks.inThisPlan.has(prospect.id) && !window.confirm(`"${prospect.customer}" sudah ada di rencana periode ini. Tambahkan materialnya lagi?`)) return;
    const pulled: SalesPlanItem[] = getProspectMaterials(prospect).map((m) => ({
      line: m.line,
      uraian: m.uraian,
      qty: m.qty,
      harga: materialUnitPrice(m),
      // Traced so this prospect's star count in the Prospek list picks up
      // this period — see buildProspectStarCounts in lib/reports.ts.
      sourceProspectId: prospect.id,
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

  function removeRow(idx: number) {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyItem()];
    });
  }

  async function onDeletePlan() {
    if (!savedPlan) return;
    if (!window.confirm(`Hapus seluruh rencana ${savedPlan.se} periode ${periode} (${savedPlan.items.length} material, ${formatRupiah(num(savedPlan.value))})?`)) return;
    setBusy(true);
    try {
      await api.del('/api/sales-plans', { se: savedPlan.se, periode });
      removeSalesPlan(savedPlan.id);
      setItems([emptyItem()]);
      setLoadedKey('');
      toast(`Rencana ${savedPlan.se} periode ${periode} dihapus`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus rencana', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!se.trim()) return toast('Sales Engineer (SE) wajib diisi', 'error');
    if (!cabang.trim()) return toast('Cabang wajib diisi', 'error');
    if (!items.some((it) => (it.uraian || '').trim())) {
      // Every row deleted from a saved plan = remove the plan.
      if (savedPlan) return onDeletePlan();
      return toast('Isi minimal satu material rencana', 'error');
    }

    setBusy(true);
    try {
      const { salesPlan } = await api.put<{ salesPlan: SalesPlan }>('/api/sales-plans', { se: savedPlan?.se ?? se.trim(), cabang, periode, items });
      upsertSalesPlan(salesPlan);
      setLoadedKey(planKey(salesPlan.se, salesPlan.periode));
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
          {savedPlan && (
            <button type="button" className="btn btn-outline" style={{ marginRight: 'auto', color: 'var(--rust-500)' }} onClick={onDeletePlan} disabled={busy}>
              <IconTrash /> Hapus Rencana
            </button>
          )}
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
          <input type="text" list="salesPlanSeList" value={se} readOnly={locks.se} onChange={(e) => setSe(e.target.value)} placeholder="Inisial SE" />
          {!locks.se && (
            <datalist id="salesPlanSeList">
              {seSuggestions.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          )}
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

      {!locks.se && savedThisPeriode.length > 0 && (
        <>
          <div style={{ fontWeight: 600, fontSize: 12.5, margin: '18px 0 8px' }}>Rencana tersimpan periode ini</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {savedThisPeriode.map((pl) => {
              const active = pl.se.toLowerCase() === se.trim().toLowerCase();
              return (
                <button
                  key={pl.id}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => {
                    setSe(pl.se);
                    if (!locks.cabang && pl.cabang) setCabang(pl.cabang);
                  }}
                >
                  {pl.se} · {pl.cabang || '-'} · {pl.items.length} material · {formatRupiah(num(pl.value))}
                </button>
              );
            })}
          </div>
          <div className="field-note" style={{ marginTop: 4 }}>Klik untuk membuka rencana SE tersebut.</div>
        </>
      )}

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
                {planMarks.stars.get(p.id) ? `${'★'.repeat(Math.min(planMarks.stars.get(p.id) as number, 5))} ` : ''}
                {p.customer} — {formatRupiah(p.value)} ({p.cabang || '-'}) · {STATUS_META[p.status]?.label ?? '-'}
                {planMarks.inThisPlan.has(p.id) ? ' · sudah di rencana ini' : planMarks.stars.get(p.id) ? ` · sudah di ${planMarks.stars.get(p.id)} rencana` : ''}
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
        kalau tidak dari Harga langsung) — baris hasil tarikan tetap bisa diedit atau dihapus seperti biasa. Prospek DO yang
        sudah terfaktur tidak ditampilkan. Tanda ★ = prospek sudah pernah masuk rencana penjualan (jumlah bintang = jumlah
        periode rencana).
      </div>

      <div style={{ fontWeight: 600, fontSize: 12.5, margin: '18px 0 8px' }}>
        Material yang Direncanakan
        {savedPlan ? (
          <span className="badge green" style={{ marginLeft: 8 }}>
            Tersimpan · {savedPlan.items.length} material · {formatRupiah(num(savedPlan.value))}
          </span>
        ) : se.trim() ? (
          <span className="badge slate" style={{ marginLeft: 8 }}>Belum ada rencana tersimpan</span>
        ) : null}
      </div>
      <div className="table-wrap" style={{ borderTop: 'none' }}>
        <table className="simple-table" style={{ minWidth: 0, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 60 }}>Line</th>
              <th>Uraian Material</th>
              <th style={{ width: 70 }}>Qty</th>
              <th style={{ width: 120 }}>Estimasi Harga</th>
              <th style={{ width: 140, textAlign: 'right' }}>Value</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td>
                  <input type="text" value={it.line} onChange={(e) => updateItem(idx, { line: e.target.value })} onBlur={(e) => updateItem(idx, { line: normalizeLine(e.target.value) })} placeholder="cth. 02" style={CELL_INPUT} />
                </td>
                <td>
                  <input type="text" value={it.uraian} onChange={(e) => updateItem(idx, { uraian: e.target.value })} placeholder="cth. Plate ASTM A36 Tbl 12mm" style={CELL_INPUT} />
                  {it.sourceProspectId &&
                    (() => {
                      const st = planItemStatus(it, prospectById);
                      return (
                        <div className="field-note" style={{ marginTop: 3 }}>
                          {st.customer ? `${st.customer} · ` : ''}
                          <span className={`badge ${st.color}`}>{st.label}</span>
                        </div>
                      );
                    })()}
                </td>
                <td>
                  <input type="number" min={0} value={it.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} style={CELL_INPUT} />
                </td>
                <td>
                  <input type="number" min={0} value={it.harga} onChange={(e) => updateItem(idx, { harga: e.target.value })} placeholder="per unit" style={CELL_INPUT} />
                </td>
                <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatRupiah(num(it.qty) * num(it.harga))}</td>
                <td>
                  <button type="button" className="icon-btn danger" title="Hapus material" onClick={() => removeRow(idx)}>
                    <IconTrash />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setItems((prev) => [...prev, emptyItem()])}>
        <IconPlus /> Tambah Material
      </button>
      {savedPlan && (
        <div className="field-note" style={{ marginTop: 6 }}>
          Hapus baris lalu klik <b>Simpan Rencana</b> untuk menyimpan perubahan. Bila semua baris dihapus, rencana periode ini ikut dihapus.
        </div>
      )}
    </Modal>
  );
}
