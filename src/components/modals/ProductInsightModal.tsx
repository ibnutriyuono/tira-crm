'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { Insights, Kpi, Section, Table } from '../analisa/ui';
import { PeriodRange, normRange, quickRanges, type PeriodRangeValue } from '../analisa/PeriodRange';
import { appendSheet } from '@/lib/exports';
import { todayStr } from '@/lib/format';
import { formatTon } from '@/lib/item-flow';
import { gradeInsights, insightItems, insightNotes, unmetDemand } from '@/lib/product-insight';
import { parseMaterialText } from '@/lib/material-spec';
import { parseWithLexicon } from '@/lib/material-learn';
import { useMaterialLexicon } from '@/hooks/useMaterialLexicon';
import { QCD_FAKTOR_LABEL } from '@/lib/qcd';
import { canNow } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);

/**
 * Insight Produk: per grade — tonase ditawarkan vs PO, konversi, alasan kalah,
 * kompetitor pemenang, posisi harga, dan permintaan yang hilang karena stok /
 * waktu kirim. Bahan Product & Marketing untuk kampanye, harga dan stok.
 */
export function ProductInsightModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'productInsight');
  const closeModal = useUiStore((s) => s.closeModal);
  const prospects = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);
  const thisMonth = todayStr().slice(0, 7);
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(quickRanges(thisMonth).find((q) => q.label === '12 bln')!.from, thisMonth));
  const [reg, setReg] = useState('');
  const [cabang, setCabang] = useState('');
  const [sel, setSel] = useState('');

  const lex = useMaterialLexicon();
  // Uraian lama tanpa isian terstruktur dibaca ulang dengan kamus material (grade yang pernah dipakai).
  const all = useMemo(
    () =>
      show
        ? insightItems(prospects, (label) => {
            const x = parseWithLexicon(label, lex, parseMaterialText);
            return x.grade ? { grade: x.grade, bentuk: x.bentuk, dim: x.dim } : null;
          })
        : [],
    [prospects, show, lex],
  );
  const regOpts = useMemo(() => Array.from(new Set(all.map((i) => i.reg).filter((r): r is number => r != null))).sort(), [all]);
  const cabOpts = useMemo(() => Array.from(new Set(all.filter((i) => !reg || String(i.reg) === reg).map((i) => i.cabang).filter(Boolean))).sort(), [all, reg]);
  const items = useMemo(
    () => all.filter((i) => (!range.from || (i.month >= range.from && i.month <= range.to)) && (!reg || String(i.reg) === reg) && (!cabang || i.cabang === cabang)),
    [all, range, reg, cabang],
  );
  const grades = useMemo(() => gradeInsights(items), [items]);
  const unmet = useMemo(() => unmetDemand(items), [items]);
  const notes = useMemo(() => insightNotes(grades, unmet, items), [grades, unmet, items]);
  const tot = useMemo(() => {
    const off = items.reduce((s, i) => s + i.offKg, 0);
    const po = items.reduce((s, i) => s + i.poKg, 0);
    const lost = items.filter((i) => i.outcome !== 'menang');
    return { off, po, lostKg: off - po, lost: lost.length, supply: unmet.reduce((s, u) => s + u.kg, 0), noReason: lost.filter((i) => !i.faktor).length };
  }, [items, unmet]);
  const g = grades.find((x) => x.grade === sel) || null;
  const detail = useMemo(() => (g ? items.filter((i) => i.grade === g.grade && i.outcome !== 'menang').sort((a, b) => b.lostKg - a.lostKg) : []), [g, items]);

  async function exportExcel() {
    if (!grades.length) return toast(tr('Tidak ada data pada periode ini'), 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, {
      sheetName: 'Per Grade',
      header: ['GRADE', 'ITEM', 'CUSTOMER', 'KG DITAWARKAN', 'KG PO', 'KONVERSI KG %', 'MENANG', 'SEBAGIAN', 'KALAH', 'ALASAN KALAH UTAMA', 'KOMPETITOR UTAMA', 'KALAH - HARGA LEBIH MAHAL', 'KG HILANG KARENA STOK/DELIVERY'],
      rows: grades.map((x) => [x.grade, x.items, x.customers, Math.round(x.offKg), Math.round(x.poKg), x.winRate == null ? '' : Math.round(x.winRate * 100), x.menang, x.sebagian, x.kalah, x.faktor.map(([k, n]) => `${QCD_FAKTOR_LABEL[k] || k} (${n})`).join(', '), x.kompetitor.map(([k, n]) => `${k} (${n})`).join(', '), x.harga.mahal, Math.round(x.supplyLostKg)]),
      colWidths: [18, 6, 9, 14, 12, 12, 8, 9, 7, 34, 30, 14, 18].map((wch) => ({ wch })),
      numFormats: { 3: '#,##0', 4: '#,##0', 12: '#,##0' },
    });
    appendSheet(XLSX, wb, {
      sheetName: 'Permintaan Hilang',
      header: ['GRADE', 'UKURAN', 'PENYEBAB', 'KG', 'ITEM', 'CUSTOMER'],
      rows: unmet.map((u) => [u.grade, u.bucket, QCD_FAKTOR_LABEL[u.faktor] || u.faktor, Math.round(u.kg), u.items, u.customers.join(', ')]),
      colWidths: [18, 14, 18, 10, 6, 60].map((wch) => ({ wch })),
      numFormats: { 3: '#,##0' },
    });
    XLSX.writeFile(wb, `Insight_Produk_${range.from || 'semua'}_${range.to || ''}.xlsx`);
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr('Insight Produk')}
      xwide
      footer={
        <>
          {canNow('marketing', 'x') && <button type="button" className="btn btn-outline" onClick={() => void exportExcel()}>{tr('Export Excel')}</button>}
          <button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>
        </>
      }
    >
      <div className="toolbar-row lr-filters">
        <PeriodRange value={range} onChange={setRange} thisMonth={thisMonth} max={thisMonth} allowAll label="Deal ditutup" />
        {regOpts.length > 1 && (
          <select value={reg} onChange={(e) => { setReg(e.target.value); setCabang(''); }} aria-label={tr('Regional')}>
            <option value="">{tr('Semua regional')}</option>
            {regOpts.map((r) => <option key={r} value={String(r)}>Regional {r}</option>)}
          </select>
        )}
        {cabOpts.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua Cabang')}</option>
            {cabOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      <div className="kpi-grid">
        <Kpi label={tr('Ditawarkan (deal ditutup)')} value={formatTon(tot.off)} foot={`${items.length} ${tr('item')} · ${grades.length} ${tr('grade')}`} />
        <Kpi label={tr('Jadi PO')} value={formatTon(tot.po)} foot={`${pct(tot.off ? tot.po / tot.off : null)} ${tr('dari tonase penawaran')}`} tone="won" />
        <Kpi label={tr('Hilang')} value={formatTon(tot.lostKg)} foot={`${tot.lost} ${tr('item kalah / sebagian')}`} tone="lost" />
        <Kpi label={tr('Hilang karena stok / waktu kirim')} value={formatTon(tot.supply)} foot={tr('peluang dengan stok yang tepat')} tone={tot.supply ? 'aktif' : ''} />
      </div>

      {notes.length > 0 && <Insights list={notes} title={tr('Temuan')} />}

      <Section title={tr('Per grade')} note={tr('Klik grade untuk melihat item yang kalah: customer, alasan, kompetitor dan posisi harga.')}>
        <Table
          head={[tr('Grade'), tr('Ditawarkan'), 'PO', tr('Konversi'), tr('Menang / sebagian / kalah'), tr('Alasan kalah utama'), tr('Kompetitor pemenang'), tr('Kalah: harga lebih mahal')]}
          right={[1, 2, 3, 7]}
          onRow={(i) => setSel(grades[i].grade === sel ? '' : grades[i].grade)}
          empty={tr('Belum ada deal yang ditutup pada periode ini')}
          rows={grades.slice(0, 40).map((x) => [
            <b key="g" className={x.grade === sel ? 'pi-sel' : ''}>{x.grade}</b>,
            formatTon(x.offKg),
            formatTon(x.poKg),
            <span key="w" className={x.winRate != null && x.winRate < 0.35 ? 'dk-bad' : ''}>{pct(x.winRate)}</span>,
            `${x.menang} / ${x.sebagian} / ${x.kalah}`,
            x.faktor.length ? x.faktor.map(([k, n]) => `${tr(QCD_FAKTOR_LABEL[k] || k)} (${n})`).join(', ') : '–',
            x.kompetitor.length ? x.kompetitor.map(([k, n]) => `${k} (${n})`).join(', ') : '–',
            x.harga.mahal || '–',
          ])}
        />
      </Section>

      {g && (
        <Section title={`${tr('Item kalah')} — ${g.grade}`} right={<button type="button" className="dk-link" onClick={() => setSel('')}>{tr('Tutup')}</button>}>
          <Table
            head={[tr('Customer'), tr('Cabang'), tr('Material'), tr('Hasil'), tr('Kg hilang'), tr('Alasan'), tr('Kompetitor'), tr('Harga kita')]}
            right={[4]}
            rows={detail.slice(0, 100).map((i) => [
              i.customer,
              i.cabang || '-',
              i.label,
              i.outcome === 'kalah' ? <span key="o" className="badge rust">{tr('Kalah')}</span> : <span key="o" className="badge amber">{tr('Sebagian')}</span>,
              formatTon(i.lostKg),
              i.faktor ? tr(QCD_FAKTOR_LABEL[i.faktor] || i.faktor) : <span key="f" className="field-note" style={{ margin: 0 }}>{tr('belum diisi')}</span>,
              i.kompetitor || '–',
              i.costLevel === 'kalah' ? tr('Lebih mahal') : i.costLevel === 'setara' ? tr('Setara') : i.costLevel === 'unggul' ? tr('Lebih murah') : '–',
            ])}
          />
        </Section>
      )}

      <Section title={tr('Permintaan hilang karena stok / waktu kirim')} note={tr('Grade & ukuran yang diminta customer tapi lepas karena barang tidak tersedia atau waktu kirim kalah — masukan untuk rencana stok / indent.')}>
        <Table
          head={[tr('Grade'), tr('Ukuran'), tr('Penyebab'), tr('Tonase'), tr('Item'), tr('Customer')]}
          right={[3, 4]}
          empty={tr('Tidak ada item kalah karena stok / waktu kirim pada periode ini.')}
          rows={unmet.slice(0, 30).map((u) => [<b key="g">{u.grade}</b>, u.bucket || '-', tr(QCD_FAKTOR_LABEL[u.faktor] || u.faktor), formatTon(u.kg), u.items, u.customers.slice(0, 4).join(', ') + (u.customers.length > 4 ? ` +${u.customers.length - 4}` : '')])}
        />
      </Section>
      {tot.noReason > 0 && <div className="field-note">{tot.noReason} {tr('item kalah belum diisi faktor QCD — makin lengkap QCD per item dari Sales, makin akurat insight ini.')}</div>}
    </Modal>
  );
}
