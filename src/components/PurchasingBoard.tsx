'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { IconEdit, IconTrash, IconWa } from './icons';
import { WORKFLOW_META, WORKFLOW_STAGES, workflowStage } from '@/lib/purchasing-workflow';
import { formatDateID, formatDateTimeID, formatRupiah, num, todayStr } from '@/lib/format';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Fupa, PurchDocType, Rfq, RfqItem } from '@/lib/types';

type Tab = 'dashboard' | 'masuk' | 'vendor';

/** One row in the combined RFQ + FUP A worklist. */
interface PurchDoc {
  id: string;
  jenis: PurchDocType;
  noDoc: string;
  tglDoc: string;
  cabang: string;
  customer: string;
  requestedBy: string;
  itemCount: number;
  /** First material plus a "+N lainnya" tail — mirrors purchMaterialSummary(). */
  materialSummary: string;
  purchStatus: number;
  /** Sales-side document status; 'Selesai' short-circuits the workflow stage. */
  status: Rfq['status'];
  purchNotes: string | null;
  sentToPurchasingAt: string | null;
  openedByPurchasingAt: string | null;
  noQuote: boolean;
  /** FUP A only — how the shared stager knows a FUP A has been answered. */
  jawabanFupaDikirim?: boolean;
  sourceNoRfq?: string;
  items: RfqItem[];
}

function toDoc(r: Rfq | Fupa, jenis: PurchDocType): PurchDoc {
  const isRfq = jenis === 'RFQ';
  return {
    id: r.id,
    jenis,
    noDoc: (isRfq ? (r as Rfq).noRfq : (r as Fupa).noFupa) || '',
    tglDoc: (isRfq ? (r as Rfq).tglRfq : (r as Fupa).tglFupa) || '',
    cabang: r.cabang || '',
    customer: r.customer || '',
    requestedBy: r.requestedBy || '',
    itemCount: r.items?.length ?? 0,
    materialSummary: (() => {
      const items = r.items ?? [];
      if (items.length === 0) return '-';
      const extra = items.length > 1 ? ` (+${items.length - 1} lainnya)` : '';
      return `${items[0].material || '-'}${extra}`;
    })(),
    purchStatus: r.purchStatus ?? 0,
    status: r.status,
    purchNotes: r.purchNotes,
    sentToPurchasingAt: r.sentToPurchasingAt,
    openedByPurchasingAt: r.openedByPurchasingAt,
    noQuote: r.noQuote,
    jawabanFupaDikirim: isRfq ? undefined : (r as Fupa).jawabanFupaDikirim,
    sourceNoRfq: isRfq ? undefined : (r as Fupa).sourceNoRfq || '-',
    items: r.items ?? [],
  };
}

// Line values are freeform text Sales types in (e.g. '01'..'05'), not a fixed
// enum, so lines get a *stable* color by hashing the value into a fixed
// palette rather than assigning colors in encounter order — the latter would
// shift every time the underlying data changes.
const LINE_PALETTE = ['steel', 'amber', 'green', 'rust', 'violet', 'teal', 'pink', 'slate'];

function lineColor(line: string): string {
  if (!line) return 'slate';
  let hash = 0;
  for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) >>> 0;
  return LINE_PALETTE[hash % LINE_PALETTE.length];
}

function recordLines(d: PurchDoc): string[] {
  return Array.from(new Set(d.items.map((m) => (m.line || '').trim()).filter(Boolean)));
}

function recordLineKey(d: PurchDoc): string {
  const lines = recordLines(d);
  return lines.length > 0 ? lines.join(', ') : '(Tanpa Line)';
}

