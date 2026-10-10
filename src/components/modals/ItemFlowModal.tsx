'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { STATUS_META } from '@/lib/constants';
import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { formatDateID, num, todayStr } from '@/lib/format';
import {
  EVENT_META,
  ITEM_STATE_META,
  flowItems,
  flowTotals,
  formatQty,
  formatTon,
  type FlowItem,
  type ItemEvent,
} from '@/lib/item-flow';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

type Mode = 'po' | 'kirim' | null;

/** Three-part bar: terkirim · PO belum kirim · tidak di-PO (or one "ditawarkan" segment before PO). */
export function FlowBar({ it }: { it: Pick<FlowItem, 'offered' | 'po' | 'sent'> }) {
  const base = it.offered || 1;
  const seg = (v: number, cls: string) => (v > 0 ? <span className={cls} style={{ width: `${Math.min(100, (v / base) * 100)}%` }} /> : null);
  return (
    <span className="if-bar" aria-hidden="true">
      {it.po === null ? (
        seg(it.offered, 'off')
      ) : (
        <>
          {seg(it.sent, 'sent')}
          {seg(it.po - it.sent, 'open')}
          {seg(it.offered - it.po, 'lost')}
        </>
      )}
    </span>
  );
}

export function FlowLegend() {
  return (
    <span className="if-legend">
      <span><i className="sent" />Terkirim</span>
      <span><i className="open" />PO belum kirim</span>
      <span><i className="off" />Ditawarkan</span>
      <span><i className="lost" />Tidak di-PO</span>
    </span>
  );
}

/**
 * Status Item & Riwayat: qty ditawarkan -> PO -> terkirim per baris material,
 * plus the per-item history. Opened from the Kanban card, the Pipeline tab of
 * Analisa Eksekutif, and automatically after a move into PO / DO.
 */
