'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconEdit, IconTrash, IconWa } from '../icons';
import { formatDateID, getPrimaryPic, todayStr } from '@/lib/format';
import { CUSTOMER_SEGMENTS } from '@/lib/constants';
import { CUST_STATUS_META, CUST_STATUS_ORDER, scoreColor, type CustStatus } from '@/lib/customer-profile';
import { customerKey } from '@/lib/reports';
import { useCustomerProfiles } from '@/hooks/useCustomerProfiles';
import { appendSheet, buildCustomerSheet } from '@/lib/exports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { canNow } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
import { isGmLevel } from '@/lib/roles';
export function CustomersModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customers';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const customers = useDataStore((s) => s.customers);
  const records = useDataStore((s) => s.prospects);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState<'' | CustStatus>('');
  const [fSegmen, setFSegmen] = useState('');
  const { index, loaded } = useCustomerProfiles(show);
  const factsOf = (name: string) => index.get(customerKey(name));
  const segOptions = useMemo(() => Array.from(new Set([...CUSTOMER_SEGMENTS, ...customers.map((c) => c.segmen || '').filter(Boolean)])), [customers]);

  function openProfile(name: string) {
    useUiStore.setState({ profileCustomer: name, profileReturnTo: 'customers' });
    openModal('customerProfile');
  }

  const list = useMemo(() => {
    let base = customers;
    if (fSegmen) base = base.filter((c) => (fSegmen === '-' ? !c.segmen : (c.segmen || index.get(customerKey(c.name))?.segmen) === fSegmen));
    if (fStatus) base = base.filter((c) => index.get(customerKey(c.name))?.status === fStatus);
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.cabang || '').toLowerCase().includes(q) ||
        (c.pics || []).some((p) => (p.nama || '').toLowerCase().includes(q) || (p.jabatan || '').toLowerCase().includes(q)) ||
        (getPrimaryPic(c)?.nama || '').toLowerCase().includes(q),
    );
  }, [customers, search, fSegmen, fStatus, index]);

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
    <Modal show={show} onClose={closeModal} title={tr("Kelola Customer")} xwide stickyHead footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr("Tutup")}</button>}>
      <div className="toolbar-row">
        {canNow('customer', 'e') && (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            useUiStore.setState({ customerEditId: null });
            openModal('customerForm');
          }}
        >
          {tr("+ Tambah Customer")}
        </button>
        )}
        {currentUser?.role === 'admin' && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              useUiStore.setState({ importTarget: 'customer' });
              openModal('import');
            }}
          >
            {tr("Import Excel")}
          </button>
        )}
        {(isGmLevel(currentUser?.role) || currentUser?.role === 'admin') && canNow('customer', 'e') && (
          <button className="btn btn-outline btn-sm" onClick={() => openModal('customerUnify')}>
            {tr("Satukan Nama Customer")}
          </button>
        )}
        {canNow('customer', 'x') && (
          <button className="btn btn-outline btn-sm" onClick={exportExcel}>
            {tr("Export Excel")}
          </button>
        )}
        {canNow('customer', 'x') && (
          <button className="btn btn-outline btn-sm" onClick={downloadTemplate}>
            {tr("Template")}
          </button>
        )}
        <input type="search" className="search-grow" placeholder={tr("Cari nama customer / PIC / cabang...")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="toolbar-row cp-filters">
        <span className="cp-filter-label">{tr("Status")}</span>
        <button type="button" className={`cf-chip${fStatus === '' ? ' on' : ''}`} onClick={() => setFStatus('')}>{tr("Semua")}</button>
        {CUST_STATUS_ORDER.map((k) => (
          <button key={k} type="button" className={`cf-chip${fStatus === k ? ' on' : ''}`} title={CUST_STATUS_META[k].hint} onClick={() => setFStatus(fStatus === k ? '' : k)}>
            {CUST_STATUS_META[k].label}
          </button>
        ))}
        <span className="cp-filter-label" style={{ marginLeft: 10 }}>{tr("Segmen")}</span>
        <select className="btn-sm" value={fSegmen} onChange={(e) => setFSegmen(e.target.value)}>
          <option value="">{tr("Semua segmen")}</option>
          {segOptions.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
          <option value="-">{tr("Belum diisi")}</option>
        </select>
        <span className="field-note" style={{ margin: 0 }}>{list.length} {tr("dari")} {customers.length} {tr("customer")}{loaded ? '' : tr(" · memuat aktivitas…")}</span>
      </div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{customers.length === 0 ? tr("Belum ada data customer") : tr("Tidak ditemukan")}</h3>
          <p>{customers.length === 0 ? tr("Tambah customer baru atau import dari Excel untuk mulai membangun database customer.") : tr("Coba kata kunci pencarian lain.")}</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>{tr("Nama Customer")}</th>
                <th>{tr("Cabang")}</th>
                <th>PIC</th>
                <th>{tr("No. Telp")}</th>
                <th>{tr("Segmen")}</th>
                <th title={tr("Dihitung otomatis dari order & kontak")}>{tr("Status")}</th>
                <th title={tr("Skor kesehatan 0–100")}>{tr("Skor")}</th>
                <th>{tr("Order Terakhir")}</th>
                <th>{tr("Prospek")}</th>
                <th>{tr("Aksi")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const cnt = factsOf(c.name)?.records.length ?? records.filter((r) => (r.customer || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase()).length;
                const primary = getPrimaryPic(c);
                const extra = (c.pics?.length || 0) - 1;
                const f = factsOf(c.name);
                const st = f ? CUST_STATUS_META[f.status] : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <button type="button" className="link-btn cp-name" onClick={() => openProfile(c.name)} title={tr("Buka profil customer")}>{c.name}</button>
                    </td>
                    <td>{c.cabang || '-'}</td>
                    <td>
                      {primary?.nama || '-'}
                      {primary?.jabatan ? <span style={{ color: 'var(--muted)' }}> · {primary.jabatan}</span> : null}
                      {extra > 0 && <span className="badge steel" style={{ marginLeft: 6 }}>+{extra}</span>}
                    </td>
                    <td className="mono">{primary?.phone || '-'}</td>
                    <td>{c.segmen || f?.segmen || <span className="field-note" style={{ margin: 0 }}>{tr("belum diisi")}</span>}</td>
                    <td>{st ? <span className={`badge ${st.color}`} title={st.hint}>{st.label}</span> : '-'}</td>
                    <td>{f && loaded ? <span className={`cp-score ${scoreColor(f.score)}`}>{f.score}</span> : '…'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>{f?.lastOrder ? <>{formatDateID(f.lastOrder)}<div className="field-note" style={{ margin: 0 }}>{f.daysSinceOrder} {tr("hari lalu")}</div></> : '-'}</td>
                    <td className="center">{cnt}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => openProfile(c.name)}>
                          {tr("Profil")}
                        </button>
                        <button
                          className="icon-btn wa-btn"
                          title={tr("WhatsApp")}
                          onClick={() => {
                            useUiStore.setState({ followUpCtx: { type: 'customer', id: c.id } });
                            openModal('followUp');
                          }}
                        >
                          <IconWa />
                        </button>
                        {canNow('customer', 'e') && (
                        <button
                          className="icon-btn"
                          title={tr("Edit")}
                          onClick={() => {
                            useUiStore.setState({ customerEditId: c.id, customerFormReturnTo: 'customers' });
                            openModal('customerForm');
                          }}
                        >
                          <IconEdit />
                        </button>
                        )}
                        {currentUser?.role === 'admin' && (
                          <button
                            className="icon-btn danger"
                            title={tr("Hapus")}
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
