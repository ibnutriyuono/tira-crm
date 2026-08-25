'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { AttachNoteBadges } from '../AttachNoteBadges';
import { ItemChatBadge, useItemChatCounts } from '../ItemChatBadge';
import { IconCheck, IconEdit, IconTrash } from '../icons';
import { PSTATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah, todayStr } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Rfq, RfqItem } from '@/lib/types';

/** Mirrors the single-file app's rfqJawabanSummary(). */
function jawabanSummary(items: RfqItem[]): string {
  const answered = (items || []).filter((it) => it.hargaPurchasing || it.coo);
  if (answered.length === 0) return '-';
  const first = answered[0];
  const label = `${first.hargaPurchasing ? formatRupiah(first.hargaPurchasing) : '-'}${first.coo ? ` · ${first.coo}` : ''}`;
  return answered.length > 1 ? `${label} (+${answered.length - 1} lainnya)` : label;
}

function statusColor(status: string): string {
  return status === 'Selesai' ? 'green' : status === 'Terkirim' ? 'steel' : 'slate';
}

export function RfqManageModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'rfqManage';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const rfqs = useDataStore((s) => s.rfqs);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const toast = useDataStore((s) => s.toast);

  const chatCounts = useItemChatCounts('rfq', show);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const list = useMemo(() => {
    let l = rfqs;
    if (statusFilter) l = l.filter((r) => r.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      l = l.filter((r) => (r.noRfq || '').toLowerCase().includes(q) || (r.customer || '').toLowerCase().includes(q) || (r.cabang || '').toLowerCase().includes(q));
    }
    return l;
  }, [rfqs, statusFilter, search]);

  async function exportExcel() {
    if (list.length === 0) return toast('Tidak ada data RFQ untuk diexport.', 'error');
    const XLSX = await import('xlsx');
    const header = ['NO', 'NO RFQ', 'TANGGAL', 'CABANG', 'CUSTOMER', 'LINE', 'GRADE', 'MATERIAL', 'DIA (mm)', 'THICK (mm)', 'WIDTH (mm)', 'LENGTH (mm)', 'PCS', 'BERAT (KGS)', 'LOKAL/IMPORT', 'ESTIMASI KEBUTUHAN', 'HARGA (PURCHASING)', 'COO', 'STATUS', 'TERKIRIM KE PURCHASING', 'JAWABAN RFQ', 'DIBUAT OLEH'];
    const aoa: unknown[][] = [header];
    let no = 1;
    list.forEach((r) => {
      const items = r.items?.length ? r.items : ([{}] as RfqItem[]);
      items.forEach((it, idx) => {
        aoa.push([
          idx === 0 ? no : '', idx === 0 ? r.noRfq || '' : '', idx === 0 ? formatDateID(r.tglRfq) : '',
          idx === 0 ? r.cabang || '' : '', idx === 0 ? r.customer || '' : '',
          it.line || '', it.grade || '', it.material || '', it.dia || '', it.thick || '', it.width || '', it.length || '',
          it.pcs || '', it.berat || '', it.lokal || '', it.estimasi || '',
          it.hargaPurchasing || '', it.coo || '',
          idx === 0 ? r.status || 'Draft' : '',
          idx === 0 ? (r.sentToPurchasingAt ? formatDateID(r.sentToPurchasingAt) : 'Belum') : '',
          idx === 0 ? (r.jawabanRfqDikirim ? formatDateID(r.jawabanRfqAt) : 'Belum') : '',
          idx === 0 ? r.requestedBy || '' : '',
        ]);
      });
      no++;
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 4 }, { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 22 }, { wch: 6 }, { wch: 10 }, { wch: 24 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 6 }, { wch: 11 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RFQ');
    XLSX.writeFile(wb, `Kelola_RFQ_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${list.length} RFQ`, 'success');
  }

  async function markDone(id: string) {
    try {
      const { rfq } = await api.patch<{ rfq: Rfq }>(`/api/rfqs/${id}`, { status: 'Selesai' });
      upsertRfq(rfq);
      toast('RFQ ditandai selesai', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memperbarui RFQ', 'error');
    }
  }

  return (
    <Modal show={show} onClose={closeModal} title="Kelola RFQ" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="toolbar-row">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            useUiStore.setState({ rfqCtx: { prospectId: null, rfqId: null } });
            openModal('rfq');
          }}
        >
          + Buat RFQ Baru
        </button>
        <select className="btn-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="Draft">Draft</option>
          <option value="Terkirim">Terkirim</option>
          <option value="Selesai">Selesai</option>
        </select>
        <input type="search" className="search-grow" placeholder="Cari No RFQ / Customer / Cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>Export Excel</button>
      </div>
      <div className="import-summary">
        RFQ digunakan untuk meminta ketersediaan/harga material ke Purchasing selama prospek masih berjalan (Aktif).
        Setelah prospek dinyatakan <b>Won</b>, buat <b>FUP A</b> (permintaan pembelian resmi) dari menu Kelola FUP A
        dengan merujuk No. RFQ ini.
      </div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{rfqs.length === 0 ? 'Belum ada RFQ' : 'Tidak ditemukan'}</h3>
          <p>{rfqs.length === 0 ? 'Buat RFQ dari tombol pada daftar prospek, atau klik "+ Buat RFQ Baru" di atas.' : 'Coba ubah filter atau kata kunci pencarian.'}</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>No RFQ</th>
                <th>Tanggal</th>
                <th>Cabang</th>
                <th>Customer</th>
                <th>Material</th>
                <th>Status</th>
                <th>FUP A</th>
                <th>Purchasing</th>
                <th>Lampiran</th>
                <th>Jawaban Harga/COO</th>
                <th>Dibuat Oleh</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.noRfq || '-'}<ItemChatBadge count={chatCounts[r.id]} /></td>
                  <td className="mono">{formatDateID(r.tglRfq)}</td>
                  <td>{r.cabang || '-'}</td>
                  <td>{r.customer || '-'}</td>
                  <td className="center">{(r.items || []).length}</td>
                  <td>
                    <span className={`badge ${statusColor(r.status)}`}>{r.status || 'Draft'}</span>
                  </td>
                  <td>
                    {r.fupaId ? <span className="badge amber">Ada</span> : <span className="badge slate">-</span>}
                  </td>
                  <td>
                    <span className={`badge ${(PSTATUS_META[r.purchStatus] || PSTATUS_META[0]).color}`}>
                      {(PSTATUS_META[r.purchStatus] || PSTATUS_META[0]).label}
                    </span>
                  </td>
                  <td><AttachNoteBadges rfqId={r.id} /></td>
                  <td>
                    {r.jawabanRfqDikirim ? (
                      <span className="badge green" title={formatDateID(r.jawabanRfqAt)}>Terkirim</span>
                    ) : (
                      <span className="badge slate">Belum</span>
                    )}
                    <div className="text-muted" style={{ fontSize: 11 }}>{jawabanSummary(r.items)}</div>
                  </td>
                  <td>{r.requestedBy || '-'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        title="Buka / Edit"
                        onClick={() => {
                          useUiStore.setState({ rfqCtx: { prospectId: r.prospectId, rfqId: r.id } });
                          openModal('rfq');
                        }}
                      >
                        <IconEdit />
                      </button>
                      {r.status !== 'Selesai' && (
                        <button className="icon-btn" title="Tandai Selesai" onClick={() => markDone(r.id)}>
                          <IconCheck />
                        </button>
                      )}
                      <button
                        className="icon-btn danger"
                        title="Hapus"
                        onClick={() => {
                          useUiStore.setState({
                            deleteCtx: { mode: 'rfq', id: r.id, title: 'Hapus RFQ', message: `Yakin ingin menghapus RFQ "${r.noRfq || '(tanpa nomor)'}" untuk ${r.customer || '-'}? Tindakan ini tidak dapat dibatalkan.` },
                          });
                          openModal('delete');
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
