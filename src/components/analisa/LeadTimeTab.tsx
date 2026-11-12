'use client';

import { useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { appendSheet } from '@/lib/exports';
import { formatDateID } from '@/lib/format';
import { formatTon } from '@/lib/item-flow';
import { analyzeLeadTime, buildLeadTimeRows, dayDiff, ltStatus, rowKg, type LtEvent, type LtJanji, type LtRow, type LtSource } from '@/lib/lead-time';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { PeriodRange, normRange, quickRanges, type PeriodRangeValue } from './PeriodRange';
import { Kpi, Section } from './ui';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const mLabel = (m: string) => `${BULAN[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const dShort = (d: string) => (d ? `${Number(d.slice(8, 10))} ${BULAN[Number(d.slice(5, 7)) - 1]}` : '-');
const hari = (v: number | null | undefined) => (v == null ? '-' : `${v} hari`);
const pctT = (v: number | null) => (v == null ? '-' : `${Math.round(v * 100)}%`);
const SRC_LABEL = { stok: 'Stok', indent: 'Indent', campur: 'Stok + indent' } as const;
const SRC_TONE = { stok: 'green', indent: 'blue', campur: 'slate' } as const;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function qtyText(r: LtRow, q: number) {
  if (r.fab || !(r.kgPc > 0)) return `${q.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${r.satuan}`;
  return formatTon(rowKg(r, q), 1);
}

const srcText = (r: LtRow) => (r.source === 'indent' ? `${r.kond && r.kond !== 'Indent' ? r.kond : 'Indent'}${r.noRfq ? ` · ${r.noRfq}` : ''}` : r.kond || 'Stok');
const janjiCell = (r: LtRow) =>
  r.janjiDays != null ? `${r.janjiText} (≤ ${r.janjiDays} hr)${r.janjiFrom === 'ETA' ? ' · target tiba' : ''}` : r.source === 'indent' ? `belum ada janji${r.lamaSales ? ` · perkiraan Sales ${r.lamaSales}` : ''}` : '— (stok)';

function SrcPill({ s }: { s: 'stok' | 'indent' | 'campur' }) {
  const tone = SRC_TONE[s];
  return <span className={`badge ${tone === 'blue' ? '' : tone}`} style={tone === 'blue' ? { background: '#E7EEFB', color: '#1F4E79' } : undefined}>{SRC_LABEL[s]}</span>;
}

/** Sebaran hari PO → lunas: garis min–maks, kotak kuartil, garis median, ▼ janji. */
function Spread({ q, med, janji, max }: { q: [number, number, number, number] | null; med: number | null; janji: number | null; max: number }) {
  const X = (d: number) => `${Math.min(100, (d / max) * 100)}%`;
  if (!q) return <span className="field-note" style={{ margin: 0 }}>belum ada pengiriman lunas</span>;
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ position: 'relative', height: 18 }}>
        <div style={{ position: 'absolute', top: 8, height: 2, background: '#8A94A3', left: X(q[0]), width: `calc(${X(q[3])} - ${X(q[0])})` }} />
        <div style={{ position: 'absolute', top: 3, height: 12, borderRadius: 3, background: '#B9CBE0', border: '1px solid #1F4E79', boxSizing: 'border-box', left: X(q[1]), width: `max(3px, calc(${X(q[2])} - ${X(q[1])}))` }} />
        {med != null && <div style={{ position: 'absolute', top: 0, width: 3, height: 18, background: '#1B2430', left: X(med) }} />}
        {janji != null && <div style={{ position: 'absolute', top: -3, fontSize: 12, color: '#C9822B', left: `calc(${X(janji)} - 5px)` }} title={`Janji ${janji} hari`}>▼</div>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-soft)' }}>
        {q[0]}–{q[3]} hari{janji != null ? ` · janji ${janji} hari` : ''}
      </div>
    </div>
  );
}

/** Perjalanan satu item: permintaan → penawaran → PO → kirim → faktur. */
function Journey({ r, onClose }: { r: LtRow; onClose: () => void }) {
  const tr = useT();
  const rel = (d: string) => {
    const n = dayDiff(r.tglPO, d);
    return n === 0 ? 'H+0' : n > 0 ? `H+${n}` : `H${n}`;
  };
  const st = ltStatus(r);
  const steps: { tgl: string; t: string; d: string; src: string; tone: string }[] = [];
  if (r.tglMinta) steps.push({ tgl: r.tglMinta, t: 'Permintaan', d: 'Prospek dibuat', src: 'prospek', tone: '#8A94A3' });
  if (r.tglTawar) steps.push({ tgl: r.tglTawar, t: 'Penawaran', d: 'Tgl penawaran', src: 'prospek', tone: '#7F9BBE' });
  steps.push({ tgl: r.tglPO, t: 'PO', d: `${r.noPo || '-'} · ${qtyText(r, r.poQty)}`, src: r.poFromItem ? 'Status Item' : 'prospek', tone: '#1F4E79' });
  if (r.janjiDays != null) {
    const d = new Date(r.tglPO + 'T00:00:00');
    d.setDate(d.getDate() + r.janjiDays);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    steps.push({ tgl: iso, t: 'Batas janji', d: r.janjiFrom === 'ETA' ? `Target tiba barang (PO Indent)` : `${r.janjiText} setelah PO${r.noRfq ? ` (${r.noRfq})` : ''}`, src: r.janjiFrom === 'ETA' ? 'PO Indent' : 'RFQ', tone: '#C9822B' });
  }
  r.kirim.forEach((k, i) => {
    const isLast = i === r.kirim.length - 1 && r.lunas;
    steps.push({ tgl: k.tgl, t: `Kirim ${r.kirim.length > 1 ? i + 1 : ''}${isLast ? ' · lunas' : ''}`.replace('  ', ' '), d: `${k.docNo || 'DO'} · ${qtyText(r, k.qty)}`, src: r.kirimFromItem ? 'Status Item' : 'prospek (tgl delivery)', tone: isLast ? '#1D6B3E' : '#1F4E79' });
  });
  if (r.tglFaktur) steps.push({ tgl: r.tglFaktur, t: 'Faktur', d: 'Terfaktur (per prospek)', src: 'prospek', tone: '#C9822B' });
  steps.sort((a, b) => a.tgl.localeCompare(b.tgl));

  const last = r.kirim[r.kirim.length - 1];
  const segs = [
    r.tglMinta && r.tglTawar ? { t: 'Permintaan → penawaran', d: Math.max(0, dayDiff(r.tglMinta, r.tglTawar)), bg: '#B9CBE0', fg: '#1B2430' } : null,
    r.tawarToPo != null ? { t: 'Penawaran → PO', d: r.tawarToPo, bg: '#7F9BBE', fg: '#fff' } : null,
    r.firstDays != null ? { t: 'PO → kirim pertama', d: r.firstDays, bg: '#1F4E79', fg: '#fff' } : r.ageDays != null ? { t: 'PO → hari ini (belum kirim)', d: r.ageDays, bg: '#E8D3B5', fg: '#1B2430' } : null,
    r.lunasDays != null && r.firstDays != null && r.lunasDays > r.firstDays ? { t: 'Kirim pertama → lunas', d: r.lunasDays - r.firstDays, bg: '#3B6EA5', fg: '#fff' } : null,
    r.tglFaktur && last ? { t: 'Kirim → faktur', d: Math.max(0, dayDiff(last.tgl, r.tglFaktur)), bg: '#C9822B', fg: '#fff' } : null,
  ].filter((x): x is { t: string; d: number; bg: string; fg: string } => !!x && x.d >= 0);
  const tot = segs.reduce((s, x) => s + Math.max(1, x.d), 0) || 1;

  return (
    <div className="ea-sec" style={{ background: '#FBFCFD', border: '1px solid var(--border, #DDE3EA)', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <b style={{ fontSize: 15 }}>{r.label} · {qtyText(r, r.poQty)}</b>
          <div className="field-note" style={{ margin: '2px 0 0' }}>
            <span className="mono">{r.noPo || '-'}</span> · {r.customer} · {r.cabang}{r.se ? ` · SE ${r.se}` : ''} · {srcText(r)}
          </div>
        </div>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span className={`badge ${st.tone}`}>{st.text}{r.lunasDays != null ? ` · lunas H+${r.lunasDays}` : ''}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={onClose}>{tr('Tutup')}</button>
        </span>
      </div>
      {segs.length > 0 && (
        <>
          <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid #DDE3EA', margin: '12px 0 6px' }}>
            {segs.map((s) => (
              <div key={s.t} title={`${s.t}: ${s.d} hari`} style={{ flex: Math.max(1, s.d) / tot, background: s.bg, color: s.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {s.d} hr
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-soft)' }}>
            {segs.map((s) => (
              <span key={s.t}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.bg, verticalAlign: -1 }} /> {s.t}: {s.d} hari</span>
            ))}
          </div>
        </>
      )}
      <div style={{ marginTop: 12 }}>
        {steps.map((s, i) => (
          <div key={`${s.t}-${i}`} style={{ display: 'grid', gridTemplateColumns: '96px 20px 1fr auto', gap: 8, alignItems: 'start' }}>
            <div style={{ fontSize: 12.5, textAlign: 'right' }}>
              <b>{formatDateID(s.tgl)}</b>
              <div style={{ fontSize: 11, color: 'var(--text-soft)' }}>{rel(s.tgl)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${s.tone}`, background: s.t === 'Batas janji' ? '#fff' : s.tone, marginTop: 3, boxSizing: 'border-box' }} />
              {i < steps.length - 1 && <div style={{ flex: 1, width: 2, background: '#DDE3EA', minHeight: 14 }} />}
            </div>
            <div style={{ paddingBottom: 10 }}>
              <b style={{ fontSize: 13 }}>{s.t}</b>
              <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{s.d}</div>
            </div>
            <span className="badge slate" style={{ fontSize: 10.5 }}>{s.src}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Analisa Eksekutif > Lead Time: PO → kirim per item (Status Item), per grade,
 * stok vs indent (janji Purchasing di RFQ), PO yang belum terkirim.
 */
