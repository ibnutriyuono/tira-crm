'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatTon } from '@/lib/item-flow';
import type { RfqQcdResult } from '@/lib/qcd-rfq';
import { fmtYmd } from '@/lib/item-stock';
import { localToday } from '@/lib/sales-activity';
import { openPurchDoc } from '@/hooks/useCrmSocket';
import { useT } from '@/store/useLangStore';
import { PeriodRange, type PeriodRangeValue } from '../analisa/PeriodRange';

const LV: { k: 'unggul' | 'setara' | 'kalah' | 'kosong'; cls: string }[] = [
  { k: 'unggul', cls: 'ok' },
  { k: 'setara', cls: 'mid' },
  { k: 'kalah', cls: 'bad' },
  { k: 'kosong', cls: 'none' },
];
const LBL = {
  cost: { unggul: 'Lebih murah', setara: 'Setara', kalah: 'Lebih mahal', kosong: 'Belum diisi' },
  delivery: { unggul: 'Lebih cepat', setara: 'Setara', kalah: 'Lebih lambat', kosong: 'Belum diisi' },
} as const;
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function CdBar({ c, kind }: { c: Record<string, number>; kind: 'cost' | 'delivery' }) {
  const n = Object.values(c).reduce((a, b) => a + b, 0);
  if (!n) return <span className="muted">–</span>;
  return (
    <div className="rq-stack" title={LV.map((l) => `${LBL[kind][l.k]}: ${c[l.k]}`).join(' · ')}>
      {LV.map((l) => (c[l.k] ? <span key={l.k} className={l.cls} style={{ width: `${(c[l.k] / n) * 100}%` }}>{Math.round((c[l.k] / n) * 100)}%</span> : null))}
    </div>
  );
}

