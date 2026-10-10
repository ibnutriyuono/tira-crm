'use client';

import { useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { appendSheet } from '@/lib/exports';
import { formatRupiah } from '@/lib/format';
import { formatTon } from '@/lib/item-flow';
import {
  SHAPE_GROUPS,
  TREND_THRESHOLD,
  analyzeTrend,
  buildTrendRows,
  type Basis,
  type Measure,
} from '@/lib/material-trend';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const mLabel = (m: string) => `${BULAN[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const pct = (v: number | null) => (v == null ? '-' : `${Math.round(v * 100)}%`);

function rpShort(n: number): string {
  if (n >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
  return formatRupiah(n);
}

function trendBadge(v: number | null) {
  if (v == null) return <span className="badge slate">Baru</span>;
  const s = `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  if (v > TREND_THRESHOLD) return <span className="badge green">Naik {s}</span>;
  if (v < -TREND_THRESHOLD) return <span className="badge rust">Turun {s}</span>;
  return <span className="badge slate">Stabil {s}</span>;
}

const BASIS_LABEL: Record<Basis, string> = { off: 'ditawarkan', po: 'PO', kirim: 'terkirim' };
const MEASURE_LABEL: Record<Measure, string> = { kg: 'Tonase', pcs: 'Pcs', nilai: 'Nilai' };

/**
 * Analisa Eksekutif > Product: tren material per grade dan ukuran dari data
 * penawaran (lib/material-trend.ts), dalam cakupan role yang membukanya.
 */
