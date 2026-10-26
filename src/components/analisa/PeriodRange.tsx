'use client';

import { periodeList } from '@/lib/reports';
import { useT } from '@/store/useLangStore';

/**
 * Filter periode "Dari bulan … s/d …" + tombol cepat, sama seperti tab Sales
 * Analisa Eksekutif. Satu bulan bila keduanya sama. `from === ''` berarti
 * "Semua" (hanya bila `allowAll`).
 */
export interface PeriodRangeValue {
  from: string;
  to: string;
}

export function quickRanges(thisMonth: string, opts: { allowAll?: boolean; extra?: { label: string; from: string; to: string }[] } = {}) {
  const y = Number(thisMonth.slice(0, 4));
  const m = Number(thisMonth.slice(5, 7));
  const qStart = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}`;
  const back = (n: number) => {
    const d = new Date(y, m - n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return [
    { label: 'Bulan ini', from: thisMonth, to: thisMonth },
    { label: 'Kuartal ini', from: qStart, to: thisMonth },
    { label: 'YTD', from: `${y}-01`, to: thisMonth },
    ...(opts.extra || []),
    { label: '12 bln', from: back(12), to: thisMonth },
    { label: 'Tahun lalu', from: `${y - 1}-01`, to: `${y - 1}-12` },
    ...(opts.allowAll ? [{ label: 'Semua', from: '', to: '' }] : []),
  ];
}

/** Normalisasi: dari ≤ s/d, tidak melewati `max`. */
export function normRange(from: string, to: string, max?: string): PeriodRangeValue {
  if (!from || !to) return { from: '', to: '' };
  if (from > to) [from, to] = [to, from];
  if (max && to > max) to = max;
  if (max && from > max) from = max;
  return { from, to };
}

export function rangeMonths(r: PeriodRangeValue): string[] {
  return r.from ? periodeList(r.from, r.to) : [];
}

export function PeriodRange({
  value,
  onChange,
  thisMonth,
  max,
  allowAll,
  label = 'Periode',
  extra,
  note,
}: {
  value: PeriodRangeValue;
  onChange: (v: PeriodRangeValue) => void;
  thisMonth: string;
  max?: string;
  allowAll?: boolean;
  label?: string;
  extra?: { label: string; from: string; to: string }[];
  note?: React.ReactNode;
}) {
  const tr = useT();
  const quick = quickRanges(thisMonth, { allowAll, extra });
  const set = (from: string, to: string) => onChange(normRange(from, to, max));
  const isAll = !value.from;
  return (
    <span className="pr-range">
      <label style={{ margin: 0 }}>{tr(label)}</label>
      <input
        type="month"
        value={value.from}
        max={max}
        onChange={(e) => e.target.value && set(e.target.value, value.to || e.target.value)}
        style={{ maxWidth: 160 }}
        title={tr("Dari bulan")}
        aria-label={tr("Dari bulan")}
      />
      <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>{tr("s/d")}</span>
      <input
        type="month"
        value={value.to}
        max={max}
        onChange={(e) => e.target.value && set(value.from || e.target.value, e.target.value)}
        style={{ maxWidth: 160 }}
        title={tr("Sampai bulan")}
        aria-label={tr("Sampai bulan")}
      />
      <span className="pr-quick">
        {quick.map((q) => {
          const on = q.from ? value.from === q.from && value.to === q.to : isAll;
          return (
            <button key={q.label} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`} onClick={() => (q.from ? set(q.from, q.to) : onChange({ from: '', to: '' }))}>
              {tr(q.label)}
            </button>
          );
        })}
      </span>
      {note}
    </span>
  );
}
