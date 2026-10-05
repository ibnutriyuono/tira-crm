'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconEdit, IconTrash, IconWa } from '../icons';
import { getPrimaryPic, todayStr } from '@/lib/format';
import { appendSheet, buildCustomerSheet } from '@/lib/exports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function CustomersModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customers';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const customers = useDataStore((s) => s.customers);
  const records = useDataStore((s) => s.prospects);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.cabang || '').toLowerCase().includes(q) ||
        (c.pics || []).some((p) => (p.nama || '').toLowerCase().includes(q) || (p.jabatan || '').toLowerCase().includes(q)) ||
        (getPrimaryPic(c)?.nama || '').toLowerCase().includes(q),
    );
  }, [customers, search]);

  async function exportExcel() {
    if (customers.length === 0) return toast('Tidak ada data customer untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, buildCustomerSheet(customers));
    XLSX.writeFile(wb, `CRM_Customer_Export_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${customers.length} data customer`, 'success');
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const header = ['NAMA CUSTOMER', 'CABANG', 'PIC', 'NO TELP', 'EMAIL', 'ALAMAT', 'CATATAN'];
    const example = ['PT. Contoh Customer', 'DKI', 'Bapak Andi', '08123456789', 'andi@contoh.com', 'Jl. Industri No.1, Jakarta', 'Customer prioritas'];
    const ws = XLSX.utils.aoa_to_sheet([header, example]);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 36 }, { wch: 26 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Customer');
    XLSX.writeFile(wb, 'CRM_Customer_Template.xlsx');
    toast('Template customer berhasil diunduh', 'success');
  }

  return (
    <Modal show={show} onClose={closeModal} title="Kelola Customer" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="toolbar-row">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            useUiStore.setState({ customerEditId: null });
            openModal('customerForm');
          }}
        >
          + Tambah Customer
        </button>
        {currentUser?.role === 'admin' && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              useUiStore.setState({ importTarget: 'customer' });
              openModal('import');
            }}
          >
            Import Excel
          </button>
        )}
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>
          Export Excel
        </button>
        <button className="btn btn-outline btn-sm" onClick={downloadTemplate}>
          Template
        </button>
        <input type="search" className="search-grow" placeholder="Cari nama customer / PIC / cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{customers.length === 0 ? 'Belum ada data customer' : 'Tidak ditemukan'}</h3>
          <p>{customers.length === 0 ? 'Tambah customer baru atau import dari Excel untuk mulai membangun database customer.' : 'Coba kata kunci pencarian lain.'}</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>Nama Customer</th>
                <th>Cabang</th>
                <th>PIC</th>
                <th>No. Telp</th>
                <th>Email</th>
                <th>Prospek</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const cnt = records.filter((r) => (r.customer || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase()).length;
                const primary = getPrimaryPic(c);
                const extra = (c.pics?.length || 0) - 1;
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600, color: 'var(--graphite-900)' }}>{c.name}</td>
                    <td>{c.cabang || '-'}</td>
                    <td>
                      {primary?.nama || '-'}
                      {primary?.jabatan ? <span style={{ color: 'var(--muted)' }}> · {primary.jabatan}</span> : null}
                      {extra > 0 && <span className="badge steel" style={{ marginLeft: 6 }}>+{extra}</span>}
                    </td>
                    <td className="mono">{primary?.phone || '-'}</td>
                    <td>{primary?.email || '-'}</td>
                    <td className="center">{cnt}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn wa-btn"
                          title="WhatsApp"
                          onClick={() => {
                            useUiStore.setState({ followUpCtx: { type: 'customer', id: c.id } });
                            openModal('followUp');
                          }}
                        >
                          <IconWa />
                        </button>
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => {
                            useUiStore.setState({ customerEditId: c.id });
                            openModal('customerForm');
                          }}
                        >
                          <IconEdit />
                        </button>
                        {currentUser?.role === 'admin' && (
                          <button
                            className="icon-btn danger"
                            title="Hapus"
                            onClick={() => {
                              useUiStore.setState({ deleteCtx: { mode: 'customer', id: c.id, title: 'Hapus Customer', message: `Yakin ingin menghapus customer "${c.name}"?` } });
                              openModal('delete');
                            }}
                          >
                            <IconTrash />
                          </button>
                        )}
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
