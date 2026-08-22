'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { AttachNoteBadges } from '../AttachNoteBadges';
import { ItemChatBadge, useItemChatCounts } from '../ItemChatBadge';
import { IconCheck, IconEdit, IconTrash } from '../icons';
import { PSTATUS_META } from '@/lib/constants';
import { formatDateID } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Fupa } from '@/lib/types';

function statusColor(status: string): string {
  return status === 'Selesai' ? 'green' : status === 'Terkirim' ? 'steel' : 'slate';
}

export function FupaManageModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'fupaManage';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const fupas = useDataStore((s) => s.fupas);
  const upsertFupa = useDataStore((s) => s.upsertFupa);
  const toast = useDataStore((s) => s.toast);

  const chatCounts = useItemChatCounts('fupa', show);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const list = useMemo(() => {
    let l = fupas;
    if (statusFilter) l = l.filter((f) => f.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(
        (f) =>
          (f.noFupa || '').toLowerCase().includes(q) ||
          (f.customer || '').toLowerCase().includes(q) ||
          (f.cabang || '').toLowerCase().includes(q) ||
          (f.sourceNoRfq || '').toLowerCase().includes(q),
      );
    }
    return l;
  }, [fupas, statusFilter, search]);

  async function markDone(id: string) {
    try {
      const { fupa } = await api.patch<{ fupa: Fupa }>(`/api/fupas/${id}`, { status: 'Selesai' });
      upsertFupa(fupa);
      toast('FUP A ditandai selesai', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memperbarui FUP A', 'error');
    }
  }

  return (
    <Modal show={show} onClose={closeModal} title="Kelola FUP A" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="toolbar-row">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            useUiStore.setState({ fupaCtx: { fupaId: null, sourceRfqId: null } });
            openModal('fupa');
          }}
        >
          + Buat FUP A Baru
        </button>
        <select className="btn-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="Draft">Draft</option>
          <option value="Terkirim">Terkirim</option>
          <option value="Selesai">Selesai</option>
        </select>
        <input type="search" className="search-grow" placeholder="Cari No FUP A / RFQ / Customer..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{fupas.length === 0 ? 'Belum ada FUP A' : 'Tidak ditemukan'}</h3>
          <p>{fupas.length === 0 ? 'FUP A dibuat dari RFQ yang sudah dimenangkan, sebagai permintaan pembelian ke Purchasing.' : 'Coba kata kunci pencarian lain.'}</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>No. FUP A</th>
                <th>Tanggal</th>
                <th>Ref. RFQ</th>
                <th>Customer</th>
                <th>Cabang</th>
                <th>Item</th>
                <th>Lampiran</th>
                <th>Status</th>
                <th>Pembelian</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const pmeta = PSTATUS_META[f.purchStatus] || PSTATUS_META[0];
                return (
                  <tr key={f.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{f.noFupa || '-'}<ItemChatBadge count={chatCounts[f.id]} /></td>
                    <td>{formatDateID(f.tglFupa)}</td>
                    <td className="mono">{f.sourceNoRfq || '-'}</td>
                    <td>{f.customer || '-'}</td>
                    <td>{f.cabang || '-'}</td>
                    <td className="center">{f.items?.length ?? 0}</td>
                    <td><AttachNoteBadges fupaId={f.id} catatan={f.catatan} /></td>
                    <td><span className={`badge ${statusColor(f.status)}`}>{f.status}</span></td>
                    <td><span className={`badge ${pmeta.color}`}>{pmeta.label}</span></td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => {
                            useUiStore.setState({ fupaCtx: { fupaId: f.id, sourceRfqId: f.sourceRfqId } });
                            openModal('fupa');
                          }}
                        >
                          <IconEdit />
                        </button>
                        {f.status !== 'Selesai' && (
                          <button className="icon-btn" title="Tandai selesai" onClick={() => markDone(f.id)}>
                            <IconCheck />
                          </button>
                        )}
                        <button
                          className="icon-btn danger"
                          title="Hapus"
                          onClick={() => {
                            useUiStore.setState({ deleteCtx: { mode: 'fupa', id: f.id, title: 'Hapus FUP A', message: `Yakin ingin menghapus FUP A "${f.noFupa || '(tanpa nomor)'}"?` } });
                            openModal('delete');
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
