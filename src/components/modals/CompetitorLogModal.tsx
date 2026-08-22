'use client';

import { useMemo } from 'react';
import { Modal } from '../Modal';
import { formatRupiah } from '@/lib/format';
import { buildCompetitorLog } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function CompetitorLogModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'competitorLog';
  const closeModal = useUiStore((s) => s.closeModal);
  const records = useDataStore((s) => s.prospects);

  const rows = useMemo(() => buildCompetitorLog(records), [records]);
  const totalLost = rows.reduce((s, r) => s + r.lostValue, 0);

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
                  <tr key={r.name}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
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
