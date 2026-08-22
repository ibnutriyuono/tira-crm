'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCheck, IconEdit, IconTrash, IconWa } from './icons';
import { PSTATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah, normalizePhone, num, todayStr } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Fupa, PurchDocType, Quotation, Rfq, RfqItem } from '@/lib/types';

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
  sourceNoRfq?: string;
  items: RfqItem[];
  quoteCount: number;
}

function toDoc(r: Rfq | Fupa, jenis: PurchDocType, quoteCount = 0): PurchDoc {
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
    sourceNoRfq: isRfq ? undefined : (r as Fupa).sourceNoRfq || '-',
    items: r.items ?? [],
    quoteCount,
  };
}

/**
 * The purchasing worklist. Rendered full-page for the purchasing role and
 * inside a modal (readOnly) for everyone else — one tree rather than the
 * prototype's two parallel implementations of the same data.
 */
export function PurchasingBoard({ readOnly = false }: { readOnly?: boolean }) {
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
  const [quoteCounts, setQuoteCounts] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<PurchDoc | null>(null);

  const docs = useMemo(
    () => [...rfqs.map((r) => toDoc(r, 'RFQ')), ...fupas.map((f) => toDoc(f, 'FUPA'))].sort((a, b) => (b.tglDoc || '').localeCompare(a.tglDoc || '')),
    [rfqs, fupas],
  );

  const filtered = useMemo(() => {
    let l = docs;
    if (jenisFilter) l = l.filter((d) => d.jenis === jenisFilter);
    if (statusFilter !== '') l = l.filter((d) => d.purchStatus === Number(statusFilter));
    if (search) {
      const q = search.toLowerCase();
      l = l.filter((d) => d.noDoc.toLowerCase().includes(q) || d.customer.toLowerCase().includes(q) || d.cabang.toLowerCase().includes(q));
    }
    return l;
  }, [docs, jenisFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const by: Record<number, number> = {};
    docs.forEach((d) => { by[d.purchStatus] = (by[d.purchStatus] || 0) + 1; });
    return by;
  }, [docs]);

  // One request for every quotation, tallied per parent — a per-row fetch would
  // be N requests on a long worklist.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ quotations: Quotation[] }>('/api/quotations')
      .then((d) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        d.quotations.forEach((q) => {
          const key = q.rfqId || q.fupaId;
          if (key) counts[key] = (counts[key] || 0) + 1;
        });
        setQuoteCounts(counts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rfqs, fupas]);

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

  async function moveStatus(doc: PurchDoc, purchStatus: number) {
    try {
      const url = doc.jenis === 'RFQ' ? `/api/rfqs/${doc.id}` : `/api/fupas/${doc.id}`;
      const res = await api.patch<{ rfq?: Rfq; fupa?: Fupa }>(url, { purchStatus });
      if (res.rfq) upsertRfq(res.rfq);
      if (res.fupa) upsertFupa(res.fupa);
      setDetail((d) => (d ? { ...d, purchStatus } : d));
      toast('Status pembelian diperbarui', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memperbarui status', 'error');
    }
  }

  return (
    <div>
      <div className="purch-tabs">
        <button type="button" className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button type="button" className={tab === 'masuk' ? 'active' : ''} onClick={() => setTab('masuk')}>Permintaan Masuk</button>
        <button type="button" className={tab === 'vendor' ? 'active' : ''} onClick={() => setTab('vendor')}>Database Vendor</button>
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="purch-kpis">
            <div className="purch-kpi"><div className="k">Total RFQ</div><div className="v">{rfqs.length}</div></div>
            <div className="purch-kpi"><div className="k">Total FUP A</div><div className="v">{fupas.length}</div></div>
            <div className="purch-kpi"><div className="k">Baru</div><div className="v">{counts[0] || 0}</div></div>
            <div className="purch-kpi"><div className="k">Diproses Vendor</div><div className="v">{(counts[1] || 0) + (counts[2] || 0)}</div></div>
            <div className="purch-kpi"><div className="k">Selesai</div><div className="v">{(counts[3] || 0) + (counts[4] || 0)}</div></div>
            <div className="purch-kpi"><div className="k">Dibatalkan</div><div className="v">{counts[5] || 0}</div></div>
            <div className="purch-kpi"><div className="k">Total Vendor</div><div className="v">{vendors.length}</div></div>
          </div>

          <h4 style={{ marginTop: 16, marginBottom: 6 }}>Permintaan Terbaru</h4>
          {docs.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px 10px' }}>
              <h3>Belum ada data</h3>
              <p>Belum ada RFQ/FUP A pada cakupan Anda.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table">
                <thead>
                  <tr><th>Jenis</th><th>No.</th><th>Tanggal</th><th>Cabang</th><th>Customer</th><th>Material</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {docs.slice(0, 8).map((d) => {
                    const meta = PSTATUS_META[d.purchStatus] || PSTATUS_META[0];
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
              {Object.entries(PSTATUS_META).map(([k, meta]) => (
                <option key={k} value={k}>{meta.label}</option>
              ))}
            </select>
            <input type="search" className="search-grow" placeholder="Cari No dokumen / customer / cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="view-toggle">
              <button type="button" className={masukView === 'table' ? 'active' : ''} onClick={() => setMasukView('table')}>Tabel</button>
              <button type="button" className={masukView === 'card' ? 'active' : ''} onClick={() => setMasukView('card')}>Kartu</button>
            </div>
          </div>
          <div className="import-summary">Menampilkan <b>{filtered.length}</b> dari <b>{docs.length}</b> permintaan</div>

          {filtered.length > 0 && masukView === 'card' ? (
            <div className="purch-card-grid">
              {filtered.map((d) => {
                const meta = PSTATUS_META[d.purchStatus] || PSTATUS_META[0];
                const head = d.items.slice(0, 2).map((m) => `${m.line || '-'} · ${m.material || '-'}`);
                return (
                  <div key={`card-${d.jenis}-${d.id}`} className="purch-card" onClick={() => setDetail(d)}>
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
                      <span className="text-muted">{quoteCounts[d.id] ? `${quoteCounts[d.id]} vendor diminta` : 'Belum ada vendor'}</span>
                      <button type="button" className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setDetail(d); }}>Detail</button>
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
                    <th>Jenis</th><th>No.</th><th>Tanggal</th><th>Cabang</th><th>Customer</th><th>Material</th><th>Vendor Diminta</th><th>Diminta Oleh</th><th>Item</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => {
                    const meta = PSTATUS_META[d.purchStatus] || PSTATUS_META[0];
                    return (
                      <tr key={`${d.jenis}-${d.id}`}>
                        <td><span className={`badge ${d.jenis === 'RFQ' ? 'steel' : 'amber'}`}>{d.jenis === 'RFQ' ? 'RFQ' : 'FUP A'}</span></td>
                        <td className="mono" style={{ fontWeight: 600 }}>{d.noDoc || '-'}</td>
                        <td>{formatDateID(d.tglDoc)}</td>
                        <td>{d.cabang || '-'}</td>
                        <td>{d.customer || '-'}</td>
                        <td>{d.materialSummary}</td>
                        <td className="center">{quoteCounts[d.id] ? `${quoteCounts[d.id]} vendor` : '-'}</td>
                        <td>{d.requestedBy || '-'}</td>
                        <td className="center">{d.itemCount}</td>
                        <td><span className={`badge ${meta.color}`}>{meta.label}</span></td>
                        <td>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setDetail(d)}>Detail</button>
                        </td>
                      </tr>
                    );
                  })}
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

      {detail && <PurchDetail doc={detail} readOnly={readOnly} onClose={() => setDetail(null)} onMoveStatus={moveStatus} />}
    </div>
  );
}

/** Quotation workspace for one RFQ / FUP A. */
function PurchDetail({
  doc,
  readOnly,
  onClose,
  onMoveStatus,
}: {
  doc: PurchDoc;
  readOnly: boolean;
  onClose: () => void;
  onMoveStatus: (doc: PurchDoc, status: number) => void;
}) {
  const vendors = useDataStore((s) => s.vendors);
  const toast = useDataStore((s) => s.toast);
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [busy, setBusy] = useState(false);

  const query = doc.jenis === 'RFQ' ? `rfqId=${doc.id}` : `fupaId=${doc.id}`;

  const load = useCallback(async () => {
    try {
      const { quotations } = await api.get<{ quotations: Quotation[] }>(`/api/quotations?${query}`);
      setQuotes(quotations);
    } catch {
      // an empty panel is a fine failure mode here
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  async function requestQuote(channel: 'WhatsApp' | 'Email') {
    if (!vendorId) return toast('Pilih vendor terlebih dahulu', 'error');
    const vendor = vendors.find((v) => v.id === vendorId);
    if (!vendor) return;
    setBusy(true);
    try {
      await api.post('/api/quotations', { vendorId, ...(doc.jenis === 'RFQ' ? { rfqId: doc.id } : { fupaId: doc.id }), channel });
      // Open the outgoing message the same way the prototype did.
      const text = `Mohon penawaran untuk ${doc.noDoc || doc.jenis} - ${doc.customer}`;
      if (channel === 'WhatsApp' && vendor.wa) window.open(`https://wa.me/${normalizePhone(vendor.wa)}?text=${encodeURIComponent(text)}`, '_blank');
      if (channel === 'Email' && vendor.email) window.open(`mailto:${vendor.email}?subject=${encodeURIComponent(`Permintaan Penawaran - ${doc.noDoc}`)}&body=${encodeURIComponent(text)}`, '_blank');
      await load();
      toast(`Permintaan penawaran ke ${vendor.nama} tercatat`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal meminta penawaran', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveQuote(q: Quotation, patch: Partial<Quotation>) {
    try {
      await api.put(`/api/quotations/${q.id}`, patch);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan penawaran', 'error');
    }
  }

  async function setWinner(q: Quotation) {
    try {
      await api.patch(`/api/quotations/${q.id}`, { action: 'set-winner' });
      await load();
      onMoveStatus(doc, 3);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menetapkan pemenang', 'error');
    }
  }

  async function removeQuote(q: Quotation) {
    try {
      await api.del(`/api/quotations/${q.id}`);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus penawaran', 'error');
    }
  }

  const cheapest = quotes.filter((q) => q.harga > 0).sort((a, b) => a.harga - b.harga)[0];

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
          {doc.jenis === 'FUPA' && (
            <div><label>No. RFQ Rujukan</label><div className="mono">{doc.sourceNoRfq || '-'}</div></div>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Status Purchasing</label>
            <select
              value={doc.purchStatus}
              disabled={readOnly}
              onChange={(e) => onMoveStatus(doc, Number(e.target.value))}
              style={{ width: 220 }}
            >
              {Object.entries(PSTATUS_META).map(([k, meta]) => (
                <option key={k} value={k}>{meta.label}</option>
              ))}
            </select>
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

        <h4 style={{ marginTop: 16 }}>Penawaran Vendor ({quotes.length})</h4>
        {quotes.length === 0 ? (
          <div className="import-summary">Belum ada permintaan penawaran untuk dokumen ini.</div>
        ) : (
          quotes.map((q) => (
            <div key={q.id} className={`quote-card${q.isWinner ? ' winner' : ''}`}>
              <div className="quote-card-head">
                <div>
                  <b>{q.vendorNama}</b>{' '}
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    diminta {formatDateID(q.tglDiminta)} via {q.channel}
                  </span>
                  {q.isWinner && <span className="badge green" style={{ marginLeft: 8 }}>Pemenang</span>}
                  {!q.isWinner && cheapest?.id === q.id && <span className="badge amber" style={{ marginLeft: 8 }}>Termurah</span>}
                </div>
                {!readOnly && (
                  <div className="row-actions">
                    {!q.isWinner && q.harga > 0 && (
                      <button className="icon-btn" title="Tetapkan pemenang" onClick={() => setWinner(q)}><IconCheck /></button>
                    )}
                    <button className="icon-btn danger" title="Hapus penawaran" onClick={() => removeQuote(q)}><IconTrash /></button>
                  </div>
                )}
              </div>
              {readOnly ? (
                <div style={{ fontSize: 13 }}>
                  Harga: <b>{q.harga > 0 ? formatRupiah(q.harga) : 'belum masuk'}</b>
                  {q.leadTime > 0 && <> · Lead time {q.leadTime} hari</>}
                  {q.catatan && <> · {q.catatan}</>}
                </div>
              ) : (
                <div className="quote-card-fields">
                  <div>
                    <label>Harga</label>
                    <input type="number" defaultValue={q.harga || ''} onBlur={(e) => saveQuote(q, { harga: num(e.target.value) })} style={{ maxWidth: 160 }} />
                  </div>
                  <div>
                    <label>Lead time (hari)</label>
                    <input type="number" defaultValue={q.leadTime || ''} onBlur={(e) => saveQuote(q, { leadTime: num(e.target.value) })} style={{ maxWidth: 130 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Catatan</label>
                    <input type="text" defaultValue={q.catatan || ''} onBlur={(e) => saveQuote(q, { catatan: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          ))
        )}

      </div>
    </div>
  );
}


/**
 * Purchasing's answer back to Sales: harga + COO per material line, then
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
  // gm may answer too, so this is broader than canEditPurchasing.
  const canAnswer = !readOnly && !!currentUser && ['purchasing', 'admin', 'gm'].includes(currentUser.role);

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
            <th>Harga (Purchasing)</th><th>COO</th>
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
                      placeholder="cth. China"
                      onChange={(e) => setItem(idx, { coo: e.target.value })}
                      style={{ width: 120 }}
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
