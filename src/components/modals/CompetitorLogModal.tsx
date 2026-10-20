'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { formatDateID, formatRupiah, todayStr } from '@/lib/format';
import { buildCompetitorLog } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { canNow } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
export function CompetitorLogModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'competitorLog';
  const closeModal = useUiStore((s) => s.closeModal);
  const records = useDataStore((s) => s.prospects);

  const [cabangFilter, setCabangFilter] = useState('');
  const allRows = useMemo(() => buildCompetitorLog(records), [records]);
  const rows = useMemo(
    () => (cabangFilter ? allRows.filter((r) => r.topCabang === cabangFilter) : allRows),
    [allRows, cabangFilter],
  );
  const [detail, setDetail] = useState<string | null>(null);
  const toast = useDataStore((s) => s.toast);

  async function exportExcel() {
    if (rows.length === 0) return toast('Tidak ada data kompetitor untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const header = ['KOMPETITOR', 'KALI MENANG', 'TOTAL VALUE HILANG', 'CABANG TERBANYAK', 'LINE TERBANYAK', 'TERAKHIR TERJADI'];
    const aoa: unknown[][] = [header];
    rows.forEach((r) => aoa.push([r.name, r.lostCount, r.lostValue, r.topCabang, r.topLine, r.lastSeen || '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kompetitor');
    XLSX.writeFile(wb, `CRM_Log_Kompetitor_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${rows.length} kompetitor`, 'success');
  }
  const totalLost = rows.reduce((s, r) => s + r.lostValue, 0);

  const active = detail ? rows.find((r) => r.name === detail) : null;

  if (active) {
    return (
      <Modal
        show={show} wide2
        onClose={() => { setDetail(null); closeModal(); }}
        title={`Deal Kalah — ${active.name}`}
        wide
        footer={<button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>{tr("← Kembali")}</button>}
      >
        <div className="import-summary" style={{ marginTop: 0 }}>
          <b>{active.lostCount}</b> {tr("deal kalah senilai")} <b>{formatRupiah(active.lostValue)}</b> {tr("· paling sering di cabang")}{' '}
          <b>{active.topCabang}</b> {tr("· line")} <b>{active.topLine}</b>.
        </div>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr><th>{tr("Customer")}</th><th>{tr("Uraian")}</th><th>{tr("Cabang")}</th><th>SE</th><th>{tr("Tgl Penawaran")}</th><th>{tr("Nilai")}</th><th>{tr("Catatan QCD")}</th></tr>
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
    <Modal show={show} onClose={closeModal} title={tr("Log Kompetitor")} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr("Tutup")}</button>}>
          <div className="import-summary" style={{ marginTop: 0 }}>
        {tr("Rekap otomatis dari data QCD pada prospek yang Lose Order dan sudah diisi kolom Kompetitor. Menunjukkan kompetitor mana yang paling sering menang, di cabang dan line material apa. Data mengikuti cakupan role Anda.")}
      </div>
      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="label">{tr("Kompetitor Teridentifikasi")}</div>
          <div className="value">{rows.length}</div>
        </div>
        <div className="kpi lost">
          <div className="label">{tr("Total Kejadian Lose")}</div>
          <div className="value">{rows.reduce((n, r) => n + r.lostCount, 0)}</div>
        </div>
        <div className="kpi lost">
          <div className="label">{tr("Total Value Hilang")}</div>
          <div className="value">{formatRupiah(totalLost)}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("Paling Sering Menang")}</div>
          <div className="value" style={{ fontSize: 16 }}>
            {rows.slice().sort((a, b) => b.lostCount - a.lostCount)[0]?.name || '-'}
          </div>
        </div>
      </div>
      <div className="toolbar-row">
        <select className="btn-sm" value={cabangFilter} onChange={(e) => setCabangFilter(e.target.value)}>
          <option value="">{tr("Semua Cabang")}</option>
          {Array.from(new Set(allRows.map((r) => r.topCabang).filter((c) => c && c !== '-'))).sort().map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {canNow('marketing', 'x') && (
          <button className="btn btn-outline btn-sm" onClick={exportExcel}>{tr("Export Excel")}</button>
        )}
        <span className="hint">{tr("Menampilkan")} {rows.length} {tr("dari")} {allRows.length} {tr("kompetitor")}</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{tr("Belum ada data kompetitor")}</h3>
          <p>{tr("Data akan muncul setelah prospek Lose Order diisi kolom Kompetitor pada QCD.")}</p>
        </div>
      ) : (
        <>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table">
              <thead>
                <tr><th>{tr("Kompetitor")}</th><th>{tr("Kali Menang")}</th><th>{tr("Total Value Hilang")}</th><th>{tr("Cabang Terbanyak")}</th><th>{tr("Line Terbanyak")}</th><th>{tr("Terakhir Terjadi")}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} style={{ cursor: 'pointer' }} onClick={() => setDetail(r.name)} title={tr("Lihat deal yang kalah")}>
                    <td style={{ fontWeight: 600, color: 'var(--steel-600)' }}>{r.name}</td>
                    <td className="center">{r.lostCount}</td>
                    <td className="mono">{formatRupiah(r.lostValue)}</td>
                    <td>{r.topCabang}</td>
                    <td>{r.topLine}</td>
                    <td>{formatDateID(r.lastSeen)}</td>
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
