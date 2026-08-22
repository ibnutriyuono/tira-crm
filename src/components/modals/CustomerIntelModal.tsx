'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID, formatRupiah } from '@/lib/format';
import { buildCustomerIntel } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function CustomerIntelModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customerIntel';
  const closeModal = useUiStore((s) => s.closeModal);
  const records = useDataStore((s) => s.prospects);

  const [search, setSearch] = useState('');
  const rows = useMemo(() => buildCustomerIntel(records), [records]);
  const list = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.cabang.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <Modal show={show} onClose={closeModal} title="Customer Intelligence" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="toolbar-row">
        <input type="search" className="search-grow" placeholder="Cari customer / cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>Belum ada data</h3><p>Ringkasan ini dihitung otomatis dari daftar prospek.</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Customer</th><th>Cabang</th><th>Total</th><th>Won</th><th>Lost</th><th>Win Rate</th><th>Nilai Won</th><th>Order Terakhir</th><th>Status</th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{r.cabang || '-'}</td>
                  <td className="center">{r.total}</td>
                  <td className="center">{r.won}</td>
                  <td className="center">{r.lost}</td>
                  <td className="center">{r.winRate}%</td>
                  <td className="mono">{formatRupiah(r.wonValue)}</td>
                  <td>{r.lastOrderDate ? `${formatDateID(r.lastOrderDate)} (${r.daysSinceOrder} hari)` : '-'}</td>
                  <td><span className={`badge ${r.healthColor}`}>{r.health}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