/** Purchasing › Hasil QCD: deal dengan RFQ terjawab, tanpa nilai Rupiah. */
export function RfqQcdTab() {
  const tr = useT();
  const thisMonth = localToday().slice(0, 7);
  const [range, setRange] = useState<PeriodRangeValue>({ from: `${thisMonth.slice(0, 4)}-01`, to: thisMonth });
  const [d, setD] = useState<RfqQcdResult | null>(null);
  useEffect(() => {
    api
      .get<{ data: RfqQcdResult }>(`/api/qcd-rfq?from=${range.from}&to=${range.to}`)
      .then((r) => setD(r.data))
      .catch(() => setD(null));
  }, [range]);
  if (!d) return <div className="field-note">{tr("Memuat Hasil QCD…")}</div>;
  const maxT = Math.max(1, ...d.trend.map((t) => t.won + t.lost));
  return (
    <div className="rq">
      <div className="pi-intro">
        <b>{tr("Hasil QCD — deal dengan RFQ")}</b>
        <span>{tr("Hanya prospek yang RFQ-nya sudah dijawab Purchasing. Dihitung dalam jumlah deal / item dan tonase — tanpa nilai Rupiah.")}</span>
      </div>
      <div className="toolbar-row"><PeriodRange value={range} onChange={setRange} thisMonth={thisMonth} allowAll /></div>
      <div className="pi-kpis">
        <div className="pi-kpi ok"><span className="lb">{tr("Menang")}</span><span className="n">{d.won}</span><span className="sub">{formatTon(d.wonKg, 1)} · {d.itemsWon} {tr("item")}</span></div>
        <div className="pi-kpi bad"><span className="lb">{tr("Kalah")}</span><span className="n">{d.lost}</span><span className="sub">{formatTon(d.lostKg, 1)} · {d.itemsLost} {tr("item lepas")}</span></div>
        <div className="pi-kpi"><span className="lb">{tr("Win rate")}</span><span className="n">{d.winRate == null ? '–' : `${d.winRate}%`}</span><span className="sub">{tr("menang ÷ (menang + kalah)")}</span></div>
        <div className="pi-kpi warn"><span className="lb">{tr("Faktor utama kalah")}</span><span className="n" style={{ fontSize: 17 }}>{d.faktorKalah[0]?.label || '–'}</span><span className="sub">{d.faktorKalah.slice(1, 3).map((f) => `${f.label} ${f.n}`).join(' · ')}</span></div>
      </div>

      <div className="rq-grid">
        <div>
          <div className="rq-title">{tr("Tren bulanan (12 bulan)")}</div>
          <div className="rq-trend">
            {d.trend.map((t) => (
              <div key={t.periode} className="col" title={`${t.periode}: menang ${t.won}, kalah ${t.lost}`}>
                <span className="v">{t.won + t.lost ? `${Math.round((t.won / (t.won + t.lost)) * 100)}%` : ''}</span>
                <span className="area">
                  <span className="w" style={{ height: `${(t.won / maxT) * 100}%` }} />
                  <span className="l" style={{ height: `${(t.lost / maxT) * 100}%` }} />
                </span>
                <span className="m">{BLN[Number(t.periode.slice(5, 7)) - 1]}</span>
              </div>
            ))}
          </div>
          <div className="rq-legend"><span><i className="w" />{tr("Menang")}</span><span><i className="l" />{tr("Kalah")}</span><span>{tr("% = win rate")}</span></div>
        </div>
        <div>
          <div className="rq-title">{tr("Posisi Cost & Delivery vs kompetitor")}</div>
          <table className="simple-table" style={{ minWidth: 0 }}>
            <thead><tr><th>{tr("Aspek")}</th><th>{tr("Pada item MENANG")}</th><th>{tr("Pada item KALAH")}</th></tr></thead>
            <tbody>
              <tr><td><b>{tr("Cost (Harga)")}</b></td><td><CdBar c={d.cost.won} kind="cost" /></td><td><CdBar c={d.cost.lost} kind="cost" /></td></tr>
              <tr><td><b>{tr("Delivery")}</b></td><td><CdBar c={d.delivery.won} kind="delivery" /></td><td><CdBar c={d.delivery.lost} kind="delivery" /></td></tr>
            </tbody>
          </table>
          <div className="rq-legend"><span><i className="ok" />{tr("Lebih murah / cepat")}</span><span><i className="mid" />{tr("Setara")}</span><span><i className="bad" />{tr("Lebih mahal / lambat")}</span><span><i className="none" />{tr("Belum diisi")}</span></div>
        </div>
      </div>

      <div className="rq-grid">
        <div>
          <div className="rq-title">{tr("Kompetitor pemenang per Line / grade")}</div>
          {d.kompetitor.length === 0 ? <div className="field-note">{tr("Belum ada kompetitor tercatat.")}</div> : (
            <table className="simple-table" style={{ minWidth: 0 }}>
              <thead><tr><th>{tr("Line")}</th><th>{tr("Grade")}</th><th>{tr("Kompetitor")}</th><th className="r">{tr("Item")}</th><th className="r">{tr("Tonase")}</th></tr></thead>
              <tbody>{d.kompetitor.slice(0, 12).map((k, i) => <tr key={i}><td>{k.line}</td><td>{k.grade}</td><td><b>{k.name}</b></td><td className="r mono">{k.n}</td><td className="r mono">{formatTon(k.kg, 2)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div>
          <div className="rq-title">{tr("Material yang paling sering lepas")}</div>
          {d.lostMaterials.length === 0 ? <div className="field-note">{tr("Belum ada item yang lepas.")}</div> : (
            <table className="simple-table" style={{ minWidth: 0 }}>
              <thead><tr><th>{tr("Line")}</th><th>{tr("Grade / material")}</th><th className="r">{tr("Lepas")}</th><th className="r">{tr("Tonase")}</th><th>{tr("Kompetitor terbanyak")}</th></tr></thead>
              <tbody>{d.lostMaterials.map((m, i) => <tr key={i}><td>{m.line}</td><td><b>{m.label}</b></td><td className="r mono">{m.n}</td><td className="r mono">{formatTon(m.kg, 2)}</td><td>{m.kompetitor}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rq-title">{tr("RFQ yang kalah")} ({d.lostRfqs.length})</div>
      {d.lostRfqs.length === 0 ? <div className="field-note">{tr("Tidak ada RFQ yang kalah pada periode ini.")}</div> : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead><tr><th>{tr("No. RFQ")}</th><th>{tr("Customer")}</th><th>{tr("Cabang")}</th><th>{tr("Tgl lose")}</th><th>{tr("Kompetitor")}</th><th>{tr("Faktor")}</th><th className="r">{tr("Tonase")}</th></tr></thead>
            <tbody>
              {d.lostRfqs.map((r) => (
                <tr key={r.rfqId} className="if-row" onClick={() => openPurchDoc('RFQ', r.rfqId)} title={tr("Buka RFQ")}>
                  <td className="mono"><b>{r.noRfq}</b></td><td>{r.customer}</td><td>{r.cabang}</td><td>{fmtYmd(r.tgl)}</td><td>{r.kompetitor}</td><td>{r.faktor}</td><td className="r mono">{formatTon(r.kg, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
