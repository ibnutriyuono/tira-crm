'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconEdit } from '../icons';
import { STATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah, todayStr } from '@/lib/format';
import { buildQcdRecap } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

/**
 * Recap of the Quality / Cost / Delivery post-mortem across closed deals
 * (PO/Kontrak and Lose Order). Read-only — the QCD form itself lives on the
 * prospect row. Scoping comes for free: `prospects` is already role-filtered
 * server-side by prospectScopeWhere.
 */
export function QcdRecapModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'qcdRecap';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const records = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const rows = useMemo(() => buildQcdRecap(records), [records]);
  const list = useMemo(() => {
    let l = rows;
    if (statusFilter) l = l.filter((r) => String(r.status) === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(
        (r) =>
          (r.customer || '').toLowerCase().includes(q) ||
          (r.qcdKompetitor || '').toLowerCase().includes(q) ||
          (r.cabang || '').toLowerCase().includes(q) ||
          (r.se || '').toLowerCase().includes(q),
      );
    }
    return l;
  }, [rows, statusFilter, search]);

  async function exportExcel() {
    if (list.length === 0) return toast('Tidak ada data QCD untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const header = ['CUSTOMER', 'CABANG', 'SE', 'STATUS', 'LINE', 'MATERIAL', 'QTY', 'HARGA', 'QUALITY', 'COST', 'DELIVERY', 'KOMPETITOR', 'CATATAN'];
    const aoa: unknown[][] = [header];
    list.forEach((r) =>
      aoa.push([
        r.customer || '', r.cabang || '', r.se || '', STATUS_META[r.status]?.label || '',
        r.line || '', r.uraian || '', r.qty || 0, r.value || 0,
        r.qcdQuality || '', r.qcdCost || '', r.qcdDelivery || '', r.qcdKompetitor || '', r.qcdCatatan || '',
      ]),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 6 }, { wch: 26 }, { wch: 6 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'QCD');
    XLSX.writeFile(wb, `CRM_QCD_Rekap_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${list.length} baris QCD`, 'success');
  }

  return (
    <Modal show={show} onClose={closeModal} title="Hasil QCD (Quality / Cost / Delivery)" xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="import-summary" style={{ marginTop: 0 }}>
        Data QCD terisi otomatis saat prospek diubah statusnya menjadi PO (Won) atau Lose Order. Halaman ini
        menampilkan rekap seluruh data QCD yang sudah diisi.
      </div>
      <div className="toolbar-row">
        <input type="search" className="search-grow" placeholder="Cari customer, cabang, SE..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="btn-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Semua (Won &amp; Lose)</option>
          <option value="4">Won (PO)</option>
          <option value="6">Lose Order</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>Export Excel</button>
      </div>
      <div className="import-summary">Menampilkan <b>{list.length}</b> dari <b>{rows.length}</b> data QCD</div>

      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>Belum ada data QCD</h3>
          <p>Rekap ini terisi otomatis dari prospek berstatus PO / Kontrak dan Lose Order yang sudah diisi form QCD-nya.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Customer</th><th>Cabang</th><th>SE</th><th>Status</th><th>Line</th><th>Material</th><th>Qty</th><th>Harga</th><th>Quality</th><th>Cost</th><th>Delivery</th><th>Kompetitor</th><th>Catatan</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.customer}</td>
                    <td>{r.cabang || '-'}</td>
                    <td>{r.se || '-'}</td>
                    <td><span className={`badge ${meta?.color || 'slate'}`}>{meta?.label || '-'}</span></td>
                    <td>{r.line || '-'}</td>
                    <td style={{ maxWidth: 220 }}>{r.uraian || '-'}</td>
                    <td className="center">{r.qty || 0}</td>
                    <td className="mono">{formatRupiah(r.value)}</td>
                    <td>{r.qcdQuality || '-'}</td>
                    <td>{r.qcdCost || '-'}</td>
                    <td>{r.qcdDelivery || '-'}</td>
                    <td>{r.qcdKompetitor || '-'}</td>
                    <td style={{ maxWidth: 240 }}>{r.qcdCatatan || '-'}</td>
                    <td>
                      <button
                        className="icon-btn"
                        title="Buka QCD"
                        onClick={() => {
                          useUiStore.setState({ qcdCtx: { mode: 'kanban', statusVal: r.status, recordId: r.id } });
                          openModal('qcd');
                        }}
                      >
                        <IconEdit />
                      </button>
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
