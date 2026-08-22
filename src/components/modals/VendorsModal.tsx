'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconEdit, IconTrash, IconWa } from '../icons';
import { normalizePhone, todayStr } from '@/lib/format';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

const HEADER = ['NAMA VENDOR', 'PIC', 'NO WHATSAPP', 'EMAIL', 'KATEGORI', 'ALAMAT', 'CATATAN'];
const COLS = [{ wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 36 }, { wch: 26 }];

export function VendorsModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'vendors';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const vendors = useDataStore((s) => s.vendors);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const canEdit = currentUser?.role === 'purchasing' || currentUser?.role === 'admin';
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    if (!search) return vendors;
    const q = search.toLowerCase();
    return vendors.filter(
      (v) =>
        (v.nama || '').toLowerCase().includes(q) ||
        (v.pic || '').toLowerCase().includes(q) ||
        (v.kategori || '').toLowerCase().includes(q),
    );
  }, [vendors, search]);

  async function exportExcel() {
    if (vendors.length === 0) return toast('Tidak ada data vendor untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [HEADER];
    vendors.forEach((v) => aoa.push([v.nama || '', v.pic || '', v.wa || '', v.email || '', v.kategori || '', v.alamat || '', v.catatan || '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = COLS;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendor');
    XLSX.writeFile(wb, `CRM_Vendor_Export_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${vendors.length} data vendor`, 'success');
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const example = ['PT. Baja Sejahtera', 'Bapak Budi', '08123456789', 'sales@bajasejahtera.com', 'Plate, Round Bar', 'Jl. Industri No.1, Bekasi', 'Lead time 2 minggu'];
    const ws = XLSX.utils.aoa_to_sheet([HEADER, example]);
    ws['!cols'] = COLS;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Vendor');
    XLSX.writeFile(wb, 'CRM_Vendor_Template.xlsx');
    toast('Template vendor berhasil diunduh', 'success');
  }

  return (
    <Modal show={show} onClose={closeModal} title="Kelola Vendor" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="toolbar-row">
        {canEdit && (
          <>
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
          </>
        )}
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>Export Excel</button>
        <button className="btn btn-outline btn-sm" onClick={downloadTemplate}>Template</button>
        <input type="search" className="search-grow" placeholder="Cari nama vendor / PIC / kategori..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{vendors.length === 0 ? 'Belum ada data vendor' : 'Tidak ditemukan'}</h3>
          <p>
            {vendors.length === 0
              ? 'Tambah vendor baru atau import dari Excel agar Purchasing dapat mengirim permintaan penawaran.'
              : 'Coba kata kunci pencarian lain.'}
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>Nama Vendor</th>
                <th>PIC</th>
                <th>Kategori</th>
                <th>No. WhatsApp</th>
                <th>Email</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600, color: 'var(--graphite-900)' }}>{v.nama}</td>
                  <td>{v.pic || '-'}</td>
                  <td>{v.kategori || '-'}</td>
                  <td className="mono">{v.wa || '-'}</td>
                  <td>{v.email || '-'}</td>
                  <td>
                    <div className="row-actions">
                      {v.wa && (
                        <a
                          className="icon-btn wa-btn"
                          title="WhatsApp vendor"
                          href={`https://wa.me/${normalizePhone(v.wa)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <IconWa />
                        </a>
                      )}
                      {canEdit && (
                        <>
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
                              useUiStore.setState({ deleteCtx: { mode: 'vendor', id: v.id, title: 'Hapus Vendor', message: `Yakin ingin menghapus vendor "${v.nama}"?` } });
                              openModal('delete');
                            }}
                          >
                            <IconTrash />
                          </button>
                        </>
                      )}
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