export function ItemFlowModal() {
  const show = useUiStore((s) => s.modal === 'itemFlow');
  const ctx = useUiStore((s) => s.itemFlowCtx);
  const openModal = useUiStore((s) => s.openModal);
  const closeRaw = useUiStore((s) => s.closeModal);
  const close = () => (ctx?.returnTo ? openModal(ctx.returnTo) : closeRaw());

  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const record = ctx ? prospects.find((p) => p.id === ctx.prospectId) || null : null;
  const [events, setEvents] = useState<ItemEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [filter, setFilter] = useState('');
  const [noPo, setNoPo] = useState('');
  const [tglPO, setTglPO] = useState('');
  const [poDraft, setPoDraft] = useState<Record<string, string>>({});
  const [noDo, setNoDo] = useState('');
  const [tglDo, setTglDo] = useState('');
  const [doDraft, setDoDraft] = useState<Record<string, string>>({});

  const items = useMemo(() => (record ? flowItems(record) : []), [record]);
  const totals = useMemo(() => flowTotals(items), [items]);
  const status = record ? num(record.status) : 0;
  const won = status === 4 || status === 5;
  const allConfirmed = items.length > 0 && items.every((i) => i.poConfirmed);
  const outstanding = items.some((i) => i.poConfirmed && (i.po || 0) > (i.sentConfirmed ? i.sent : 0));
  const canEdit = !!currentUser && !isPurchasingRoleClient(currentUser.role);

  function startPo(list: FlowItem[] = items, p: Prospect | null = record) {
    setPoDraft(Object.fromEntries(list.map((i) => [i.itemId, String(i.poConfirmed ? i.po : i.offered)])));
    setNoPo(p?.noPo || '');
    setTglPO(p?.tglPO || todayStr());
    setMode('po');
  }
  function startKirim(list: FlowItem[] = items) {
    setDoDraft(Object.fromEntries(list.map((i) => [i.itemId, String(Math.max(0, (i.po || 0) - (i.sentConfirmed ? i.sent : 0)))])));
    setNoDo('');
    setTglDo(todayStr());
    setMode('kirim');
  }

  useEffect(() => {
    if (!show || !ctx) return;
    let alive = true;
    setEvents([]);
    setMode(null);
    setFilter('');
    setLoading(true);
    api
      .get<{ prospect: Prospect; events: ItemEvent[] }>(`/api/prospects/${ctx.prospectId}/items`)
      .then(({ prospect, events: ev }) => {
        if (!alive) return;
        upsertProspect(prospect);
        setEvents(ev);
        const list = flowItems(prospect);
        if (ctx.mode === 'po') startPo(list, prospect);
        if (ctx.mode === 'kirim') startKirim(list);
      })
      .catch((err) => alive && toast(err instanceof Error ? err.message : 'Gagal memuat status item', 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx?.prospectId, ctx?.mode]);

  if (!ctx) return null;

  async function save(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await api.post<{ prospect: Prospect; events: ItemEvent[] }>(`/api/prospects/${ctx!.prospectId}/items`, body);
      upsertProspect(res.prospect);
      setEvents(res.events);
      toast(okMsg, 'success');
      return res.prospect;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function savePo() {
    if (!noPo.trim()) return toast('No. PO wajib diisi', 'error');
    const p = await save({ action: 'po', noPo: noPo.trim(), tglPO, qty: poDraft }, 'Qty PO per item tersimpan');
    if (!p) return;
    setMode(null);
    // Already at DO: go straight on to what was delivered.
    if (num(p.status) === 5 && ctx?.mode) {
      const list = flowItems(p);
      if (list.some((i) => !i.sentConfirmed && (i.po || 0) > 0)) startKirim(list);
    }
  }
  async function saveKirim() {
    if (!noDo.trim()) return toast('No. DO / surat jalan wajib diisi', 'error');
    const p = await save({ action: 'kirim', noDo: noDo.trim(), tgl: tglDo, qty: doDraft }, 'Pengiriman tercatat');
    if (p) setMode(null);
  }

  const title = record ? `Status Item & Riwayat — ${record.customer}` : 'Status Item & Riwayat';
  const qtyText = (n: number | null, it: FlowItem) => (n === null ? '–' : `${formatQty(n)} ${it.satuan}`);
  const shown = filter ? events.filter((e) => e.items.some((x) => x.itemId === filter)) : events;
  const poSumKg = items.reduce((s, i) => s + Math.min(i.offered, Math.max(0, num(poDraft[i.itemId]))) * i.kgPc, 0);

  return (
    <Modal
      show={show}
      onClose={close}
      title={title}
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={close}>
          Tutup
        </button>
      }
    >
      {!record ? (
        <div className="field-note">{loading ? 'Memuat…' : 'Prospek tidak ditemukan.'}</div>
      ) : (
        <>
          <div className="toolbar-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13 }}>
              <span className={`badge ${STATUS_META[status]?.color || 'slate'}`}>{status} · {STATUS_META[status]?.label ?? '-'}</span>{' '}
              {record.cabang || '-'} · SE {record.se || '-'} · Penawaran {record.tglPenawaran ? formatDateID(record.tglPenawaran) : '-'}
              {record.noPo && <> · PO <b>{record.noPo}</b>{record.tglPO ? ` (${formatDateID(record.tglPO)})` : ''}</>}
            </div>
            {canEdit && won && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || loading} onClick={() => startPo()}>
                  {allConfirmed ? 'Koreksi qty PO' : 'Konfirmasi qty PO per item'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy || loading || !allConfirmed || !outstanding}
                  title={!allConfirmed ? 'Konfirmasi qty PO per item dulu' : !outstanding ? 'Semua PO sudah terkirim' : ''}
                  onClick={() => startKirim()}
                >
                  Catat Pengiriman (DO)
                </button>
              </div>
            )}
          </div>
          {!won && status !== 6 && (
            <div className="import-summary" style={{ marginTop: 0, marginBottom: 12 }}>
              Belum PO. Qty per item dikonfirmasi setelah status dipindah ke <b>PO / Kontrak</b> (No. PO &amp; QCD wajib).
            </div>
          )}
          {won && !allConfirmed && mode !== 'po' && (
            <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 12 }}>
              Qty PO per item belum dikonfirmasi — angka PO{status === 5 ? ' dan terkirim' : ''} di bawah masih <b>perkiraan</b> (dianggap penuh sesuai penawaran).
            </div>
          )}

          {mode === 'po' && (
            <div className="if-panel po">
              <div className="if-panel-head">
                <b>Konfirmasi PO — qty per item</b>
                <span>Terisi penuh sesuai penawaran. Ubah hanya item yang berbeda; selisihnya tercatat sebagai <b>tidak di-PO</b>.</span>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 260px))', marginBottom: 10 }}>
                <div>
                  <label>No. PO / Kontrak</label>
                  <input type="text" value={noPo} onChange={(e) => setNoPo(e.target.value)} />
                </div>
                <div>
                  <label>Tgl. PO</label>
                  <input type="date" value={tglPO} onChange={(e) => setTglPO(e.target.value)} />
                </div>
              </div>
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table if-nowrap" style={{ minWidth: 640 }}>
                  <thead>
                    <tr><th>Material</th><th style={{ textAlign: 'right' }}>Ditawarkan</th><th style={{ width: 130 }}>Qty PO</th><th style={{ textAlign: 'right' }}>Tidak di-PO</th></tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const v = poDraft[it.itemId] ?? '';
                      const diff = it.offered - Math.min(it.offered, Math.max(0, num(v)));
                      return (
                        <tr key={it.itemId}>
                          <td>{it.label}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{qtyText(it.offered, it)}</td>
                          <td>
                            <input type="number" min={0} max={it.offered} step="any" aria-label={`Qty PO ${it.label}`} value={v} onChange={(e) => setPoDraft((d) => ({ ...d, [it.itemId]: e.target.value }))} style={{ width: 110, textAlign: 'right' }} />
                          </td>
                          <td className="mono" style={{ textAlign: 'right', color: diff > 0 ? 'var(--rust-600)' : 'var(--text-soft)', fontWeight: diff > 0 ? 700 : 400 }}>{diff > 0 ? qtyText(diff, it) : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="if-panel-foot">
                <span>{totals.offKg > 0 && <>PO <b className="mono">{formatTon(poSumKg)}</b> dari ditawarkan <b className="mono">{formatTon(totals.offKg)}</b></>}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode(null)}>Batal</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={savePo}>{busy ? 'Menyimpan…' : 'Simpan PO'}</button>
                </span>
              </div>
            </div>
          )}

          {mode === 'kirim' && (
            <div className="if-panel kirim">
              <div className="if-panel-head">
                <b>Catat Pengiriman</b>
                <span>Qty kirim terisi sisa PO. Pengiriman bertahap dicatat beberapa kali; sisanya tetap terbuka.</span>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 260px))', marginBottom: 10 }}>
                <div>
                  <label>No. DO / Surat Jalan</label>
                  <input type="text" value={noDo} onChange={(e) => setNoDo(e.target.value)} placeholder="cth. DO-2026-1043" />
                </div>
                <div>
                  <label>Tgl. Kirim</label>
                  <input type="date" value={tglDo} onChange={(e) => setTglDo(e.target.value)} />
                </div>
              </div>
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table if-nowrap" style={{ minWidth: 640 }}>
                  <thead>
                    <tr><th>Material</th><th style={{ textAlign: 'right' }}>Qty PO</th><th style={{ textAlign: 'right' }}>Sudah dikirim</th><th style={{ width: 130 }}>Kirim sekarang</th><th style={{ textAlign: 'right' }}>Sisa</th></tr>
                  </thead>
                  <tbody>
                    {items.filter((it) => (it.po || 0) > 0).map((it) => {
                      const sent = it.sentConfirmed ? it.sent : 0;
                      const max = Math.max(0, (it.po || 0) - sent);
                      const v = doDraft[it.itemId] ?? '';
                      const rest = max - Math.min(max, Math.max(0, num(v)));
                      return (
                        <tr key={it.itemId}>
                          <td>{it.label}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{qtyText(it.po, it)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{qtyText(sent, it)}</td>
                          <td>
                            <input type="number" min={0} max={max} step="any" disabled={max === 0} aria-label={`Qty kirim ${it.label}`} value={v} onChange={(e) => setDoDraft((d) => ({ ...d, [it.itemId]: e.target.value }))} style={{ width: 110, textAlign: 'right' }} />
                          </td>
                          <td className="mono" style={{ textAlign: 'right', color: rest > 0 ? 'var(--amber-600)' : 'var(--green-600)', fontWeight: rest > 0 ? 700 : 400 }}>{rest > 0 ? qtyText(rest, it) : 'Lunas'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="if-panel-foot">
                <span>{status === 4 && 'Status prospek pindah ke DO saat pengiriman pertama disimpan.'}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode(null)}>Batal</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveKirim}>{busy ? 'Menyimpan…' : 'Simpan Pengiriman'}</button>
                </span>
              </div>
            </div>
          )}

          <div className="if-grid">
            <div>
              <div className="if-sec-head">
                <b>Status Item</b>
                <FlowLegend />
              </div>
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table if-nowrap" style={{ minWidth: 560 }}>
                  <thead>
                    <tr><th>Material</th><th style={{ textAlign: 'right' }}>Ditawarkan</th><th style={{ textAlign: 'right' }}>PO</th><th style={{ textAlign: 'right' }}>Terkirim</th><th style={{ width: 120 }}>Alur</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.itemId} className={`if-row${filter === it.itemId ? ' sel' : ''}`} onClick={() => setFilter((f) => (f === it.itemId ? '' : it.itemId))} title="Tampilkan riwayat item ini">
                        <td>{it.label}{it.fab && <span className="badge amber" style={{ marginLeft: 6 }}>Line 05</span>}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{qtyText(it.offered, it)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{qtyText(it.po, it)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{it.po === null ? '–' : qtyText(it.sent, it)}</td>
                        <td><FlowBar it={it} /></td>
                        <td>
                          <span className={`badge ${ITEM_STATE_META[it.state].color}`}>{ITEM_STATE_META[it.state].label}</span>
                          {it.estimated && <span className="if-est" title="Belum dikonfirmasi per item — dihitung penuh dari status prospek">perkiraan</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totals.offKg > 0 && (
                    <tfoot>
                      <tr>
                        <td><b>Total tonase</b></td>
                        <td className="mono" style={{ textAlign: 'right' }}><b>{formatTon(totals.offKg)}</b></td>
                        <td className="mono" style={{ textAlign: 'right' }}><b>{won ? formatTon(totals.poKg) : '–'}</b></td>
                        <td className="mono" style={{ textAlign: 'right' }}><b>{won ? formatTon(totals.sentKg) : '–'}</b></td>
                        <td colSpan={2} style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                          {won ? `PO ${Math.round((totals.poKg / totals.offKg) * 100)}% dari penawaran · terkirim ${totals.poKg ? Math.round((totals.sentKg / totals.poKg) * 100) : 0}% dari PO` : 'Menunggu PO'}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div>
              <div className="if-sec-head">
                <b>Riwayat Item</b>
                <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260 }} aria-label="Filter item">
                  <option value="">Semua item</option>
                  {items.map((it) => (
                    <option key={it.itemId} value={it.itemId}>{it.label}</option>
                  ))}
                </select>
              </div>
              {loading ? (
                <div className="field-note">Memuat riwayat…</div>
              ) : shown.length === 0 ? (
                <div className="field-note">
                  Belum ada riwayat{filter ? ' untuk item ini' : ''}. Riwayat mulai tercatat saat penawaran ditandai terkirim, qty PO dikonfirmasi, atau pengiriman dicatat.
                </div>
              ) : (
                <ol className="if-timeline">
                  {shown.map((e) => {
                    const meta = EVENT_META[e.type] || EVENT_META.revisi;
                    const lines = filter ? e.items.filter((x) => x.itemId === filter) : e.items;
                    return (
                      <li key={e.id}>
                        <div className="if-when">
                          <b>{e.tgl ? formatDateID(e.tgl) : formatDateID(e.createdAt.slice(0, 10))}</b>
                          <span>{e.actorName}</span>
                        </div>
                        <span className={`if-dot ${meta.color}`} aria-hidden="true" />
                        <div className="if-what">
                          <div>
                            <span className={`badge ${meta.color}`}>{meta.label}</span> <b>{e.title}</b>
                          </div>
                          {lines.map((x, i) => (
                            <div key={i} className="if-line">
                              {x.label}:{' '}
                              {e.type === 'revisi'
                                ? `${formatQty(x.from ?? 0)} → ${formatQty(x.to ?? 0)}`
                                : e.type === 'po'
                                  ? `${formatQty(x.qty ?? 0)} dari ${formatQty(x.of ?? 0)}`
                                  : e.type === 'kirim'
                                    ? `${formatQty(x.qty ?? 0)}${x.sisa ? ` (sisa ${formatQty(x.sisa)})` : ' (lunas)'}`
                                    : formatQty(x.qty ?? 0)}
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
