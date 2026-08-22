'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCheck, IconTrash, IconWa } from './icons';
import { PSTATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah, normalizePhone, num } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import type { Fupa, PurchDocType, Quotation, Rfq } from '@/lib/types';

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
  purchStatus: number;
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
    purchStatus: r.purchStatus ?? 0,
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

  const [tab, setTab] = useState<Tab>('dashboard');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<PurchDoc | null>(null);

  const docs = useMemo(
    () => [...rfqs.map((r) => toDoc(r, 'RFQ')), ...fupas.map((f) => toDoc(f, 'FUPA'))].sort((a, b) => (b.tglDoc || '').localeCompare(a.tglDoc || '')),
    [rfqs, fupas],
  );

  const filtered = useMemo(() => {
    let l = docs;
    if (statusFilter !== '') l = l.filter((d) => d.purchStatus === Number(statusFilter));
    if (search) {
      const q = search.toLowerCase();
      l = l.filter((d) => d.noDoc.toLowerCase().includes(q) || d.customer.toLowerCase().includes(q) || d.cabang.toLowerCase().includes(q));
    }
    return l;
  }, [docs, statusFilter, search]);

  const counts = useMemo(() => {
    const by: Record<number, number> = {};
    docs.forEach((d) => { by[d.purchStatus] = (by[d.purchStatus] || 0) + 1; });
    return by;
  }, [docs]);

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
        <button type="button" className={tab === 'vendor' ? 'active' : ''} onClick={() => setTab('vendor')}>Vendor</button>
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="purch-kpis">
            {Object.entries(PSTATUS_META).map(([k, meta]) => (
              <div key={k} className="purch-kpi">
                <div className="k">{meta.label}</div>
                <div className="v">{counts[Number(k)] || 0}</div>
              </div>
            ))}
          </div>
          <div className="import-summary">
            Total <b>{docs.length}</b> permintaan dari Sales — <b>{rfqs.length}</b> RFQ dan <b>{fupas.length}</b> FUP A.
            {readOnly && ' Tampilan ini hanya-baca; perubahan dilakukan oleh tim Purchasing.'}
          </div>
        </>
      )}

      {tab === 'masuk' && (
        <>
          <div className="toolbar-row">
            <select className="btn-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Semua Status</option>
              {Object.entries(PSTATUS_META).map(([k, meta]) => (
                <option key={k} value={k}>{meta.label}</option>
              ))}
            </select>
            <input type="search" className="search-grow" placeholder="Cari No dokumen / customer / cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '34px 10px' }}>
              <h3>Belum ada permintaan</h3>
              <p>RFQ dan FUP A dari Sales akan otomatis muncul di sini.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Jenis</th><th>No.</th><th>Tanggal</th><th>Cabang</th><th>Customer</th><th>Diminta Oleh</th><th>Item</th><th>Status</th><th></th>
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
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          {vendors.length === 0 ? (
            <div className="empty-state" style={{ padding: '34px 10px' }}>
              <h3>Belum ada vendor</h3>
              <p>Tambah vendor lewat menu Kelola Vendor agar dapat diminta penawaran.</p>
            </div>
          ) : (
            <table className="simple-table">
              <thead>
                <tr><th>Nama Vendor</th><th>PIC</th><th>Kategori</th><th>No. WhatsApp</th><th>Email</th></tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{v.nama}</td>
                    <td>{v.pic || '-'}</td>
                    <td>{v.kategori || '-'}</td>
                    <td className="mono">{v.wa || '-'}</td>
                    <td>{v.email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
        <div className="import-summary">
          <b>{doc.customer || '-'}</b> · Cabang {doc.cabang || '-'} · {doc.itemCount} item · Diminta oleh {doc.requestedBy || '-'}
        </div>

        {!readOnly && (
          <div className="toolbar-row" style={{ marginTop: 12 }}>
            <select className="btn-sm" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">- Pilih vendor -</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.nama}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => requestQuote('WhatsApp')}>
              <IconWa /> Minta via WA
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => requestQuote('Email')}>
              Minta via Email
            </button>
          </div>
        )}

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

        {!readOnly && (
          <div className="toolbar-row" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Ubah status:</span>
            {Object.entries(PSTATUS_META).map(([k, meta]) => (
              <button
                key={k}
                type="button"
                className={`btn btn-sm ${doc.purchStatus === Number(k) ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => onMoveStatus(doc, Number(k))}
              >
                {meta.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