export function ProductTab({ prospects, scopeLabel, cabangs, thisMonth }: { prospects: Prospect[]; scopeLabel: string; cabangs: string[] | null; thisMonth: string }) {
  const toast = useDataStore((s) => s.toast);
  const [cabang, setCabang] = useState('');
  const [period, setPeriod] = useState(12);
  const [end, setEnd] = useState(thisMonth);
  const [group, setGroup] = useState('');
  const [basis, setBasis] = useState<Basis>('off');
  const [measure, setMeasure] = useState<Measure>('kg');
  const [sel, setSel] = useState('');

  const rows = useMemo(() => buildTrendRows(cabang ? prospects.filter((p) => (p.cabang || '').trim().toUpperCase() === cabang) : prospects), [prospects, cabang]);
  const t = useMemo(() => analyzeTrend(rows, { end: end || thisMonth, period, group, basis, measure }), [rows, end, thisMonth, period, group, basis, measure]);
  const selKey = sel && t.grades.some((g) => g.key === sel) ? sel : t.grades[0]?.key || '';
  const selGrade = t.grades.find((g) => g.key === selKey);
  const monthly = useMemo(() => (selKey ? t.monthly(selKey) : []), [t, selKey]);
  const maxM = Math.max(1, ...monthly.map((m) => Math.max(m.off, m.po)));

  const fmt = (v: number) => (measure === 'kg' ? formatTon(v, 1) : measure === 'nilai' ? rpShort(v) : v.toLocaleString('id-ID', { maximumFractionDigits: 0 }));
  const label = `${MEASURE_LABEL[measure]} ${BASIS_LABEL[basis]}`;
  const periodText = `${mLabel(t.months[0])} – ${mLabel(t.months[t.months.length - 1])}`;
  const fromIdx = 12 - period;
  const scopeText = cabang ? `Cabang ${cabang}` : scopeLabel;

  async function exportExcel() {
    if (!t.grades.length) return toast('Tidak ada data material pada periode ini', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, {
      sheetName: 'Top Grade',
      header: ['GRADE', 'PENAWARAN', 'CUSTOMER', `PCS ${BASIS_LABEL[basis].toUpperCase()}`, 'KG DITAWARKAN', 'KG PO', 'KG TERKIRIM', 'NILAI PO', 'RP/KG PO', 'KONVERSI KG', 'TREN 3 BLN', 'UKURAN TERBANYAK'],
      rows: t.grades.map((g) => [g.grade, g.offers, g.customers, Math.round(g.pcs), Math.round(g.offKg), Math.round(g.poKg), Math.round(g.sentKg), Math.round(g.nilaiPo), Math.round(g.rpKg), g.conv == null ? '' : Math.round(g.conv * 100) / 100, g.trend == null ? '' : Math.round(g.trend * 100) / 100, g.topBucket]),
      colWidths: [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 16 }],
      numFormats: { 4: '#,##0', 5: '#,##0', 6: '#,##0', 7: '#,##0', 8: '#,##0', 9: '0%', 10: '+0%;-0%' },
    });
    appendSheet(XLSX, wb, {
      sheetName: 'Grade x Ukuran',
      header: ['GRADE', ...t.buckets.map((b) => `${b} mm`), 'TOTAL'],
      rows: t.heat.map((h) => [h.grade, ...h.cells.map((c) => Math.round(c)), Math.round(h.total)]),
      colWidths: [{ wch: 16 }, ...t.buckets.map(() => ({ wch: 12 })), { wch: 12 }],
    });
    appendSheet(XLSX, wb, {
      sheetName: 'Naik Turun',
      header: ['ARAH', 'GRADE', 'UKURAN', '3 BLN SEBELUMNYA', '3 BLN TERAKHIR', 'PERUBAHAN'],
      rows: [...t.up.map((m) => ['Naik', m.grade, m.bucket, Math.round(m.prev), Math.round(m.last), Math.round(m.change * 100) / 100]), ...t.down.map((m) => ['Turun', m.grade, m.bucket, Math.round(m.prev), Math.round(m.last), Math.round(m.change * 100) / 100])],
      colWidths: [{ wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 12 }],
      numFormats: { 5: '+0%;-0%' },
    });
    if (t.fab.length) {
      appendSheet(XLSX, wb, {
        sheetName: 'Line 05 Fabrikasi',
        header: ['PEKERJAAN', 'SATUAN', 'PENAWARAN', 'QTY DITAWARKAN', 'QTY PO', 'KONVERSI'],
        rows: t.fab.map((f) => [f.label, f.satuan, f.offers, f.off, f.po, f.conv == null ? '' : Math.round(f.conv * 100) / 100]),
        colWidths: [{ wch: 36 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }],
        numFormats: { 5: '0%' },
      });
    }
    XLSX.writeFile(wb, `Tren_Material_${t.group.key}_${scopeText.replace(/[^\w-]+/g, '_')}_${t.months[0]}_sd_${t.months[t.months.length - 1]}.xlsx`);
    toast('Export tren material berhasil', 'success');
  }

  const seg = <T extends string>(val: T, cur: T, set: (v: T) => void, text: string) => (
    <button key={val} type="button" className={`btn btn-sm ${cur === val ? 'btn-primary' : 'btn-outline'}`} onClick={() => set(val)}>
      {text}
    </button>
  );

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        {cabangs && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label="Cabang">
            <option value="">Semua cabang</option>
            {cabangs.map((c) => (
              <option key={c} value={c}>Cabang {c}</option>
            ))}
          </select>
        )}
        <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} style={{ maxWidth: 160 }} aria-label="Periode">
          <option value={3}>3 bulan</option>
          <option value={6}>6 bulan</option>
          <option value={12}>12 bulan</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>s/d</span>
        <input type="month" value={end} onChange={(e) => setEnd(e.target.value || thisMonth)} style={{ maxWidth: 160 }} aria-label="Sampai bulan" />
        <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ maxWidth: 230 }} aria-label="Bentuk">
          <option value="">Bentuk: otomatis (terbesar)</option>
          {SHAPE_GROUPS.map((g) => (
            <option key={g.key} value={g.key}>{g.label}{t.groupTotals[g.key] ? ` · ${formatTon(t.groupTotals[g.key], 1)}` : ''}</option>
          ))}
        </select>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {seg<Basis>('off', basis, setBasis, 'Ditawarkan')}
          {seg<Basis>('po', basis, setBasis, 'PO')}
          {seg<Basis>('kirim', basis, setBasis, 'Terkirim')}
        </span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {seg<Measure>('kg', measure, setMeasure, 'Tonase')}
          {seg<Measure>('pcs', measure, setMeasure, 'Pcs')}
          {seg<Measure>('nilai', measure, setMeasure, 'Nilai')}
        </span>
        <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel}>
          <IconDownload /> Excel
        </button>
      </div>
      <div className="field-note" style={{ marginTop: -6, marginBottom: 12 }}>
        <b>{t.group.label}</b> · {periodText} · {scopeText}. Ditawarkan = bulan tgl penawaran · PO = qty PO per item, bulan tgl PO · Terkirim = qty terkirim, bulan tgl delivery.
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Tonase Ditawarkan</div>
          <div className="value">{formatTon(t.kpi.offKg, 1)}</div>
          <div className="foot">{t.group.label}</div>
        </div>
        <div className="kpi won">
          <div className="label">Tonase PO</div>
          <div className="value">{formatTon(t.kpi.poKg, 1)}</div>
          <div className="foot">Terkirim {formatTon(t.kpi.sentKg, 1)}</div>
        </div>
        <div className="kpi">
          <div className="label">Konversi Tonase</div>
          <div className="value">{pct(t.kpi.conv)}</div>
          <div className="foot">PO ÷ ditawarkan</div>
        </div>
        <div className="kpi aktif">
          <div className="label">Nilai PO</div>
          <div className="value" title={formatRupiah(t.kpi.nilaiPo)}>{rpShort(t.kpi.nilaiPo)}</div>
          <div className="foot">Rata-rata {t.kpi.rpKg ? `${formatRupiah(Math.round(t.kpi.rpKg))}/kg` : '-'}</div>
        </div>
        <div className="kpi">
          <div className="label">Grade Aktif</div>
          <div className="value">{t.kpi.grades}</div>
          <div className="foot">Top: {t.grades[0]?.grade || '-'}</div>
        </div>
      </div>

      <Sec title={`Top Grade — urut ${label}`} note="Klik baris untuk grafik bulanan grade tersebut.">
        {t.grades.length === 0 ? (
          <div className="field-note">Belum ada material {t.group.label} pada periode ini.</div>
        ) : (
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th>#</th><th>Grade</th><th style={{ textAlign: 'right' }}>Penawaran</th><th style={{ textAlign: 'right' }}>Customer</th><th style={{ textAlign: 'right' }}>Pcs</th>
                  <th style={{ textAlign: 'right' }}>Ditawarkan</th><th style={{ textAlign: 'right' }}>PO</th><th style={{ textAlign: 'right' }}>Terkirim</th><th style={{ textAlign: 'right' }}>Rp/kg PO</th>
                  <th>Konversi</th><th>Tren 3 bln</th><th>12 bulan</th>
                </tr>
              </thead>
              <tbody>
                {t.grades.slice(0, 20).map((g, i) => {
                  const maxS = Math.max(1, ...g.series);
                  return (
                    <tr key={g.key} className={`tm-row${g.key === selKey ? ' sel' : ''}`} onClick={() => setSel(g.key)}>
                      <td className="mono">{i + 1}</td>
                      <td><b>{g.grade}</b></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{g.offers}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{g.customers}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{Math.round(g.pcs).toLocaleString('id-ID')}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatTon(g.offKg, 1)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatTon(g.poKg, 1)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatTon(g.sentKg, 1)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{g.rpKg ? formatRupiah(Math.round(g.rpKg)) : '-'}</td>
                      <td style={{ minWidth: 90 }}>
                        <div className="line-kpi-bar"><span style={{ width: `${Math.min(100, Math.round((g.conv || 0) * 100))}%` }} /></div>
                        <span className="mono" style={{ fontSize: 11 }}>{pct(g.conv)}</span>
                      </td>
                      <td>{trendBadge(g.trend)}</td>
                      <td>
                        <span className="tm-spark" aria-hidden="true">
                          {g.series.map((v, k) => (
                            <span key={k} className={k >= fromIdx ? 'in' : ''} style={{ height: `${Math.max(2, Math.round((v / maxS) * 24))}px` }} />
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Sec>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <Sec title={`Peta Grade × ${t.group.dimLabel}`} note={`${label} · ${periodText}. Makin gelap makin besar.`}>
          {t.heat.length === 0 ? (
            <div className="field-note">Tidak ada data.</div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table tm-heat" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Grade</th>
                    {t.buckets.map((b) => (
                      <th key={b} style={{ textAlign: 'center' }}>{b}</th>
                    ))}
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {t.heat.slice(0, 15).map((h) => (
                    <tr key={h.key}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 700, background: h.key === selKey ? 'var(--amber-100)' : undefined }}>{h.grade}</td>
                      {h.cells.map((v, k) => {
                        const r = t.heatMax ? v / t.heatMax : 0;
                        return (
                          <td key={k} className="cell" title={`${h.grade} · ${t.buckets[k]}: ${fmt(v)}`} style={{ background: v > 0 ? `rgba(36,73,107,${(0.06 + 0.88 * r).toFixed(2)})` : undefined, color: r > 0.45 ? '#fff' : undefined }}>
                            {v > 0 ? fmt(v) : '–'}
                          </td>
                        );
                      })}
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(h.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sec>

        <Sec title={`Bulanan — ${selGrade?.grade || '-'}`} note={`${MEASURE_LABEL[measure]} ditawarkan vs PO, 12 bulan s/d ${mLabel(t.series12[11])}.`}>
          <div className="if-legend" style={{ marginBottom: 6 }}>
            <span><i style={{ background: '#9FB7CC' }} />Ditawarkan</span>
            <span><i style={{ background: '#A8701F' }} />PO</span>
          </div>
          <div className="tm-chart">
            {monthly.map((m, k) => (
              <div key={m.month} className="col" style={{ opacity: k < fromIdx ? 0.35 : 1 }} title={`${mLabel(m.month)} — ditawarkan ${fmt(m.off)}, PO ${fmt(m.po)}`}>
                <span className="o" style={{ height: `${Math.round((m.off / maxM) * 100)}%` }} />
                <span className="w" style={{ height: `${Math.round((m.po / maxM) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="tm-chart-lbl">
            {monthly.map((m) => (
              <span key={m.month}>{mLabel(m.month)}</span>
            ))}
          </div>
          {selGrade && (
            <div className="import-summary">
              Tren 3 bulan {trendBadge(selGrade.trend)} · Ukuran terbanyak <b>{selGrade.topBucket}</b> · Konversi <b>{pct(selGrade.conv)}</b>
            </div>
          )}
        </Sec>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        {(
          [
            ['Material Naik', t.up],
            ['Material Turun', t.down],
          ] as const
        ).map(([title, list]) => (
          <Sec key={title} title={title} note={`Grade + ukuran, 3 bulan terakhir vs 3 bulan sebelumnya (${label}). Volume minimal agar 1 order besar tidak terbaca sebagai tren.`}>
            {list.length === 0 ? (
              <div className="field-note">Belum ada kombinasi yang memenuhi syarat.</div>
            ) : (
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr><th>Grade</th><th>Ukuran</th><th style={{ textAlign: 'right' }}>3 bln sebelumnya</th><th style={{ textAlign: 'right' }}>3 bln terakhir</th><th>Perubahan</th></tr>
                  </thead>
                  <tbody>
                    {list.map((m) => (
                      <tr key={`${m.grade}|${m.bucket}`}>
                        <td><b>{m.grade}</b></td>
                        <td>{m.bucket}{m.bucket.match(/\d/) ? ' mm' : ''}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmt(m.prev)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmt(m.last)}</td>
                        <td>{trendBadge(m.change)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Sec>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <Sec title="Line 05 · Fabrikasi" note={`Per qty & satuan, tidak dicampur ke tonase. ${periodText}.`}>
          {t.fab.length === 0 ? (
            <div className="field-note">Tidak ada penawaran Line 05 pada periode ini.</div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr><th>Pekerjaan</th><th style={{ textAlign: 'right' }}>Penawaran</th><th style={{ textAlign: 'right' }}>Ditawarkan</th><th style={{ textAlign: 'right' }}>PO</th><th style={{ textAlign: 'right' }}>Konversi</th></tr>
                </thead>
                <tbody>
                  {t.fab.map((f) => (
                    <tr key={`${f.label}|${f.satuan}`}>
                      <td>{f.label}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.offers}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.off.toLocaleString('id-ID')} {f.satuan}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.po.toLocaleString('id-ID')} {f.satuan}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{pct(f.conv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sec>
        <Sec title="Kualitas Data Material" note={`${t.quality.total} baris material ditawarkan pada periode ini (semua bentuk).`}>
          {t.quality.total === 0 ? (
            <div className="field-note">Tidak ada data.</div>
          ) : (
            <>
              <span className="if-bar" style={{ height: 10 }} aria-hidden="true">
                <span className="sent" style={{ width: `${(t.quality.form / t.quality.total) * 100}%` }} />
                <span style={{ width: `${(t.quality.teks / t.quality.total) * 100}%`, background: '#8FB59C' }} />
              </span>
              <div className="if-legend" style={{ margin: '6px 0 8px' }}>
                <span><i className="sent" />Form seragam {Math.round((t.quality.form / t.quality.total) * 100)}%</span>
                <span><i style={{ background: '#8FB59C' }} />Dibaca dari uraian {Math.round((t.quality.teks / t.quality.total) * 100)}%</span>
                <span><i style={{ background: '#E3E9EF' }} />Tidak terbaca {t.quality.gagal} baris</span>
              </div>
              {t.quality.examples.length > 0 && (
                <div className="field-note" style={{ fontSize: 12 }}>
                  Contoh tidak terbaca: {t.quality.examples.join('; ')}. Rapikan lewat Edit Prospek → <i>Tempel dari teks</i>.
                </div>
              )}
              <div className="field-note" style={{ fontSize: 12 }}>
                PO &amp; terkirim memakai qty per item bila sudah dikonfirmasi; prospek lama dihitung penuh (perkiraan) — lihat tab Pipeline.
              </div>
            </>
          )}
        </Sec>
      </div>
    </>
  );
}

function Sec({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, margin: '4px 0 6px' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}
