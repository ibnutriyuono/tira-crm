'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah } from '@/lib/format';
import { buildCustomerIntel } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function CustomerIntelModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customerIntel';
  const closeModal = useUiStore((s) => s.closeModal);
  const records = useDataStore((s) => s.prospects);

  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const rows = useMemo(() => buildCustomerIntel(records), [records]);
  const list = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.cabang.toLowerCase().includes(q));
  }, [rows, search]);

  const active = detail ? rows.find((r) => r.name === detail) : null;

  if (active) {
    const history = active.records
      .slice()
      .sort((a, b) => (b.tglPO || b.tglPenawaran || '').localeCompare(a.tglPO || a.tglPenawaran || ''));
    return (
      <Modal
        show={show}
        onClose={() => { setDetail(null); closeModal(); }}
        title={`Riwayat Transaksi — ${active.name}`}
        wide
        footer={<button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>← Kembali</button>}
      >
        <div className="import-summary" style={{ marginTop: 0 }}>
          Total Won <b>{formatRupiah(active.wonValue)}</b> dari <b>{active.won}</b> deal · Aktif <b>{active.aktif}</b> · Lost <b>{active.lost}</b> ·
          Win rate <b>{active.winRate}%</b> · <span className={`badge ${active.healthColor}`}>{active.health}</span>
          {active.daysSinceOrder != null ? ` · ${active.daysSinceOrder} hari sejak order terakhir` : ' · belum pernah order'}
        </div>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Uraian</th><th>Cabang</th><th>SE</th><th>Tgl Penawaran</th><th>Tgl PO</th><th>Nilai</th><th>Status</th><th>Klasifikasi</th></tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.id}>
                    <td>{r.uraian || '-'}</td>
                    <td>{r.cabang || '-'}</td>
                    <td>{r.se || '-'}</td>
                    <td>{formatDateID(r.tglPenawaran)}</td>
                    <td>{formatDateID(r.tglPO)}</td>
                    <td className="mono">{formatRupiah(r.value)}</td>
                    <td><span className={`badge ${meta?.color || 'slate'}`}>{meta?.label || '-'}</span></td>
                    <td>{classify(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    );
  }

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
                <tr key={r.name} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.name)} title="Lihat riwayat transaksi">
                  <td style={{ fontWeight: 600, color: 'var(--steel-600)' }}>{r.name}</td>
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
