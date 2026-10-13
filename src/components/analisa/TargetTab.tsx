'use client';

import { useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { appendSheet } from '@/lib/exports';
import { BULAN_LIST } from '@/lib/constants';
import { achSignal, buildTargetAchievement } from '@/lib/target-achievement';
import { localToday } from '@/lib/sales-activity';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { canNow } from '@/hooks/useCan';

const BLN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Rp ringkas: 6,22 M / 850 jt. */
function rpShort(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${s}Rp ${Math.round(a / 1e6).toLocaleString('id-ID')} jt`;
  if (a === 0) return 'Rp 0';
  return `${s}Rp ${Math.round(a).toLocaleString('id-ID')}`;
}
const pct = (r: number | null) => (r == null || !Number.isFinite(r) ? '–' : `${Math.round(r * 100)}%`);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const SIG_LABEL = { ok: 'Sesuai / di atas laju', warn: 'Sedikit tertinggal', bad: 'Jauh tertinggal' } as const;

function Chip({ sig, done, ach }: { sig: 'ok' | 'warn' | 'bad' | null; done?: boolean; ach?: number | null }) {
  if (!sig) return <span className="tg-chip none">Target belum ada</span>;
  const text = done ? ((ach ?? 0) >= 1 ? 'Tercapai' : 'Tidak tercapai') : SIG_LABEL[sig];
  return <span className={`tg-chip ${sig}`}>{text}</span>;
}

function Bar({ ach, git, pace, sig, small }: { ach: number | null; git: number; pace: number | null; sig: 'ok' | 'warn' | 'bad' | null; small?: boolean }) {
  const a = Math.min(1, Math.max(0, ach || 0));
  const g = Math.max(0, Math.min(1 - a, git));
  return (
    <div className={`tg-bar ${small ? 'sm' : ''}`}>
      <span className={`fill ${sig || ''}`} style={{ width: `${a * 100}%` }} />
      {g > 0 && <span className="git" style={{ left: `${a * 100}%`, width: `${g * 100}%` }} />}
      {pace != null && <span className="mark" style={{ left: `${pace * 100}%` }} aria-hidden="true" />}
    </div>
  );
}

/**
 * Analisa Eksekutif > Target: target bulan ini & YTD vs omzet terfaktur,
 * dengan GIT sebagai potensi dan rincian per cabang.
 */
export function TargetTab({ prospects, scopeLabel, cabangs, isSe }: { prospects: Prospect[]; scopeLabel: string; cabangs: string[]; isSe: boolean }) {
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const toast = useDataStore((s) => s.toast);
  const today = localToday();
  const [year, setYear] = useState(today.slice(0, 4));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [cabang, setCabang] = useState('');
  const [showGit, setShowGit] = useState(true);

  const t = useMemo(
    () => buildTargetAchievement(prospects, budgetTargets, cabang ? [cabang] : cabangs, { year, month, today, allProspects: isSe }),
    [prospects, budgetTargets, cabang, cabangs, year, month, today, isSe],
  );
  // Rincian per cabang selalu atas seluruh cakupan, tidak terpengaruh filter cabang.
  const all = useMemo(
    () => (isSe || cabangs.length < 2 ? null : buildTargetAchievement(prospects, budgetTargets, cabangs, { year, month, today })),
    [isSe, cabangs, prospects, budgetTargets, year, month, today],
  );

  const curYear = today.slice(0, 4);
  const years = [String(Number(curYear) - 1), curYear];
  const maxMonth = year === curYear ? Number(today.slice(5, 7)) : 12;
  const monthName = `${BULAN_LIST[month - 1].l} ${year}`;
  const scopeText = isSe ? scopeLabel : cabang ? `Cabang ${cabang}` : scopeLabel;

  // kartu bulan
  const ach = ratio(t.real, t.target);
  const vsPace = ach == null ? null : t.isCurrent ? (t.pace ? ach / t.pace : null) : ach;
  const mSig = achSignal(vsPace);
  const sisa = t.target - t.real;
  const left = t.workdays - t.elapsed;
  const perDay = t.elapsed ? t.real / t.elapsed : 0;
  const need = sisa > 0 && left > 0 ? sisa / left : null;

  // kartu YTD
  const yAch = ratio(t.ytdReal, t.ytdTarget);
  const ySig = achSignal(yAch);
  const closedMonths = t.months.slice(0, t.isCurrent ? month - 1 : month);
  const hitMonths = closedMonths.filter((m) => m.target > 0 && m.real >= m.target).length;
  const proj = ratio(t.runRate, t.yearTarget);
  const shown = t.months.slice(0, month);
  const maxV = Math.max(1, ...shown.map((m) => Math.max(m.target, m.real + (showGit && m.month === month ? m.git : 0))));

  const rows = (all?.rows || [])
    .map((r) => {
      const a = ratio(r.real, r.target);
      const vp = a == null ? null : t.isCurrent ? (t.pace ? a / t.pace : null) : a;
      return { ...r, a, vp, ya: ratio(r.ytdReal, r.ytdTarget) };
    })
    .sort((x, y) => (x.vp ?? -1) - (y.vp ?? -1));

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, {
      sheetName: 'Per Bulan',
      header: ['BULAN', 'TARGET', 'TERFAKTUR', 'GIT', 'CAPAIAN'],
      rows: t.months.slice(0, month).map((m) => [`${BLN3[m.month - 1]} ${year}`, Math.round(m.target), Math.round(m.real), Math.round(m.git), m.target ? m.real / m.target : '']),
      colWidths: [{ wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 10 }],
      numFormats: { 1: '#,##0', 2: '#,##0', 3: '#,##0', 4: '0%' },
    });
    if (rows.length) {
      appendSheet(XLSX, wb, {
        sheetName: 'Per Cabang',
        header: ['CABANG', `TARGET ${BLN3[month - 1].toUpperCase()}`, 'TERFAKTUR', 'GIT', 'CAPAIAN', 'TARGET YTD', 'TERFAKTUR YTD', 'CAPAIAN YTD'],
        rows: rows.map((r) => [r.cabang, Math.round(r.target), Math.round(r.real), Math.round(r.git), r.a ?? '', Math.round(r.ytdTarget), Math.round(r.ytdReal), r.ya ?? '']),
        colWidths: [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }],
        numFormats: { 1: '#,##0', 2: '#,##0', 3: '#,##0', 4: '0%', 5: '#,##0', 6: '#,##0', 7: '0%' },
      });
    }
    XLSX.writeFile(wb, `Target_vs_Pencapaian_${scopeText.replace(/[^\w-]+/g, '_')}_${year}-${String(month).padStart(2, '0')}.xlsx`);
    toast('Excel target vs pencapaian diunduh', 'success');
  }

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        {!isSe && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label="Cabang">
            <option value="">Semua cabang</option>
            {cabangs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ maxWidth: 150 }} aria-label="Bulan">
          {BULAN_LIST.slice(0, maxMonth).map((b, i) => <option key={b.v} value={i + 1}>{b.l}</option>)}
        </select>
        <select
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            if (e.target.value === curYear) setMonth((m) => Math.min(m, Number(today.slice(5, 7))));
          }}
          style={{ maxWidth: 100 }}
          aria-label="Tahun"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showGit} onChange={(e) => setShowGit(e.target.checked)} /> Tampilkan GIT sebagai potensi
        </label>
        {canNow('analisa', 'x') && (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel}>
            <IconDownload /> Export Excel
          </button>
        )}
      </div>
      {isSe && <div className="field-note" style={{ marginTop: -4, marginBottom: 10 }}>Target yang ditampilkan adalah target cabang sebagai acuan; pencapaian = DO terfaktur milik Anda.</div>}

      <div className="tg-grid">
        <div className="tg-card">
          <div className="tg-card-head">
            <span>Target bulan ini · {monthName}</span>
            <Chip sig={mSig} done={!t.isCurrent} ach={ach} />
          </div>
          {t.target > 0 ? (
            <>
              <div className="tg-big">
                <span className={`num ${mSig || ''}`}>{pct(ach)}</span>
                <span>
                  <b>{rpShort(t.real)}</b> terfaktur dari target <b>{rpShort(t.target)}</b>
                </span>
              </div>
              <Bar ach={ach} git={showGit ? t.git / t.target : 0} pace={t.isCurrent ? t.pace : null} sig={mSig} />
              {t.isCurrent && (
                <div className="tg-pace" style={{ paddingLeft: `${Math.min(80, t.pace * 100)}%` }}>
                  seharusnya {pct(t.pace)} · hari kerja ke-{t.elapsed}/{t.workdays}
                </div>
              )}
              <div className="tg-facts">
                {t.isCurrent ? (
                  <>
                    <Fact label={sisa > 0 ? 'Sisa target' : 'Melebihi target'} value={rpShort(Math.abs(sisa))} sub={sisa > 0 ? `${left} hari kerja lagi` : 'sudah tercapai'} tone={sisa > 0 ? '' : 'ok'} />
                    <Fact label="Perlu per hari kerja" value={need == null ? '–' : rpShort(need)} sub={`rata-rata sejauh ini ${rpShort(perDay)}`} tone={need != null && need > perDay * 1.5 ? 'bad' : ''} />
                  </>
                ) : (
                  <>
                    <Fact label={sisa > 0 ? 'Kurang dari target' : 'Lebih dari target'} value={rpShort(Math.abs(sisa))} sub="bulan sudah selesai" tone={sisa > 0 ? 'bad' : 'ok'} />
                    <Fact label="Rata-rata per hari kerja" value={rpShort(t.workdays ? t.real / t.workdays : 0)} sub={`${t.workdays} hari kerja`} />
                  </>
                )}
                <Fact label="GIT belum faktur" value={rpShort(t.git)} sub={t.git ? `bila terfaktur → ${pct(ratio(t.real + t.git, t.target))}` : 'tidak ada DO belum faktur'} tone="git" />
              </div>
            </>
          ) : (
            <div className="tg-empty">
              Target {monthName} untuk <b>{scopeText}</b> belum diisi (KPI › Atur target). Omzet terfaktur bulan ini <b>{rpShort(t.real)}</b>
              {t.git ? <>, GIT <b>{rpShort(t.git)}</b></> : null}.
            </div>
          )}
        </div>

        <div className="tg-card">
          <div className="tg-card-head">
            <span>YTD · Januari – {monthName}</span>
            <Chip sig={ySig} />
          </div>
          <div className="tg-big">
            <span className={`num ${ySig || ''}`}>{pct(yAch)}</span>
            <span>
              <b>{rpShort(t.ytdReal)}</b> dari target <b>{rpShort(t.ytdTarget)}</b>
              {t.isCurrent && t.ytdTargetFull !== t.ytdTarget && <small> (s.d. hari ini; penuh s.d. {BLN3[month - 1]} {rpShort(t.ytdTargetFull)})</small>}
            </span>
          </div>
          <div className="tg-chart" role="group" aria-label="Target dan terfaktur per bulan">
            {shown.map((m) => {
              const a = ratio(m.real, m.target);
              const live = t.isCurrent && m.month === month;
              const sig = achSignal(a == null ? null : live ? (t.pace ? a / t.pace : null) : a);
              const g = showGit && m.month === month ? m.git : 0;
              const label = `${BULAN_LIST[m.month - 1].l}: ${rpShort(m.real)} dari target ${rpShort(m.target)} (${pct(a)})`;
              return (
                <button key={m.month} type="button" className={`col ${m.month === month ? 'on' : ''}`} onClick={() => setMonth(m.month)} title={label} aria-label={label}>
                  <span className={`p ${sig || ''}`}>{pct(a)}</span>
                  <span className="area">
                    {m.target > 0 && <span className="t" style={{ height: `${(m.target / maxV) * 100}%` }} />}
                    <span className={`r ${sig || ''}`} style={{ height: `${(m.real / maxV) * 100}%` }} />
                    {g > 0 && <span className="g" style={{ bottom: `${(m.real / maxV) * 100}%`, height: `${(g / maxV) * 100}%` }} />}
                  </span>
                  <span className="l">{BLN3[m.month - 1]}</span>
                </button>
              );
            })}
          </div>
          <div className="tg-facts">
            <Fact
              label={t.ytdReal >= t.ytdTarget ? 'Lebih dari target YTD' : 'Kurang dari target YTD'}
              value={rpShort(Math.abs(t.ytdTarget - t.ytdReal))}
              sub={`bulan tercapai ${hitMonths} dari ${closedMonths.length}`}
              tone={t.ytdReal >= t.ytdTarget ? 'ok' : 'bad'}
            />
            <Fact label="Proyeksi akhir tahun" value={rpShort(t.runRate)} sub={`run-rate · ${pct(proj)} target ${year}`} tone={achSignal(proj) || ''} />
            <Fact label={`Target ${year}`} value={rpShort(t.yearTarget)} sub={`sisa ${rpShort(Math.max(0, t.yearTarget - t.ytdReal))} · ${12 - month + (t.isCurrent ? 1 : 0)} bln`} />
          </div>
        </div>
      </div>

      <div className="tg-legend">
        <span><i className="sw ok" />Terfaktur (DO sudah faktur)</span>
        {showGit && <span><i className="sw git" />GIT (DO belum faktur) — potensi</span>}
        <span><i className="sw tgt" />Target</span>
        <span><i className="sw mark" />Seharusnya s.d. hari ini (hari kerja Senin–Jumat)</span>
      </div>

      {rows.length > 0 && (
        <>
          <div className="tg-sec-head">
            <b>Rincian per cabang · {monthName}</b>
            <span className="field-note" style={{ margin: 0 }}>Urut dari capaian terendah · klik baris untuk melihat cabang itu</span>
          </div>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table tg-table">
              <thead>
                <tr>
                  <th>Cabang</th>
                  <th className="r">Target</th>
                  <th className="r">Terfaktur</th>
                  <th className="r">GIT</th>
                  <th style={{ minWidth: 220 }}>Capaian {t.isCurrent ? 'vs laju' : ''}</th>
                  <th className="r">Target YTD</th>
                  <th className="r">Terfaktur YTD</th>
                  <th style={{ minWidth: 170 }}>Capaian YTD</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.cabang} className={cabang === r.cabang ? 'on' : ''} onClick={() => setCabang(cabang === r.cabang ? '' : r.cabang)} title={`Lihat ${r.cabang}`}>
                    <td><b>{r.cabang}</b></td>
                    <td className="r mono">{r.target ? rpShort(r.target) : '–'}</td>
                    <td className="r mono">{rpShort(r.real)}</td>
                    <td className="r mono tg-gitc">{r.git ? rpShort(r.git) : '–'}</td>
                    <td>
                      {r.target > 0 ? (
                        <div className="tg-cell">
                          <Bar small ach={r.a} git={showGit ? r.git / r.target : 0} pace={t.isCurrent ? t.pace : null} sig={achSignal(r.vp)} />
                          <span className={`mono ${achSignal(r.vp) || ''}`}>{pct(r.a)}</span>
                        </div>
                      ) : (
                        <span className="badge rust">Target belum diisi</span>
                      )}
                    </td>
                    <td className="r mono">{r.ytdTarget ? rpShort(r.ytdTarget) : '–'}</td>
                    <td className="r mono">{rpShort(r.ytdReal)}</td>
                    <td>
                      <div className="tg-cell">
                        <Bar small ach={r.ya} git={0} pace={null} sig={achSignal(r.ya)} />
                        <span className={`mono ${achSignal(r.ya) || ''}`}>{pct(r.ya)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {all && (
                  <tr className="total">
                    <td>Total</td>
                    <td className="r mono">{rpShort(all.target)}</td>
                    <td className="r mono">{rpShort(all.real)}</td>
                    <td className="r mono tg-gitc">{rpShort(all.git)}</td>
                    <td className="mono">{pct(ratio(all.real, all.target))}{all.isCurrent ? ` (laju ${pct(all.pace)})` : ''}</td>
                    <td className="r mono">{rpShort(all.ytdTarget)}</td>
                    <td className="r mono">{rpShort(all.ytdReal)}</td>
                    <td className="mono">{pct(ratio(all.ytdReal, all.ytdTarget))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="field-note" style={{ marginTop: 10 }}>
        Target = budget per cabang per bulan (KPI › Atur target; bulan tanpa target memakai target terakhir, sama dengan KPI Scorecard). Pencapaian = DO terfaktur, dibukukan
        pada bulan tanggal delivery (tanggal PO bila delivery kosong). Target YTD bulan berjalan dihitung proporsional hari kerja.
      </div>
    </>
  );
}

function Fact({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="tg-fact">
      <span className="lb">{label}</span>
      <span className={`v mono ${tone}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