export function LeadTimeTab({ prospects, scopeLabel, cabangs, thisMonth, data }: { prospects: Prospect[]; scopeLabel: string; cabangs: string[] | null; thisMonth: string; data: { events: LtEvent[]; janji: LtJanji[] } | null }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [cabang, setCabang] = useState('');
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(quickRanges(thisMonth).find((q) => q.label === '12 bln')!.from, thisMonth));
  const [source, setSource] = useState<'' | LtSource>('');
  const [grade, setGrade] = useState('');
  const [sel, setSel] = useState('');
  const [itemKey, setItemKey] = useState('');
  const [openAll, setOpenAll] = useState(false);

  const all = useMemo(
    () => (data ? buildLeadTimeRows(cabang ? prospects.filter((p) => (p.cabang || '').trim().toUpperCase() === cabang) : prospects, data.events, data.janji, todayISO()) : []),
    [data, prospects, cabang],
  );
  const a = useMemo(() => analyzeLeadTime(all, { from: range.from, to: range.to, source, grade }), [all, range, source, grade]);
  const gradeOpts = useMemo(() => {
    const m = new Map<string, { grade: string; n: number }>();
    all.forEach((r) => m.set(r.gradeKey, { grade: r.grade, n: (m.get(r.gradeKey)?.n || 0) + 1 }));
    return Array.from(m.entries()).sort((x, y) => y[1].n - x[1].n);
  }, [all]);

  if (!data) return <div className="field-note">{tr('Memuat data Status Item…')}</div>;

  const selKey = sel && a.grades.some((g) => g.key === sel) ? sel : a.grades[0]?.key || '';
  const selGrade = a.grades.find((g) => g.key === selKey);
  const items = a.rows.filter((r) => r.gradeKey === selKey).sort((x, y) => y.tglPO.localeCompare(x.tglPO));
  const item = itemKey ? all.find((r) => r.key === itemKey) || null : null;
  // Skala mengikuti sebaran; janji yang lebih jauh ditandai di ujung kanan.
  const spreadMax = Math.max(30, ...a.grades.map((g) => g.spread?.[3] || 0)) * 1.08;
  const trendMax = Math.max(1, ...a.trend.map((t) => t.med || 0));
  const scopeText = cabang ? `Cabang ${cabang}` : scopeLabel;
  const k = a.kpi;
  const openList = openAll ? a.open : a.open.slice(0, 12);

  async function exportExcel() {
    if (!a.rows.length && !a.open.length) return toast('Tidak ada item PO pada periode ini', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const itemRow = (r: LtRow) => [
      r.noPo, r.customer, r.cabang, r.se, r.grade, r.label, srcText(r), r.noRfq, r.janjiText || (r.lamaSales ? `perkiraan Sales ${r.lamaSales}` : ''), r.janjiDays ?? '',
      r.poQty, r.fab ? r.satuan : 'pcs', Math.round(rowKg(r, r.poQty)), r.tglTawar, r.tglPO, r.tawarToPo ?? '',
      r.kirim.map((x) => `${x.tgl} (${x.qty})${x.docNo ? ` ${x.docNo}` : ''}`).join('; '), r.firstDays ?? '', r.lunasDays ?? '', r.ageDays ?? '',
      ltStatus(r).text, r.kirimFromItem ? 'Status Item' : r.kirim.length ? 'Tgl delivery prospek' : '-',
    ];
    const itemHead = ['NO PO', 'CUSTOMER', 'CABANG', 'SE', 'GRADE', 'ITEM', 'SUMBER', 'NO RFQ', 'JANJI', 'JANJI (HARI)', 'QTY PO', 'SATUAN', 'KG PO', 'TGL PENAWARAN', 'TGL PO', 'PENAWARAN→PO (HARI)', 'PENGIRIMAN', 'PO→KIRIM PERTAMA', 'PO→LUNAS', 'UMUR PO TERBUKA', 'STATUS', 'TANGGAL KIRIM DARI'];
    const itemW = [16, 28, 8, 6, 14, 34, 8, 14, 14, 10, 8, 7, 9, 12, 12, 12, 40, 12, 10, 12, 18, 18].map((wch) => ({ wch }));
    appendSheet(XLSX, wb, { sheetName: 'Per Item', header: itemHead, rows: a.rows.map(itemRow), colWidths: itemW });
    appendSheet(XLSX, wb, {
      sheetName: 'Per Grade',
      header: ['GRADE', 'SUMBER', 'ITEM PO', 'PENAWARAN→PO MEDIAN', 'PO→LUNAS MEDIAN', 'RATA-RATA', 'MIN', 'KUARTIL 1', 'KUARTIL 3', 'MAKS', 'JANJI MEDIAN', 'TEPAT JANJI', 'DINILAI', 'BELUM KIRIM', 'DATA PER ITEM'],
      rows: a.grades.map((g) => [g.grade, SRC_LABEL[g.source], g.n, g.tawarMed ?? '', g.med ?? '', g.avg == null ? '' : Math.round(g.avg * 10) / 10, g.spread?.[0] ?? '', g.spread?.[1] ?? '', g.spread?.[2] ?? '', g.spread?.[3] ?? '', g.janjiMed ?? '', g.onTime, g.judged, g.open, g.perItem]),
      colWidths: [16, 12, 8, 14, 12, 10, 6, 9, 9, 6, 11, 10, 8, 10, 12].map((wch) => ({ wch })),
    });
    appendSheet(XLSX, wb, { sheetName: 'PO Belum Terkirim', header: [...itemHead, 'SISA QTY'], rows: a.open.map((r) => [...itemRow(r), r.openQty]), colWidths: [...itemW, { wch: 9 }] });
    XLSX.writeFile(wb, `Lead_Time_${scopeText.replace(/[^\w-]+/g, '_')}_${range.from || 'semua'}_sd_${range.to || 'semua'}.xlsx`);
    toast('Export lead time berhasil', 'success');
  }

  const seg = (val: '' | LtSource, text: string) => (
    <button key={val || 'all'} type="button" className={`btn btn-sm ${source === val ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSource(val)}>
      {text}
    </button>
  );

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        {cabangs && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua cabang')}</option>
            {cabangs.map((c) => (
              <option key={c} value={c}>{tr('Cabang')} {c}</option>
            ))}
          </select>
        )}
        <PeriodRange value={range} onChange={(v) => v.from && setRange(v)} thisMonth={thisMonth} />
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {seg('', 'Semua')}
          {seg('stok', 'Stok')}
          {seg('indent', 'Indent')}
        </span>
        <select value={grade} onChange={(e) => setGrade(e.target.value)} style={{ maxWidth: 200 }} aria-label={tr('Grade')}>
          <option value="">{tr('Semua grade')}</option>
          {gradeOpts.map(([key, g]) => (
            <option key={key} value={key}>{g.grade} · {g.n}</option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={exportExcel}>
          <IconDownload /> {tr('Export Excel')}
        </button>
      </div>
      <div className="field-note" style={{ marginTop: -4, marginBottom: 10 }}>
        {tr('Item PO dengan tanggal PO di periode ini')} · <b>{scopeText}</b> · {a.rows.length} {tr('item')}. {tr('Hari kalender sejak tanggal PO.')}
      </div>

      <div className="kpi-grid">
        <Kpi label={tr('PO → kirim lunas (median)')} value={hari(k.lunasMed)} foot={`Stok ${hari(k.stokMed)} · Indent ${hari(k.indentMed)}`} />
        <Kpi label={tr('PO → kirim pertama')} value={hari(k.firstMed)} foot={k.bertahapPct == null ? '-' : `${pctT(k.bertahapPct)} item dikirim bertahap`} />
        <Kpi label={tr('Tepat janji Purchasing')} value={pctT(k.onTimePct)} foot={k.judged ? `${k.onTime} dari ${k.judged} item indent` : tr('belum ada item indent yang bisa dinilai')} />
        <Kpi label={tr('PO belum terkirim')} value={`${k.openN} item`} foot={`${formatTon(k.openKg, 1)} · ${k.open60} item > 60 hari`} tone={k.open60 ? 'lost' : ''} />
        <Kpi label={tr('Penawaran → PO (median)')} value={hari(k.tawarMed)} foot={k.tawarFast ? `tercepat ${k.tawarFast} · terlama ${k.tawarSlow}` : tr('per prospek')} />
      </div>

      <Section title={tr('Lead time per grade — urut jumlah item PO')} note={tr('Sebaran hari PO → lunas: garis = min–maks, kotak = kuartil 1–3, garis tebal = median, ▼ = janji Purchasing. Klik baris untuk melihat itemnya.')}>
        {a.grades.length === 0 ? (
          <div className="field-note">{tr('Tidak ada item PO pada periode ini.')}</div>
        ) : (
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table ea-tbl">
              <thead>
                <tr>
                  <th>{tr('Grade')}</th>
                  <th>{tr('Sumber')}</th>
                  <th className="r">{tr('Item PO')}</th>
                  <th className="r">{tr('Penawaran → PO')}</th>
                  <th className="r">{tr('PO → lunas')}</th>
                  <th className="r">{tr('Rata-rata')}</th>
                  <th>{tr('Sebaran')}</th>
                  <th>{tr('Tepat janji')}</th>
                  <th className="r">{tr('Belum kirim')}</th>
                  <th>{tr('Data')}</th>
                </tr>
              </thead>
              <tbody>
                {a.grades.map((g) => (
                  <tr key={g.key} className="if-row" style={g.key === selKey ? { background: '#FFF4E5' } : undefined} onClick={() => { setSel(g.key); setItemKey(''); }}>
                    <td><b>{g.grade}</b></td>
                    <td><SrcPill s={g.source} /></td>
                    <td className="r mono">{g.n}</td>
                    <td className="r mono">{hari(g.tawarMed)}</td>
                    <td className="r mono"><b>{hari(g.med)}</b></td>
                    <td className="r mono">{g.avg == null ? '-' : `${g.avg.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`}</td>
                    <td><Spread q={g.spread} med={g.med} janji={g.janjiMed} max={spreadMax} /></td>
                    <td>{g.judged ? <span className={`badge ${g.onTime === g.judged ? 'green' : g.onTime / g.judged >= 0.5 ? 'amber' : 'rust'}`}>{g.onTime}/{g.judged}</span> : <span className="field-note" style={{ margin: 0 }}>—</span>}</td>
                    <td className="r mono">{g.open ? `${g.open} item` : '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-soft)' }}>{g.lunasN || g.open < g.n ? `${g.perItem}/${g.n} per item` : 'belum ada kirim'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {selGrade && (
        <Section title={`${tr('Per item')} — ${selGrade.grade}`} note={tr('Klik baris untuk melihat perjalanan item: permintaan → penawaran → PO → kirim → faktur.')}>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table ea-tbl">
              <thead>
                <tr>
                  <th>{tr('No. PO')}</th>
                  <th>{tr('Customer')}</th>
                  <th>{tr('Item')}</th>
                  <th>{tr('Sumber')}</th>
                  <th className="r">{tr('Qty PO')}</th>
                  <th>{tr('Tgl PO')}</th>
                  <th>{tr('Pengiriman')}</th>
                  <th className="r">{tr('Hari s/d lunas')}</th>
                  <th>{tr('Janji')}</th>
                  <th>{tr('Status')}</th>
                  <th>{tr('Tanggal dari')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const st = ltStatus(r);
                  return (
                    <tr key={r.key} className="if-row" style={r.key === itemKey ? { background: '#FFF4E5' } : undefined} onClick={() => setItemKey(r.key === itemKey ? '' : r.key)}>
                      <td className="mono" style={{ fontSize: 12 }}>{r.noPo || '-'}</td>
                      <td>{r.customer}<div style={{ fontSize: 11, color: 'var(--text-soft)' }}>{r.cabang}{r.se ? ` · ${r.se}` : ''}</div></td>
                      <td>{r.label}</td>
                      <td style={{ fontSize: 12 }}>{srcText(r)}</td>
                      <td className="r mono">{qtyText(r, r.poQty)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateID(r.tglPO)}</td>
                      <td style={{ fontSize: 12 }}>
                        {r.kirim.length ? r.kirim.map((x, i) => (
                          <div key={i} style={{ whiteSpace: 'nowrap' }}><b>+{x.days} hr</b> {dShort(x.tgl)} · {qtyText(r, x.qty)}</div>
                        )) : <span style={{ color: 'var(--text-soft)' }}>belum · 0 / {qtyText(r, r.poQty)}</span>}
                      </td>
                      <td className="r mono"><b>{r.lunasDays != null ? r.lunasDays : r.ageDays != null ? `${r.ageDays} (berjalan)` : '-'}</b></td>
                      <td style={{ fontSize: 12 }}>{janjiCell(r)}</td>
                      <td><span className={`badge ${st.tone}`}>{st.text}</span></td>
                      <td style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{r.kirimFromItem ? 'tanggal per item' : r.kirim.length ? 'tanggal prospek' : r.poFromItem ? 'tanggal per item' : 'tanggal prospek'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {item && <div style={{ marginTop: 12 }}><Journey r={item} onClose={() => setItemKey('')} /></div>}
        </Section>
      )}

      <Section title={tr('PO belum terkirim — umur sejak PO')} note={tr('Kondisi saat ini (tidak dibatasi periode), mengikuti filter cabang, sumber dan grade.')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
          {a.aging.map((b, i) => (
            <div key={b.label} style={{ border: `1px solid ${i === 3 && b.n ? '#E3A39C' : '#DDE3EA'}`, background: i === 3 && b.n ? '#FFF5F4' : '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{b.label}</div>
              <b style={{ fontSize: 16 }}>{b.n} item</b> <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>{formatTon(b.kg, 1)}</span>
            </div>
          ))}
        </div>
        {a.open.length === 0 ? (
          <div className="field-note">{tr('Semua item PO sudah terkirim lunas.')}</div>
        ) : (
          <>
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table ea-tbl">
                <thead>
                  <tr>
                    <th>{tr('No. PO')}</th>
                    <th>{tr('Customer')}</th>
                    <th>{tr('Item')}</th>
                    <th>{tr('Sisa')}</th>
                    <th className="r">{tr('Umur')}</th>
                    <th>{tr('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {openList.map((r) => {
                    const st = ltStatus(r);
                    return (
                      <tr key={r.key} className="if-row" onClick={() => { setSel(r.gradeKey); setItemKey(r.key); }}>
                        <td className="mono" style={{ fontSize: 12 }}>{r.noPo || '-'}</td>
                        <td>{r.customer}<div style={{ fontSize: 11, color: 'var(--text-soft)' }}>{r.cabang}{r.se ? ` · ${r.se}` : ''}</div></td>
                        <td>{r.label}</td>
                        <td style={{ fontSize: 12 }}>sisa {qtyText(r, r.openQty)}{r.sentQty > 0 ? ` dari ${qtyText(r, r.poQty)}` : ''} · {r.janjiDays != null ? `janji ${r.janjiText}` : r.source === 'indent' ? 'indent, belum ada janji' : 'stok'}</td>
                        <td className="r mono"><b>{r.ageDays} hr</b></td>
                        <td><span className={`badge ${st.tone}`}>{st.text}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {a.open.length > 12 && (
              <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 8 }} onClick={() => setOpenAll(!openAll)}>
                {openAll ? tr('Tampilkan 12 teratas') : `${tr('Tampilkan semua')} (${a.open.length})`}
              </button>
            )}
          </>
        )}
      </Section>

      <Section title={tr('Tren median PO → kirim lunas')} note={tr('Per bulan item lunas terkirim, 12 bulan sampai akhir periode.')}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, padding: '0 4px' }}>
          {a.trend.map((t) => (
            <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${mLabel(t.month)}: ${t.med == null ? 'tidak ada' : `${t.med} hari`} (${t.n} item)`}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{t.med ?? ''}</span>
              <div style={{ width: '100%', maxWidth: 22, height: `${((t.med || 0) / trendMax) * 100}px`, background: '#1F4E79', borderRadius: '3px 3px 0 0' }} />
              <small style={{ fontSize: 10.5, color: 'var(--text-soft)', marginTop: 3 }}>{mLabel(t.month)}</small>
            </div>
          ))}
        </div>
      </Section>

      <div className="import-summary" style={{ marginTop: 4 }}>
        <b>{tr('Kualitas data:')}</b> {a.quality.total} {tr('item PO')} · {tr('tgl PO per item')} {a.quality.poItem} · {tr('tgl kirim per item')} {a.quality.kirimItem} · {tr('memakai tgl delivery prospek')} {a.quality.kirimProspek} {tr('(hanya pengiriman pertama — lead time bisa terlihat lebih pendek / sama untuk semua item)')} · {tr('kondisi stok per item diisi')} {a.quality.kondItem} · {tr('indent / import')} {a.quality.indent}{a.quality.noJanji ? ` (${a.quality.noJanji} ${tr('tanpa janji RFQ / ETA')})` : ''}.{' '}
        {tr('Sumber = kondisi stok per item; bila belum diisi, item yang cocok dengan jawaban RFQ ber-janji dihitung Indent, selebihnya Stok. Janji = waktu delivery RFQ, atau target tiba (ETA) PO Indent.')}
      </div>
    </>
  );
}