/** One row of the worklist, shared by the flat and grouped renderings. */
function PurchasingRow({ d, chatCount, onDetail }: { d: PurchDoc; chatCount: number; onDetail: (d: PurchDoc) => void }) {
  const meta = WORKFLOW_META[workflowStage(d)];
  const lines = recordLines(d);
  return (
    <tr>
      <td><span className={`badge ${d.jenis === 'RFQ' ? 'steel' : 'amber'}`}>{d.jenis === 'RFQ' ? 'RFQ' : 'FUP A'}</span></td>
      <td className="mono" style={{ fontWeight: 600 }}>{d.noDoc || '-'}</td>
      <td>{formatDateID(d.tglDoc)}</td>
      <td>
        {lines.length === 0
          ? '-'
          : lines.map((ln) => (
              <span key={ln} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8 }}>
                <span className={`line-dot ${lineColor(ln)}`} />
                {ln}
              </span>
            ))}
      </td>
      <td>{d.cabang || '-'}</td>
      <td>{d.customer || '-'}</td>
      <td>{d.materialSummary}</td>
      <td className="center">{chatCount ? <span className="item-chat-bubble">{chatCount > 9 ? '9+' : chatCount}</span> : '-'}</td>
      <td>{d.requestedBy || '-'}</td>
      <td className="center">{d.itemCount}</td>
      <td><span className={`badge ${meta.color}`}>{meta.label}</span></td>
      <td>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onDetail(d)}>Detail</button>
      </td>
    </tr>
  );
}

/**
 * The purchasing worklist. Rendered full-page for the purchasing role and
 * inside a modal (readOnly) for everyone else — one tree rather than the
 * prototype's two parallel implementations of the same data.
 */
