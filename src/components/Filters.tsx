'use client';

import { useMemo, useState } from 'react';
import { BULAN_LIST, STATUS_META } from '@/lib/constants';
import { createdInRange } from '@/lib/new-records';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

export function Filters() {
  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const ui = useUiStore();
  const [searchInput, setSearchInput] = useState(ui.search);

  const isSales = currentUser?.role === 'sales';
  const cabangSet = useMemo(() => Array.from(new Set(records.map((r) => r.cabang).filter(Boolean))).sort() as string[], [records]);
  const seSet = useMemo(() => Array.from(new Set(records.map((r) => r.se).filter(Boolean))).sort() as string[], [records]);
  const tahunSet = useMemo(
    () =>
      (Array.from(new Set(records.map((r) => (r.tglPenawaran ? r.tglPenawaran.slice(0, 4) : null)).filter(Boolean))) as string[]).sort((a, b) => b.localeCompare(a)),
    [records],
  );

  // Counts for the "Dibuat" filter, over everything this role can see.
  const now = new Date();
  const todayKey = now.toDateString();
  const createdCounts = useMemo(() => {
    const d = new Date();
    return { today: records.filter((r) => createdInRange(r, 'today', d)).length, week: records.filter((r) => createdInRange(r, 'week', d)).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, todayKey]);

  return (
    <div className="filters">
      <div className="field">
        <label>Dibuat</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={`btn btn-outline btn-sm filter-chip-new${ui.fDibuat === 'today' ? ' active' : ''}`}
            onClick={() => ui.setFilter({ fDibuat: ui.fDibuat === 'today' ? '' : 'today' })}
            title="Tampilkan hanya prospek yang dibuat hari ini"
          >
            Hari ini ({createdCounts.today})
          </button>
          <button
            type="button"
            className={`btn btn-outline btn-sm filter-chip-new${ui.fDibuat === 'week' ? ' active' : ''}`}
            onClick={() => ui.setFilter({ fDibuat: ui.fDibuat === 'week' ? '' : 'week' })}
            title="Tampilkan prospek yang dibuat sejak Senin minggu ini"
          >
            Minggu ini ({createdCounts.week})
          </button>
        </div>
      </div>
      <div className="field">
        <label>Bulan</label>
        <select value={ui.fBulan} onChange={(e) => ui.setFilter({ fBulan: e.target.value })}>
          <option value="">Semua</option>
          {BULAN_LIST.map((b) => (
            <option key={b.v} value={b.v}>
              {b.l}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Tahun</label>
        <select value={ui.fTahun} onChange={(e) => ui.setFilter({ fTahun: e.target.value })}>
          <option value="">Semua</option>
          {tahunSet.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Regional</label>
        <select value={ui.fReg} onChange={(e) => ui.setFilter({ fReg: e.target.value })}>
          <option value="">Semua</option>
          <option value="1">Regional 1</option>
          <option value="2">Regional 2</option>
          <option value="3">Regional 3</option>
        </select>
      </div>
      <div className="field">
        <label>Cabang</label>
        <select value={ui.fCabang} onChange={(e) => ui.setFilter({ fCabang: e.target.value })}>
          <option value="">Semua</option>
          {cabangSet.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {!isSales && (
        <div className="field">
          <label>SE</label>
          <select value={ui.fSe} onChange={(e) => ui.setFilter({ fSe: e.target.value })}>
            <option value="">Semua</option>
            {seSet.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label>Status</label>
        <select value={ui.fStatus} onChange={(e) => ui.setFilter({ fStatus: e.target.value })}>
          <option value="">Semua</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>
              {k} · {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Klasifikasi</label>
        <select value={ui.fKlas} onChange={(e) => ui.setFilter({ fKlas: e.target.value })}>
          <option value="">Semua</option>
          <option value="Aktif">Aktif</option>
          <option value="Won">Won</option>
          <option value="Lost">Lost</option>
            <option value="Activity">Sales Activity</option>
        </select>
      </div>
      <div className="field">
        <label>Status Penawaran</label>
        <select value={ui.fPenawaran} onChange={(e) => ui.setFilter({ fPenawaran: e.target.value })}>
          <option value="">Semua</option>
          <option value="sent">Terkirim</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <div className="field search-field">
        <label>Cari</label>
        <input
          type="search"
          placeholder="Cari customer, produk, SE, keterangan..."
          value={searchInput}
          onChange={(e) => {
            const val = e.target.value;
            setSearchInput(val);
            ui.setFilter({ search: val });
          }}
        />
      </div>
      <div className="field">
        <label>&nbsp;</label>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          onClick={() => {
            setSearchInput('');
            ui.resetFilters();
          }}
        >
          Reset Filter
        </button>
      </div>
    </div>
  );
}
