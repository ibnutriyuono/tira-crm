'use client';

import type { ReactNode } from 'react';

/** Potongan tampilan kecil untuk tab Analisa Eksekutif. */
export function Section({ title, note, children, right }: { title: string; note?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="ea-sec">
      <div className="ea-sec-h">
        <b>{title}</b>
        {right}
      </div>
      {note && <div className="field-note" style={{ marginTop: 0 }}>{note}</div>}
      {children}
    </section>
  );
}

export function Table({ head, rows, right = [], empty = 'Tidak ada data', onRow }: { head: string[]; rows: ReactNode[][]; right?: number[]; empty?: string; onRow?: (i: number) => void }) {
  if (rows.length === 0) return <div className="field-note">{empty}</div>;
  return (
    <div className="table-wrap" style={{ borderTop: 'none' }}>
      <table className="simple-table ea-tbl">
        <thead>
          <tr>
            {head.map((h, j) => (
              <th key={`${h}-${j}`} className={right.includes(j) ? 'r' : ''}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={onRow ? 'if-row' : ''} onClick={onRow ? () => onRow(i) : undefined}>
              {r.map((c, j) => (
                <td key={j} className={right.includes(j) ? 'r mono' : ''}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Kpi({ label, value, foot, tone = '', title }: { label: string; value: ReactNode; foot?: ReactNode; tone?: '' | 'won' | 'lost' | 'aktif'; title?: string }) {
  return (
    <div className={`kpi ${tone}`} title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot != null && <div className="foot">{foot}</div>}
    </div>
  );
}

/** Batang horizontal sederhana dengan label & angka. */
export function Bars({ items, unit = '', color = '#2F5576', max }: { items: { label: string; value: number; sub?: string; color?: string }[]; unit?: string; color?: string; max?: number }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="field-note">Tidak ada data</div>;
  return (
    <div className="ea-bars">
      {items.map((i) => (
        <div key={i.label} className="ea-bar" title={i.sub}>
          <span className="l">{i.label}</span>
          <span className="t"><span style={{ width: `${Math.max(2, (i.value / m) * 100)}%`, background: i.color || color }} /></span>
          <span className="v mono">{i.value.toLocaleString('id-ID')}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** Kolom bertumpuk per periode (mis. aktivitas per pekan). */
export function Columns({ labels, series, height = 120 }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const tot = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const m = Math.max(1, ...tot);
  if (!labels.length) return <div className="field-note">Tidak ada data</div>;
  return (
    <div>
      <div className="ea-cols" style={{ height }}>
        {labels.map((l, i) => (
          <div key={l + i} className="ea-col" title={`${l}: ${series.map((s) => `${s.name} ${s.values[i] || 0}`).join(', ')}`}>
            <div className="stack" style={{ height: `${(tot[i] / m) * 100}%` }}>
              {series.map((s) => (s.values[i] ? <span key={s.name} style={{ flex: s.values[i], background: s.color }} /> : null))}
            </div>
            <small>{l}</small>
          </div>
        ))}
      </div>
      <div className="ea-legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
    </div>
  );
}

/** Sel berwarna berdasar nilai 0–100 (hijau baik). */
export function Heat({ v, children, invert = false }: { v: number | null; children: ReactNode; invert?: boolean }) {
  if (v == null) return <span className="ea-heat none">{children}</span>;
  const x = invert ? 100 - v : v;
  const cls = x >= 85 ? 'g' : x >= 65 ? 'a' : 'r';
  return <span className={`ea-heat ${cls}`}>{children}</span>;
}

export function Insights({ list, title = 'Temuan' }: { list: string[]; title?: string }) {
  if (!list.length) return null;
  return (
    <div className="ea-ins">
      <b>{title}</b>
      <ul>
        {list.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export const rpShort = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
};
