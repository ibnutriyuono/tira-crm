'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah, todayStr } from '@/lib/format';
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
  const [healthFilter, setHealthFilter] = useState('');
  const [sortBy, setSortBy] = useState<'won' | 'recent' | 'stale'>('won');
  const toast = useDataStore((s) => s.toast);
  const rows = useMemo(() => buildCustomerIntel(records), [records]);
  const list = useMemo(() => {
    let l = rows;
    if (healthFilter) l = l.filter((r) => r.health === healthFilter);
    if (search) {
      const q = search.toLowerCase();
      l = l.filter((r) => r.name.toLowerCase().includes(q) || r.cabang.toLowerCase().includes(q));
    }
    const sorted = l.slice();
    if (sortBy === 'won') sorted.sort((a, b) => b.wonValue - a.wonValue);
    if (sortBy === 'recent') sorted.sort((a, b) => (b.lastOrderDate || '').localeCompare(a.lastOrderDate || ''));
    if (sortBy === 'stale') sorted.sort((a, b) => (b.daysSinceOrder ?? -1) - (a.daysSinceOrder ?? -1));
    return sorted;
  }, [rows, search, healthFilter, sortBy]);

  const avgDays = (() => {
    const withOrder = rows.filter((r) => r.daysSinceOrder != null);
    if (withOrder.length === 0) return 0;
    return Math.round(withOrder.reduce((n, r) => n + (r.daysSinceOrder ?? 0), 0) / withOrder.length);
  })();

  async function exportExcel() {
    if (list.length === 0) return toast('Tidak ada data customer untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const header = ['CUSTOMER', 'CABANG', 'WON', 'TOTAL VALUE WON', 'AKTIF PIPELINE', 'LOST', 'WIN RATE', 'ORDER TERAKHIR', 'HARI SEJAK ORDER', 'STATUS'];
    const aoa: unknown[][] = [header];
    list.forEach((r) => aoa.push([r.name, r.cabang, r.won, r.wonValue, r.aktif, r.lost, `${r.winRate}%`, r.lastOrderDate || '', r.daysSinceOrder ?? '', r.health]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 6 }, { wch: 18 }, { wch: 14 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customer Intel');
    XLSX.writeFile(wb, `CRM_Customer_Intelligence_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${list.length} customer`, 'success');
  }

  const active = detail ? rows.find((r) => r.name === detail) : null;

  if (active) {
    const history = active.records
      .slice()
      .sort((a, b) => (b.tglPO || b.tglPenawaran || '').localeCompare(a.tglPO || a.tglPenawaran || ''));
    return (
      <Modal
        show={show} wide2
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
    <Modal show={show} onClose={closeModal} title="Customer Intelligence" xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="import-summary" style={{ marginTop: 0 }}>
        Rekap otomatis dari histori transaksi tiap customer. Aktif = order dalam 45 hari terakhir, Menghangat = 46–90
        hari, Dingin = &gt;90 hari tanpa order (perlu follow-up). Data mengikuti cakupan role Anda.
      </div>

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="label">Total Customer</div>
          <div className="value">{rows.length}</div>
          <div className="foot">Pernah tercatat bertransaksi/prospek</div>
        </div>
        <div className="kpi won">
          <div className="label">Aktif</div>
          <div className="value">{rows.filter((r) => r.health === 'Aktif').length}</div>
          <div className="foot">Order ≤ 45 hari</div>
        </div>
        <div className="kpi pending">
          <div className="label">Menghangat</div>
          <div className="value">{rows.filter((r) => r.health === 'Menghangat').length}</div>
          <div className="foot">46–90 hari</div>
        </div>
        <div className="kpi lost">
          <div className="label">Dingin (Follow-up)</div>
          <div className="value">{rows.filter((r) => r.health === 'Dingin (Follow-up)').length}</div>
          <div className="foot">&gt; 90 hari tanpa order</div>
        </div>
        <div className="kpi">
          <div className="label">Rata-rata Hari Sejak Order</div>
          <div className="value">{avgDays}</div>
          <div className="foot">dari customer yang pernah order</div>
        </div>
      </div>

      <div className="toolbar-row">
        <input type="search" className="search-grow" placeholder="Cari customer / cabang..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="btn-sm" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="Aktif">Aktif</option>
          <option value="Menghangat">Menghangat</option>
          <option value="Dingin (Follow-up)">Dingin (perlu follow-up)</option>
          <option value="Belum Pernah Order">Belum Pernah Order</option>
        </select>
        <select className="btn-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'won' | 'recent' | 'stale')}>
          <option value="won">Urutkan: Total Won Tertinggi</option>
          <option value="recent">Urutkan: Order Terbaru</option>
          <option value="stale">Urutkan: Paling Lama Tidak Order</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>Export Excel</button>
      </div>
      <div className="import-summary">Menampilkan <b>{list.length}</b> dari <b>{rows.length}</b> customer</div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>Belum ada data</h3><p>Ringkasan ini dihitung otomatis dari daftar prospek.</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Customer</th><th>Cabang</th><th>Won</th><th>Total Value Won</th><th>Aktif Pipeline</th><th>Lost</th><th>Order Terakhir</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.name} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.name)} title="Lihat riwayat transaksi">
                  <td style={{ fontWeight: 600, color: 'var(--steel-600)' }}>{r.name}</td>
                  <td>{r.cabang || '-'}</td>
                  <td className="center">{r.won}</td>
                  <td className="mono">{formatRupiah(r.wonValue)}</td>
                  <td className="center">{r.aktif}</td>
                  <td className="center">{r.lost}</td>
                  <td>{r.lastOrderDate ? `${formatDateID(r.lastOrderDate)} · ${r.daysSinceOrder} hari lalu` : '-'}</td>
                  <td><span className={`badge ${r.healthColor}`}>{r.health}</span></td>
                  <td><button type="button" className="btn btn-outline btn-sm" onClick={() => setDetail(r.name)}>Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