export function PurchasingBoard({
  readOnly = false,
  standalone = false,
}: {
  readOnly?: boolean;
  /** True on the dedicated /purchasing page; false inside the monitor modal.
      The single-file app words the empty dashboard differently in each. */
  standalone?: boolean;
}) {
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const vendors = useDataStore((s) => s.vendors);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const upsertFupa = useDataStore((s) => s.upsertFupa);
  const toast = useDataStore((s) => s.toast);

  const openModal = useUiStore((s) => s.openModal);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [jenisFilter, setJenisFilter] = useState('');
  const [masukView, setMasukView] = useState<'table' | 'card'>('table');
  const [groupBy, setGroupBy] = useState<'' | 'line' | 'status'>('');
  const [sortBy, setSortBy] = useState<'waktu' | 'line'>('waktu');
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<PurchDoc | null>(null);

  const docs = useMemo(
    () =>
      [
        ...rfqs.map((r) => toDoc(r, 'RFQ')),
        ...fupas.map((f) => toDoc(f, 'FUPA')),
      ].sort((a, b) => (b.tglDoc || '').localeCompare(a.tglDoc || '')),
    [rfqs, fupas],
  );

  /**
   * Opening a document is what advances it to stage 2 "Diterima". Fire-and-forget
   * and Purchasing/Admin only — the route ignores repeats, and a non-Purchasing
   * viewer must not make the document look picked up.
   */
  const openDetail = useCallback(
    (d: PurchDoc) => {
      setDetail(d);
      if (readOnly || d.openedByPurchasingAt) return;
      const url = d.jenis === 'RFQ' ? `/api/rfqs/${d.id}` : `/api/fupas/${d.id}`;
      api
        .patch<{ rfq?: Rfq; fupa?: Fupa }>(url, { action: 'mark-opened' })
        .then((res) => {
          if (res.rfq) upsertRfq(res.rfq);
          if (res.fupa) upsertFupa(res.fupa);
        })
        .catch(() => {});
    },
    [readOnly, upsertRfq, upsertFupa],
  );

  // A notification toast can ask for one document's detail. Runs off `docs` so
  // it still resolves when the request lands before bootstrap has filled the
  // stores; cleared once consumed so re-opening the board doesn't reopen it.
  const purchDetailCtx = useUiStore((s) => s.purchDetailCtx);
  useEffect(() => {
    if (!purchDetailCtx) return;
    const target = docs.find((d) => d.jenis === purchDetailCtx.jenis && d.id === purchDetailCtx.id);
    if (!target) return;
    setTab('masuk');
    openDetail(target);
    useUiStore.setState({ purchDetailCtx: null });
  }, [purchDetailCtx, docs, openDetail]);

  const filtered = useMemo(() => {
    let l = docs;
    if (jenisFilter) l = l.filter((d) => d.jenis === jenisFilter);
    if (statusFilter !== '') l = l.filter((d) => String(workflowStage(d)) === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      l = l.filter((d) => d.noDoc.toLowerCase().includes(q) || d.customer.toLowerCase().includes(q) || d.cabang.toLowerCase().includes(q));
    }
    return l;
  }, [docs, jenisFilter, statusFilter, search]);

  // groupBy 'line'/'status' takes over ordering entirely (rows are shown
  // section by section, newest first within each section); otherwise the flat
  // list follows sortBy — 'waktu' is the docs default (newest tglDoc first),
  // 'line' re-sorts that same list by line instead.
  const sortedFlat = useMemo(() => {
    if (sortBy === 'line') {
      return [...filtered].sort(
        (a, b) => recordLineKey(a).localeCompare(recordLineKey(b)) || (b.tglDoc || '').localeCompare(a.tglDoc || ''),
      );
    }
    return filtered;
  }, [filtered, sortBy]);

  const groupedSections = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, PurchDoc[]>();
    filtered.forEach((d) => {
      const key = groupBy === 'line' ? recordLineKey(d) : WORKFLOW_META[workflowStage(d)].label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  // Dashboard KPI tallies, on the same 5 automatic stages the worklist shows.
  const stageCounts = useMemo(() => {
    const by: Record<number, number> = {};
    docs.forEach((d) => { const st = workflowStage(d); by[st] = (by[st] || 0) + 1; });
    return by;
  }, [docs]);

  // Unread discussion per document, for the "Diskusi" column. Two requests for
  // the whole worklist rather than one per row; refreshed when a message lands.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      (['rfq', 'fupa'] as const).forEach((entity) => {
        api
          .get<{ counts: Record<string, number> }>(`/api/item-chat?entity=${entity}&counts=1`)
          .then((d) => {
            if (cancelled) return;
            const jenis = entity === 'rfq' ? 'RFQ' : 'FUPA';
            setChatCounts((prev) => {
              const next = { ...prev };
              Object.entries(d.counts || {}).forEach(([id, n]) => { next[`${jenis}:${id}`] = n; });
              return next;
            });
          })
          .catch(() => {});
      });
    };
    load();

    const sock = getSocket();
    const onMessage = () => load();
    sock.on('itemchat:message', onMessage);
    return () => {
      cancelled = true;
      sock.off('itemchat:message', onMessage);
    };
  }, []);

  const VENDOR_HEADER = ['NAMA VENDOR', 'PIC', 'NO WHATSAPP', 'EMAIL', 'KATEGORI', 'ALAMAT', 'CATATAN'];
  const VENDOR_COLS = [{ wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 36 }, { wch: 26 }];

  async function exportVendors() {
    if (vendors.length === 0) return toast('Tidak ada data vendor untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [VENDOR_HEADER];
    vendors.forEach((v) => aoa.push([v.nama || '', v.pic || '', v.wa || '', v.email || '', v.kategori || '', v.alamat || '', v.catatan || '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = VENDOR_COLS;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendor');
    XLSX.writeFile(wb, `CRM_Vendor_Export_${todayStr()}.xlsx`);
  }

  async function vendorTemplate() {
    const XLSX = await import('xlsx');
    const example = ['PT. Baja Sejahtera', 'Bapak Budi', '08123456789', 'sales@bajasejahtera.com', 'Plate, Round Bar', 'Jl. Industri No.1, Bekasi', 'Lead time 2 minggu'];
    const ws = XLSX.utils.aoa_to_sheet([VENDOR_HEADER, example]);
    ws['!cols'] = VENDOR_COLS;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Vendor');
    XLSX.writeFile(wb, 'CRM_Vendor_Template.xlsx');
    toast('Template vendor berhasil diunduh', 'success');
  }

  async function setNoQuote(doc: PurchDoc, noQuote: boolean) {
    try {
      const url = doc.jenis === 'RFQ' ? `/api/rfqs/${doc.id}` : `/api/fupas/${doc.id}`;
      const res = await api.patch<{ rfq?: Rfq; fupa?: Fupa }>(url, { noQuote });
      if (res.rfq) upsertRfq(res.rfq);
      if (res.fupa) upsertFupa(res.fupa);
      setDetail((d) => (d ? { ...d, noQuote } : d));
      toast(noQuote ? 'Ditandai No Quote' : 'Tanda No Quote dibatalkan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memperbarui No Quote', 'error');
    }
  }

  return (
    <div>
      <div className={`purch-tabs${standalone ? ' pagebar' : ''}`}>
        <button type="button" className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button type="button" className={tab === 'masuk' ? 'active' : ''} onClick={() => setTab('masuk')}>Permintaan Masuk</button>
        <button type="button" className={tab === 'vendor' ? 'active' : ''} onClick={() => setTab('vendor')}>Database Vendor</button>
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="kpi-grid">
            <div className="kpi steel"><div className="label">Total RFQ</div><div className="value">{rfqs.length}</div></div>
            <div className="kpi amber"><div className="label">Total FUP A</div><div className="value">{fupas.length}</div></div>
            {WORKFLOW_STAGES.map((st) => (
              <div key={st} className={`kpi ${WORKFLOW_META[st].color}`}>
                <div className="label">{WORKFLOW_META[st].label.replace(/^\d+\.\s*/, '')}</div>
                <div className="value">{stageCounts[st] || 0}</div>
              </div>
            ))}
            <div className="kpi steel"><div className="label">Total Vendor</div><div className="value">{vendors.length}</div></div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Permintaan Terbaru</h2></div>
            <div className="panel-body">
          {docs.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px 10px' }}>
              <h3>Belum ada data</h3>
              <p>{standalone ? 'RFQ dan FUP A dari Sales akan otomatis muncul di sini.' : 'Belum ada RFQ/FUP A pada cakupan Anda.'}</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table">
                <thead>
                  <tr><th>Jenis</th><th>No.</th><th>Tanggal</th><th>Cabang</th><th>Customer</th><th>Material</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {docs.slice(0, 8).map((d) => {
                    const meta = WORKFLOW_META[workflowStage(d)];
                    return (
                      <tr key={`recent-${d.jenis}-${d.id}`}>
                        <td><span className={`badge ${d.jenis === 'RFQ' ? 'steel' : 'amber'}`}>{d.jenis === 'RFQ' ? 'RFQ' : 'FUP A'}</span></td>
                        <td className="mono">{d.noDoc || '-'}</td>
                        <td>{formatDateID(d.tglDoc)}</td>
                        <td>{d.cabang || '-'}</td>
                        <td>{d.customer || '-'}</td>
                        <td>{d.materialSummary}</td>
                        <td><span className={`badge ${meta.color}`}>{meta.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
            </div>
          </div>
          {readOnly && (
            <div className="import-summary">Tampilan ini hanya-baca; perubahan dilakukan oleh tim Purchasing.</div>
          )}
        </>
      )}

      {tab === 'masuk' && (
        <>
          <div className="toolbar-row">
            <select className="btn-sm" value={jenisFilter} onChange={(e) => setJenisFilter(e.target.value)}>
              <option value="">Semua Jenis</option>
              <option value="RFQ">RFQ</option>
              <option value="FUPA">FUP A</option>
            </select>
            <select className="btn-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Semua Status</option>
              {Object.entries(WORKFLOW_META).map(([k, meta]) => (
                <option key={k} value={k}>{meta.label}</option>
              ))}
            </select>
            <input type="search" className="search-grow" placeholder="Cari No dokumen / customer / cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="view-toggle">
              <button type="button" className={masukView === 'table' ? 'active' : ''} onClick={() => setMasukView('table')}>Tabel</button>
              <button type="button" className={masukView === 'card' ? 'active' : ''} onClick={() => setMasukView('card')}>Kartu</button>
            </div>
          </div>
          {masukView === 'table' && (
            <div className="toolbar-row">
              <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 600 }}>Kelompokkan:</label>
              <select className="btn-sm" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
                <option value="">Tidak dikelompokkan</option>
                <option value="line">Berdasar Line</option>
                <option value="status">Berdasar Status</option>
              </select>
              <label style={{ fontSize: 12, color: 'var(--text-soft)', fontWeight: 600, marginLeft: 10 }}>Urutkan:</label>
              <select className="btn-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} disabled={!!groupBy}>
                <option value="waktu">Waktu Terbaru</option>
                <option value="line">Line</option>
              </select>
            </div>
          )}
          <div className="import-summary">Menampilkan <b>{filtered.length}</b> dari <b>{docs.length}</b> permintaan</div>

          {filtered.length > 0 && masukView === 'card' ? (
            <div className="purch-card-grid">
              {filtered.map((d) => {
                const meta = WORKFLOW_META[workflowStage(d)];
                const head = d.items.slice(0, 2).map((m) => `${m.line || '-'} · ${m.material || '-'}`);
                return (
                  <div key={`card-${d.jenis}-${d.id}`} className="purch-card" onClick={() => openDetail(d)}>
                    <div className="purch-card-head">
                      <span className={`badge ${d.jenis === 'RFQ' ? 'steel' : 'amber'}`}>{d.jenis === 'RFQ' ? 'RFQ' : 'FUP A'}</span>
                      <span className={`badge ${meta.color}`}>{meta.label}</span>
                    </div>
                    <div className="purch-card-no mono">{d.noDoc || '-'}</div>
                    <div className="purch-card-meta">
                      <span>{formatDateID(d.tglDoc)} · {d.cabang || '-'}</span>
                      <span>{d.customer || '-'}</span>
                    </div>
                    <div className="purch-card-mat">
                      {head.map((h, i) => <div key={i}>{h}</div>)}
                      {d.items.length > 2 && <div className="text-muted">+{d.items.length - 2} material lainnya</div>}
                    </div>
                    <div className="purch-card-foot">
                      <span className="text-muted">{chatCounts[`${d.jenis}:${d.id}`] ? `${chatCounts[`${d.jenis}:${d.id}`]} pesan baru` : 'Tidak ada pesan baru'}</span>
                      <button type="button" className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openDetail(d); }}>Detail</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '34px 10px' }}>
              <h3>Belum ada data</h3>
              <p>Tidak ada RFQ/FUP A yang cocok dengan filter saat ini.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Jenis</th><th>No.</th><th>Tanggal</th><th>Line</th><th>Cabang</th><th>Customer</th><th>Material</th><th>Diskusi</th><th>Diminta Oleh</th><th>Item</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {groupedSections
                    ? groupedSections.map(([sectionLabel, rows]) => (
                        <Fragment key={sectionLabel}>
                          <tr className="group-header-row">
                            <td colSpan={12}>
                              {groupBy === 'line' && sectionLabel !== '(Tanpa Line)' && (
                                <span className={`line-dot ${lineColor(sectionLabel.split(', ')[0])}`} />
                              )}
                              {sectionLabel}{' '}
                              <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-soft)' }}>({rows.length})</span>
                            </td>
                          </tr>
                          {rows.map((d) => (
                            <PurchasingRow key={`${d.jenis}-${d.id}`} d={d} chatCount={chatCounts[`${d.jenis}:${d.id}`] || 0} onDetail={openDetail} />
                          ))}
                        </Fragment>
                      ))
                    : sortedFlat.map((d) => <PurchasingRow key={`${d.jenis}-${d.id}`} d={d} chatCount={chatCounts[`${d.jenis}:${d.id}`] || 0} onDetail={openDetail} />)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'vendor' && (
        <>
          {!readOnly && (
            <div className="toolbar-row">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  useUiStore.setState({ vendorEditId: null });
                  openModal('vendorForm');
                }}
              >
                + Tambah Vendor
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  useUiStore.setState({ importTarget: 'vendor' });
                  openModal('import');
                }}
              >
                Import Excel
              </button>
              <button className="btn btn-outline btn-sm" onClick={exportVendors}>Export Excel</button>
              <button className="btn btn-outline btn-sm" onClick={vendorTemplate}>Unduh Template</button>
              <span className="hint">Menampilkan {vendors.length} dari {vendors.length} vendor</span>
            </div>
          )}
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            {vendors.length === 0 ? (
              <div className="empty-state" style={{ padding: '34px 10px' }}>
                <h3>Belum ada vendor</h3>
                <p>Klik &quot;Tambah Vendor&quot; untuk mulai membangun database vendor.</p>
              </div>
            ) : (
              <table className="simple-table">
                <thead>
                  <tr><th>Nama Vendor</th><th>PIC</th><th>WhatsApp</th><th>Email</th><th>Kategori</th><th></th></tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.nama}</td>
                      <td>{v.pic || '-'}</td>
                      <td className="mono">{v.wa || '-'}</td>
                      <td>{v.email || '-'}</td>
                      <td>{v.kategori || '-'}</td>
                      <td>
                        {!readOnly && (
                          <div className="row-actions">
                            <button
                              className="icon-btn"
                              title="Edit"
                              onClick={() => {
                                useUiStore.setState({ vendorEditId: v.id });
                                openModal('vendorForm');
                              }}
                            >
                              <IconEdit />
                            </button>
                            <button
                              className="icon-btn danger"
                              title="Hapus"
                              onClick={() => {
                                useUiStore.setState({
                                  deleteCtx: { mode: 'vendor', id: v.id, title: 'Hapus Vendor', message: `Yakin ingin menghapus vendor "${v.nama}"?` },
                                });
                                openModal('delete');
                              }}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {detail && <PurchDetail doc={detail} readOnly={readOnly} onClose={() => setDetail(null)} onSetNoQuote={setNoQuote} />}
    </div>
  );
}

/** Purchasing's working view of one RFQ / FUP A: status, notes and answer. */
function PurchDetail({
  doc,
  readOnly,
  onClose,
  onSetNoQuote,
}: {
  doc: PurchDoc;
  readOnly: boolean;
  onClose: () => void;
  onSetNoQuote: (doc: PurchDoc, noQuote: boolean) => void;
}) {
  const toast = useDataStore((s) => s.toast);

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,22,28,.45)', display: 'grid', placeItems: 'center', zIndex: 60, padding: 16 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 8, width: 'min(860px, 100%)', maxHeight: '86vh', overflow: 'auto', padding: 18 }}>
        <div className="panel-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <h2 style={{ margin: 0 }}>
            {doc.jenis === 'RFQ' ? 'RFQ' : 'FUP A'} {doc.noDoc || '(tanpa nomor)'}
          </h2>
          <button type="button" className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div><label>No. {doc.jenis === 'RFQ' ? 'RFQ' : 'FUP A'}</label><div className="mono">{doc.noDoc || '-'}</div></div>
          <div><label>Tanggal</label><div>{formatDateID(doc.tglDoc)}</div></div>
          <div><label>Cabang</label><div>{doc.cabang || '-'}</div></div>
          <div><label>Customer</label><div>{doc.customer || '-'}</div></div>
          <div><label>Diminta oleh (Sales)</label><div>{doc.requestedBy || '-'}</div></div>
          <div>
            <label>Dikirim ke Purchasing</label>
            <div>
              {doc.sentToPurchasingAt
                ? <span className="badge green">{formatDateID(doc.sentToPurchasingAt)}</span>
                : <span className="badge slate">Belum dikirim</span>}
            </div>
          </div>
          {doc.jenis === 'FUPA' && (
            <div><label>No. RFQ Rujukan</label><div className="mono">{doc.sourceNoRfq || '-'}</div></div>
          )}
          {/* The old manual purchStatus dropdown lived here. It was removed once the
              automatic stage badge landed: two status systems side by side, both
              with a "Baru" and a "Selesai" meaning different things, read as a bug.
              purchStatus is still written server-side as internal bookkeeping. */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Status Purchasing</label>
            <div>
              <span className={`badge ${WORKFLOW_META[workflowStage(doc)].color}`}>{WORKFLOW_META[workflowStage(doc)].label}</span>
            </div>
            {doc.openedByPurchasingAt && (
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Dibuka Purchasing {formatDateTimeID(doc.openedByPurchasingAt)}
              </div>
            )}
            {!readOnly && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontWeight: 400 }}>
                <input type="checkbox" checked={doc.noQuote} onChange={(e) => onSetNoQuote(doc, e.target.checked)} />
                Tandai <b>No Quote</b> (tidak ada vendor yang bisa memberi harga)
              </label>
            )}
          </div>
        </div>

        <PurchNotes doc={doc} readOnly={readOnly} />

        {doc.jenis === 'FUPA' && (
          <>
        <div style={{ fontWeight: 600, fontSize: 12.5, margin: '16px 0 8px' }}>Detail Material Diminta</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>Line</th><th>Grade</th><th>Material</th><th>Dimensi</th><th>PCS</th>
                <th>Berat (KGS)</th><th>Lokal/Import</th><th>Est. Kebutuhan</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.length === 0 ? (
                <tr><td colSpan={8} className="text-muted">Tidak ada rincian material.</td></tr>
              ) : (
                doc.items.map((mi, idx) => {
                  const dims = [mi.dia && `D${mi.dia}`, mi.thick && `T${mi.thick}`, mi.width && `W${mi.width}`, mi.length && `L${mi.length}`]
                    .filter(Boolean)
                    .join(' x ');
                  return (
                    <tr key={idx}>
                      <td>{mi.line || '-'}</td>
                      <td>{mi.grade || '-'}</td>
                      <td>{mi.material || '-'}</td>
                      <td>{dims || '-'}</td>
                      <td className="center">{mi.pcs || 0}</td>
                      <td className="center">{mi.berat || 0}</td>
                      <td>{mi.lokal || '-'}</td>
                      <td>{mi.estimasi ? formatDateID(String(mi.estimasi)) : '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
          </>
        )}

        {doc.jenis === 'RFQ' && <RfqAnswerPanel rfqId={doc.id} readOnly={readOnly} />}

        {/* The "Penawaran Vendor" block used to sit here — per-vendor quotation
            cards, harga/lead-time inputs, set-winner and delete. Removed on
            request. The `quotations` table and its API are deliberately kept so
            existing history survives and the block can be restored by putting
            the UI back. */}

      </div>
    </div>
  );
}


/**
 * Purchasing's answer back to Sales: harga + keterangan per material line,
 * then
 * "Kirim Jawaban". Ported from the single-file app's RFQ answer table.
 */
function RfqAnswerPanel({ rfqId, readOnly }: { rfqId: string; readOnly: boolean }) {
  const rfqs = useDataStore((s) => s.rfqs);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const rfq = rfqs.find((r) => r.id === rfqId);
  const [items, setItems] = useState<RfqItem[]>(rfq?.items ?? []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(rfq?.items ?? []);
  }, [rfq?.id, rfq?.items]);

  if (!rfq) return null;
  // Mirrors auth.ts#canEditRfqAnswer, which the PATCH route enforces. Deliberately
  // NOT gated on `readOnly`: gm reaches this panel through the monitor modal, which
  // is read-only for vendors/quotations/status, yet gm may still fill in the answer.
  const canAnswer = !!currentUser && ['purchasing', 'admin', 'gm'].includes(currentUser.role);

  function setItem(idx: number, patch: Partial<RfqItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save(action: 'answer' | 'send-jawaban') {
    setBusy(true);
    try {
      const res = await api.patch<{ rfq: Rfq }>(`/api/rfqs/${rfqId}`, { action, items });
      upsertRfq(res.rfq);
      toast(action === 'send-jawaban' ? 'Jawaban RFQ dikirim ke Sales' : 'Jawaban Purchasing disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan jawaban', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ marginBottom: 6 }}>Jawaban Purchasing</h4>
      <div className="import-summary" style={{ marginTop: 0 }}>
        Jawaban RFQ ke Sales:{' '}
        {rfq.jawabanRfqDikirim ? (
          <span className="badge green">Terkirim {formatDateID(rfq.jawabanRfqAt)}</span>
        ) : (
          <span className="badge slate">Belum Dikirim</span>
        )}
      </div>
      <table className="simple-table" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Line</th><th>Grade</th><th>Material</th><th>Dimensi</th><th>PCS</th>
            <th>Berat (KGS)</th><th>Lokal/Import</th><th>Est. Kebutuhan</th>
            <th>Harga (Purchasing)</th><th>Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={10} className="text-muted">Tidak ada rincian material.</td></tr>
          ) : (
            items.map((it, idx) => {
              const dims = [it.dia && `D${it.dia}`, it.thick && `T${it.thick}`, it.width && `W${it.width}`, it.length && `L${it.length}`]
                .filter(Boolean)
                .join(' x ');
              return (
              <tr key={idx}>
                <td>{it.line || '-'}</td>
                <td>{it.grade || '-'}</td>
                <td>{it.material || '-'}</td>
                <td>{dims || '-'}</td>
                <td className="center">{it.pcs || 0}</td>
                <td className="center">{it.berat || 0}</td>
                <td>{it.lokal || '-'}</td>
                <td>{it.estimasi ? formatDateID(String(it.estimasi)) : '-'}</td>
                <td>
                  {canAnswer ? (
                    <input
                      type="number"
                      min="0"
                      className="mono"
                      value={it.hargaPurchasing ?? ''}
                      placeholder="0"
                      onChange={(e) => setItem(idx, { hargaPurchasing: num(e.target.value) })}
                      style={{ width: 120 }}
                    />
                  ) : (
                    <span className="mono">{it.hargaPurchasing ? formatRupiah(it.hargaPurchasing) : '-'}</span>
                  )}
                </td>
                <td>
                  {canAnswer ? (
                    <input
                      type="text"
                      value={it.coo ?? ''}
                      placeholder="cth. Stok ready, indent 2 minggu"
                      onChange={(e) => setItem(idx, { coo: e.target.value })}
                      style={{ width: 240 }}
                    />
                  ) : (
                    it.coo || '-'
                  )}
                </td>
              </tr>
              );
            })
          )}
        </tbody>
      </table>
      {canAnswer && items.length > 0 && (
        <div className="toolbar-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => save('answer')}>
            Simpan Jawaban
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => save('send-jawaban')}>
            Kirim Jawaban ke Sales
          </button>
        </div>
      )}
    </div>
  );
}


/**
 * The two free-text purchasing fields. `purchNotes` stays internal to
 * Purchasing; `purchJawaban` is the written reply the requesting Sales user
 * sees on their own document.
 */
function PurchNotes({ doc, readOnly }: { doc: PurchDoc; readOnly: boolean }) {
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const upsertFupa = useDataStore((s) => s.upsertFupa);
  const toast = useDataStore((s) => s.toast);

  const record = doc.jenis === 'RFQ' ? rfqs.find((r) => r.id === doc.id) : fupas.find((f) => f.id === doc.id);
  const [notes, setNotes] = useState(record?.purchNotes ?? '');
  const [jawaban, setJawaban] = useState(record?.purchJawaban ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNotes(record?.purchNotes ?? '');
    setJawaban(record?.purchJawaban ?? '');
  }, [record?.id, record?.purchNotes, record?.purchJawaban]);

  async function save() {
    setBusy(true);
    try {
      if (doc.jenis === 'RFQ') {
        const res = await api.patch<{ rfq: Rfq }>(`/api/rfqs/${doc.id}`, { action: 'answer', purchNotes: notes, purchJawaban: jawaban });
        upsertRfq(res.rfq);
      } else {
        const res = await api.patch<{ fupa: Fupa }>(`/api/fupas/${doc.id}`, { purchNotes: notes, purchJawaban: jawaban });
        upsertFupa(res.fupa);
      }
      toast('Catatan Purchasing disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan catatan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-grid">
      <div style={{ gridColumn: '1 / -1' }}>
        <label>Catatan Internal Purchasing</label>
        <textarea
          value={notes}
          readOnly={readOnly}
          placeholder="Catatan proses pembelian..."
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label>Jawaban Purchasing ke Sales</label>
        <textarea
          value={jawaban}
          readOnly={readOnly}
          placeholder="cth. Sudah PO ke vendor X, estimasi barang datang 10 hari..."
          onChange={(e) => setJawaban(e.target.value)}
        />
        {/* RFQ tracks its answer through the Harga/Keterangan panel below; FUP A has no
            such columns, so the written reply is what marks it answered. */}
        {doc.jenis === 'FUPA' && (
          <div style={{ marginTop: 6 }}>
            Jawaban ke Sales:{' '}
            {(record as Fupa | undefined)?.jawabanFupaDikirim
              ? <span className="badge green">Terkirim {formatDateID((record as Fupa).jawabanFupaAt)}</span>
              : <span className="badge slate">Belum Dijawab</span>}
          </div>
        )}
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
          Kolom ini terlihat oleh Sales yang mengajukan permintaan, berbeda dari catatan internal di atas.
        </div>
      </div>
      {!readOnly && (
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={save}>
            Simpan Catatan
          </button>
        </div>
      )}
    </div>
  );
}
