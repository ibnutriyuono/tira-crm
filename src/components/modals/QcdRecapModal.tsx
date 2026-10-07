'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { QcdDashboard } from '../QcdDashboard';
import { IconEdit } from '../icons';
import { CABANG_LIST, STATUS_META } from '@/lib/constants';
import { execScopeFor } from '@/lib/exec-analysis';
import { formatRupiah, num, todayStr } from '@/lib/format';
import { QCD_DIMS, QCD_FAKTOR_LABEL } from '@/lib/qcd';
import { buildQcdRecap } from '@/lib/reports';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

/** "Lebih murah — selisih 5%" from the level dropdown plus the optional note. */
function dimText(r: Prospect, key: 'quality' | 'cost' | 'delivery'): string {
  const dim = QCD_DIMS.find((d) => d.key === key)!;
  const level = r[dim.field] as string | null | undefined;
  const label = level ? dim.options[level as keyof typeof dim.options] : '';
  const note = (key === 'quality' ? r.qcdQuality : key === 'cost' ? r.qcdCost : r.qcdDelivery) || '';
  return [label, note].filter(Boolean).join(' — ');
}

const levelColor = (level: string | null | undefined) => (level === 'unggul' ? 'green' : level === 'kalah' ? 'rust' : level === 'setara' ? 'slate' : '');

/**
 * Hasil QCD: the QCD dashboard (why deals are won and lost) is the main view;
 * the per-deal recap table sits in the second tab. Data is already
 * role-scoped by the API; GM/Admin and RM can narrow it further here.
 */
