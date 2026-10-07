'use client';

import { useMemo, useState } from 'react';
import { MONTH_LABELS } from '@/lib/kpi';
import { STATUS_META } from '@/lib/constants';
import { formatRupiah } from '@/lib/format';
import { buildQcdDashboard } from '@/lib/qcd-analysis';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore, type ModalKey } from '@/store/useUiStore';

const SEG = [
  { k: 'unggul', color: 'var(--green-500)' },
  { k: 'setara', color: 'var(--slate-500)' },
  { k: 'kalah', color: 'var(--rust-500)' },
  { k: 'kosong', color: 'var(--slate-300)' },
] as const;

function Title({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 6px' }}>{children}</div>;
}

function StackBar({ counts, options }: { counts: Record<string, number>; options: Record<string, string> }) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (!total) return <div className="field-note" style={{ margin: 0 }}>Belum ada data</div>;
  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', background: 'var(--steel-100)' }}>
        {SEG.map((s) => (counts[s.k] ? <div key={s.k} title={`${s.k === 'kosong' ? 'Belum diisi' : options[s.k]}: ${counts[s.k]}`} style={{ width: `${(counts[s.k] / total) * 100}%`, background: s.color }} /> : null))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, marginTop: 4, color: 'var(--text-soft)' }}>
        {SEG.filter((s) => counts[s.k]).map((s) => (
          <span key={s.k}>
            <span style={{ color: s.color }}>■</span> {s.k === 'kosong' ? 'Belum diisi' : options[s.k]} {Math.round((counts[s.k] / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Dashboard QCD, main view of Hasil QCD: win rate, how we compare on Quality /
 * Cost / Delivery in won vs lost deals, the deciding factors, competitors,
 * per-branch, and the closed deals whose QCD is still incomplete (each one
 * opens the QCD form and comes back here).
 */
export function QcdDashboard({ cabangList, year, scopeLabel, returnTo = 'qcdRecap' }: { cabangList: string[]; year: string; scopeLabel: string; returnTo?: ModalKey }) {
  const prospects = useDataStore((s) => s.prospects);
  const [month, setMonth] = useState('');
  const periode = month ? `${year}-${month}` : year;
  const d = useMemo(() => buildQcdDashboard(prospects, cabangList, periode), [prospects, cabangList, periode]);
  const maxF = Math.max(1, ...d.faktor.map((f) => Math.max(f.won, f.lost)));

  function openQcd(id: string, status: number) {
    useUiStore.setState({ qcdCtx: { mode: 'kanban', statusVal: status, recordId: id, returnTo } });
    useUiStore.getState().openModal('qcd');
  }


  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <label style={{ margin: 0 }}>Bulan</label>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 170 }}>
          <option value="">Sepanjang {year}</option>
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, '0')}>
              {m} {year}
            </option>
          ))}
        </select>
        <span className="field-note" style={{ margin: 0 }}>
          Lingkup: <b>{scopeLabel}</b> · deal dihitung pada bulan ditutup (Won: Tgl PO, Lose: tanggal pindah status)
        </span>
      </div>

      <div className="kpi-grid">
        <div className="kpi won">
          <div className="label">Menang</div>
          <div className="value">{d.won}</div>
          <div className="foot">{formatRupiah(d.wonValue)}</div>
        </div>
        <div className="kpi lost">
          <div className="label">Kalah</div>
          <div className="value">{d.lost}</div>
          <div className="foot">{formatRupiah(d.lostValue)}</div>
        </div>
        <div className="kpi">
          <div className="label">Win Rate</div>
          <div className="value">{d.winRate == null ? '-' : `${d.winRate}%`}</div>
          <div className="foot">menang ÷ (menang + kalah)</div>
        </div>
        <div className="kpi aktif">
          <div className="label">QCD Lengkap</div>
          <div className="value">{d.completeness == null ? '-' : `${d.completeness}%`}</div>
          <div className="foot">
            {d.complete} dari {d.won + d.lost} deal ditutup
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 18 }}>
        <div>
          <Title>Posisi kita dibanding kompetitor</Title>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>Aspek</th>
                  <th>Pada deal MENANG</th>
                  <th>Pada deal KALAH</th>
                </tr>
              </thead>
              <tbody>
                {d.dims.map((x) => (
                  <tr key={x.key}>
                    <td>
                      <b>{x.label}</b>
                    </td>
                    <td>
                      <StackBar counts={x.won} options={x.options} />
                    </td>
                    <td>
                      <StackBar counts={x.lost} options={x.options} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <Title>Faktor penentu</Title>
          {d.faktor.length === 0 ? (
            <div className="field-note">Belum ada faktor penentu tercatat pada periode ini.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {d.faktor.map((f) => (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600 }}>{f.label}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ height: 10, width: `${(f.won / maxF) * 100}%`, minWidth: f.won ? 4 : 0, background: 'var(--green-500)', borderRadius: 5 }} />
                      <span style={{ color: 'var(--text-soft)' }}>{f.won} menang</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ height: 10, width: `${(f.lost / maxF) * 100}%`, minWidth: f.lost ? 4 : 0, background: 'var(--rust-500)', borderRadius: 5 }} />
                      <span style={{ color: 'var(--text-soft)' }}>
                        {f.lost} kalah{f.lostValue ? ` · ${formatRupiah(f.lostValue)}` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Title>Kompetitor</Title>
      {d.kompetitor.length === 0 ? (
        <div className="field-note">Belum ada kompetitor tercatat pada periode ini.</div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table" style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>Kompetitor</th>
                <th>Kita kalah</th>
                <th>Nilai hilang</th>
                <th>Kita menang</th>
                <th>Win rate vs mereka</th>
                <th>Faktor kekalahan utama</th>
                <th>Aspek terlemah kita</th>
              </tr>
            </thead>
            <tbody>
              {d.kompetitor.map((k) => (
                <tr key={k.name}>
                  <td>
                    <b>{k.name}</b>
                  </td>
                  <td>{k.lost}</td>
                  <td>{formatRupiah(k.lostValue)}</td>
                  <td>{k.won}</td>
                  <td>{k.winRate == null ? '-' : `${k.winRate}%`}</td>
                  <td>{k.topFaktor}</td>
                  <td>{k.weakDim}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.cabang.length > 1 && (
        <>
          <Title>Per cabang</Title>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Cabang</th>
                  <th>Menang</th>
                  <th>Kalah</th>
                  <th>Win rate</th>
                  <th>Faktor kekalahan utama</th>
                  <th>QCD lengkap</th>
                </tr>
              </thead>
              <tbody>
                {d.cabang.map((c) => (
                  <tr key={c.cabang}>
                    <td>
                      <b>{c.cabang}</b>
                    </td>
                    <td>{c.won}</td>
                    <td>{c.lost}</td>
                    <td>{c.winRate == null ? '-' : `${c.winRate}%`}</td>
                    <td>{c.topFaktorKalah}</td>
                    <td>
                      <span className={`badge ${c.completeness === 100 ? 'green' : (c.completeness ?? 0) >= 80 ? 'amber' : 'rust'}`}>{c.completeness ?? '-'}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Title>QCD belum lengkap ({d.incomplete.length})</Title>
      {d.incomplete.length === 0 ? (
        <div className="field-note">Semua deal yang ditutup pada periode ini sudah lengkap QCD-nya.</div>
      ) : (
        <>
          <div className="field-note" style={{ marginBottom: 6 }}>
            Deal yang ditutup sebelum QCD wajib diberlakukan. Lengkapi agar dashboard akurat — klik &quot;Isi QCD&quot;.
          </div>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Cabang</th>
                  <th>SE</th>
                  <th>Status</th>
                  <th>Nilai</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.incomplete.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.customer}</b>
                    </td>
                    <td>{r.cabang}</td>
                    <td>{r.se}</td>
                    <td>{STATUS_META[r.status]?.label ?? r.status}</td>
                    <td>{formatRupiah(r.value)}</td>
                    <td>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openQcd(r.id, r.status)}>
                        Isi QCD
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.incomplete.length > 20 && <div className="field-note">+{d.incomplete.length - 20} deal lainnya.</div>}
        </>
      )}
    </>
  );
}
