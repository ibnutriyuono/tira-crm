'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID, formatRupiah } from '@/lib/format';
import { buildCompetitorLog } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function CompetitorLogModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'competitorLog';
  const closeModal = useUiStore((s) => s.closeModal);
  const records = useDataStore((s) => s.prospects);

  const rows = useMemo(() => buildCompetitorLog(records), [records]);
  const [detail, setDetail] = useState<string | null>(null);
  const totalLost = rows.reduce((s, r) => s + r.lostValue, 0);

  const active = detail ? rows.find((r) => r.name === detail) : null;

  if (active) {
    return (
      <Modal
        show={show}
        onClose={() => { setDetail(null); closeModal(); }}
        title={`Deal Kalah — ${active.name}`}
        wide
        footer={<button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>← Kembali</button>}
      >
        <div className="import-summary" style={{ marginTop: 0 }}>
          <b>{active.lostCount}</b> deal kalah senilai <b>{formatRupiah(active.lostValue)}</b> · paling sering di cabang{' '}
          <b>{active.topCabang}</b> · line <b>{active.topLine}</b>.
        </div>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>Customer</th><th>Uraian</th><th>Cabang</th><th>SE</th><th>Tgl Penawaran</th><th>Nilai</th><th>Alasan (QCD)</th></tr>
            </thead>
            <tbody>
              {active.records.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.customer}</td>
                  <td>{r.uraian || '-'}</td>
                  <td>{r.cabang || '-'}</td>
                  <td>{r.se || '-'}</td>
                  <td>{formatDateID(r.tglPenawaran)}</td>
                  <td className="mono">{formatRupiah(r.value)}</td>
                  <td>{[r.qcdQuality, r.qcdCost, r.qcdDelivery].filter(Boolean).join(' · ') || r.qcdCatatan || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    );
  }

  return (
    <Modal show={show} onClose={closeModal} title="Log Kompetitor" wide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>Belum ada data kompetitor</h3>
          <p>Isi nama kompetitor pada form QCD saat prospek berstatus Lose Order agar muncul di sini.</p>
        </div>
      ) : (
        <>
          <div className="import-summary">
            Total nilai kalah dari <b>{rows.length}</b> kompetitor: <b>{formatRupiah(totalLost)}</b>.
          </div>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table">
              <thead>
                <tr><th>Kompetitor</th><th>Jumlah Kalah</th><th>Nilai Kalah</th><th>Cabang Terbanyak</th><th>Line Terbanyak</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.name)} title="Lihat deal yang kalah">
                    <td style={{ fontWeight: 600, color: 'var(--steel-600)' }}>{r.name}</td>
                    <td className="center">{r.lostCount}</td>
                    <td className="mono">{formatRupiah(r.lostValue)}</td>
                    <td>{r.topCabang}</td>
                    <td>{r.topLine}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