export function QcdRecapModal() {
  const show = useUiStore((s) => s.modal === 'qcdRecap');
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);

  const [view, setView] = useState<'dashboard' | 'rekap'>('dashboard');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [scopeKey, setScopeKey] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Scope = what this role is responsible for (same rule as Analisa Eksekutif);
  // GM/Admin can narrow to a region or branch, RM to one of its branches.
  const baseScope = useMemo(() => (currentUser ? execScopeFor(currentUser, records) : null), [currentUser, records]);
  const regionOf = useMemo(() => {
    const m: Record<string, number> = {};
    records.forEach((r) => {
      const c = (r.cabang || '').trim().toUpperCase();
      if (c && r.reg != null && m[c] == null) m[c] = r.reg;
    });
    return m;
  }, [records]);
  const canPick = baseScope?.kind === 'nasional' || baseScope?.kind === 'regional';
  const regions = useMemo(() => Array.from(new Set(Object.values(regionOf))).sort(), [regionOf]);
  const { cabangList, scopeLabel } = useMemo(() => {
    if (!baseScope) return { cabangList: [] as string[], scopeLabel: '-' };
    if (!scopeKey) return { cabangList: baseScope.cabangs, scopeLabel: baseScope.label };
    if (scopeKey.startsWith('reg-')) {
      const reg = Number(scopeKey.slice(4));
      const list = CABANG_LIST.filter((c) => regionOf[c] === reg);
      return { cabangList: list, scopeLabel: `Regional ${reg}` };
    }
    return { cabangList: [scopeKey], scopeLabel: `Cabang ${scopeKey}` };
  }, [baseScope, scopeKey, regionOf]);

  const inScope = useMemo(() => {
    const set = new Set(cabangList.map((c) => c.toUpperCase()));
    return (r: Prospect) => baseScope?.kind === 'se' || set.has((r.cabang || '').trim().toUpperCase());
  }, [cabangList, baseScope]);

  const rows = useMemo(() => buildQcdRecap(records).filter(inScope), [records, inScope]);
  const list = useMemo(() => {
    let l = rows;
    if (statusFilter === 'won') l = l.filter((r) => num(r.status) === 4 || num(r.status) === 5);
    else if (statusFilter) l = l.filter((r) => String(r.status) === statusFilter);
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
    const header = ['CUSTOMER', 'CABANG', 'SE', 'STATUS', 'LINE', 'MATERIAL', 'QTY', 'NILAI', 'QUALITY', 'COST', 'DELIVERY', 'FAKTOR PENENTU', 'KOMPETITOR', 'CATATAN'];
    const aoa: unknown[][] = [header];
    list.forEach((r) =>
      aoa.push([
        r.customer || '', r.cabang || '', r.se || '', STATUS_META[r.status]?.label || '',
        r.line || '', r.uraian || '', r.qty || 0, r.value || 0,
        dimText(r, 'quality'), dimText(r, 'cost'), dimText(r, 'delivery'),
        QCD_FAKTOR_LABEL[r.qcdFaktor || ''] || '', r.qcdKompetitor || '', r.qcdCatatan || '',
      ]),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 6 }, { wch: 26 }, { wch: 6 }, { wch: 15 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'QCD');
    XLSX.writeFile(wb, `CRM_QCD_Rekap_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${list.length} baris QCD`, 'success');
  }

  const dimCell = (r: Prospect, key: 'quality' | 'cost' | 'delivery') => {
    const dim = QCD_DIMS.find((d) => d.key === key)!;
    const level = r[dim.field] as string | null | undefined;
    const note = (key === 'quality' ? r.qcdQuality : key === 'cost' ? r.qcdCost : r.qcdDelivery) || '';
    if (!level && !note) return '-';
    return (
      <>
        {level && <span className={`badge ${levelColor(level)}`}>{dim.options[level as keyof typeof dim.options]}</span>}
        {note && <div className="field-note" style={{ marginTop: 2 }}>{note}</div>}
      </>
    );
  };

  return (
    <Modal show={show} onClose={closeModal} title="Hasil QCD (Quality / Cost / Delivery)" xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="view-toggle" style={{ marginBottom: 12 }}>
        <button type="button" className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>
          Dashboard QCD
        </button>
        <button type="button" className={view === 'rekap' ? 'active' : ''} onClick={() => setView('rekap')}>
          Rekap Data QCD ({rows.length})
        </button>
      </div>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        {view === 'dashboard' && (
          <div>
            <label>Tahun</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ maxWidth: 110 }} />
          </div>
        )}
        <div>
          <label>Lingkup</label>
          {canPick ? (
            <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
              <option value="">{baseScope?.label} (semua)</option>
              {baseScope?.kind === 'nasional' &&
                regions.map((r) => (
                  <option key={r} value={`reg-${r}`}>
                    Regional {r}
                  </option>
                ))}
              {(baseScope?.cabangs || []).map((c) => (
                <option key={c} value={c}>
                  Cabang {c}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={scopeLabel} readOnly />
          )}
        </div>
      </div>

      {view === 'dashboard' ? (
        <QcdDashboard cabangList={cabangList} year={year} scopeLabel={scopeLabel} returnTo="qcdRecap" />
      ) : (
        <>
          <div className="toolbar-row">
            <input type="search" className="search-grow" placeholder="Cari customer, kompetitor, cabang, SE..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="btn-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Semua (Won &amp; Lose)</option>
              <option value="won">Won (PO &amp; DO)</option>
              <option value="4">PO / Kontrak</option>
              <option value="5">DO</option>
              <option value="6">Lose Order</option>
            </select>
            <button className="btn btn-outline btn-sm" onClick={exportExcel}>
              Export Excel
            </button>
          </div>
          <div className="import-summary">
            Menampilkan <b>{list.length}</b> dari <b>{rows.length}</b> deal yang sudah ditutup (PO / DO / Lose). QCD wajib diisi saat deal ditutup.
          </div>

          {list.length === 0 ? (
            <div className="empty-state" style={{ padding: '34px 10px' }}>
              <h3>Belum ada data QCD</h3>
              <p>Rekap ini terisi dari prospek berstatus PO / Kontrak, DO dan Lose Order.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Customer</th><th>Cabang</th><th>SE</th><th>Status</th><th>Nilai</th><th>Quality</th><th>Cost</th><th>Delivery</th><th>Faktor Penentu</th><th>Kompetitor</th><th>Catatan</th><th>Aksi</th>
                  </tr>
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
                        <td className="mono">{formatRupiah(r.value)}</td>
                        <td>{dimCell(r, 'quality')}</td>
                        <td>{dimCell(r, 'cost')}</td>
                        <td>{dimCell(r, 'delivery')}</td>
                        <td>{QCD_FAKTOR_LABEL[r.qcdFaktor || ''] || <span className="badge amber">Belum diisi</span>}</td>
                        <td>{r.qcdKompetitor || '-'}</td>
                        <td style={{ maxWidth: 240 }}>{r.qcdCatatan || '-'}</td>
                        <td>
                          <button
                            className="icon-btn"
                            title="Buka QCD"
                            onClick={() => {
                              useUiStore.setState({ qcdCtx: { mode: 'kanban', statusVal: r.status, recordId: r.id, returnTo: 'qcdRecap' } });
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
        </>
      )}
    </Modal>
  );
}
