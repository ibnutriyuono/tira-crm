'use client';

import { useMemo, useState } from 'react';
import type PptxGenJS from 'pptxgenjs';
import { Modal } from '../Modal';
import { IconDownload } from '../icons';
import { STATUS_META } from '@/lib/constants';
import { formatDateID, formatRupiah, todayStr } from '@/lib/format';
import { buildExecAnalysis, execScopeFor, localPeriode, type ExecAnalysis } from '@/lib/exec-analysis';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

const GRAPHITE = '1A2A3D';
const STEEL = '2E5C7E';
const AMBER = 'D9822B';
const GREEN = '2F8F5B';
const RUST = 'B94A3D';
const CHART_COLORS = [STEEL, AMBER, GREEN, RUST, '6B7684'];

/**
 * Header rows are styled cells, body rows are plain strings. pptxgenjs accepts
 * both at runtime, but its v4 typings declare a row as TableCell[] only.
 */
function tableRows(rows: (string | PptxGenJS.TableCell)[][]): PptxGenJS.TableCell[][] {
  return rows.map((row) => row.map((cell) => (typeof cell === 'string' ? { text: cell } : cell)));
}

/** Compact Rupiah for KPI tiles ("Rp 3,00 M", "Rp 820 jt") -- the full figure sits in the tile's tooltip. */
function rpShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
  if (abs >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  return formatRupiah(n);
}

const achColor = (a: number) => (a >= 100 ? 'green' : a >= 90 ? 'amber' : a > 0 ? 'rust' : 'slate');

/**
 * Analisa Eksekutif -- open to GM, RM, BM, Sales (and admin), each scoped to
 * what they are responsible for (see execScopeFor): Nasional / Regional /
 * Cabang / own SE. All figures come from buildExecAnalysis so the screen and
 * the PPT can never disagree.
 */
export function GmAnalysisModal() {
  const show = useUiStore((s) => s.modal === 'gmAnalysis');
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const toast = useDataStore((s) => s.toast);

  // Period = month range "Dari ... s/d ..."; one month when both are equal.
  const [periode, setPeriode] = useState(localPeriode());
  const [periodeTo, setPeriodeTo] = useState(localPeriode());
  const thisMonth = localPeriode();
  const setRange = (from: string, to: string) => {
    if (!from || !to) return;
    // Keep "dari" <= "s/d" whichever end was moved.
    if (from > to) [from, to] = [to, from];
    setPeriode(from);
    setPeriodeTo(to);
  };
  const quick = [
    { label: 'Bulan ini', from: thisMonth, to: thisMonth },
    { label: 'YTD', from: `${thisMonth.slice(0, 4)}-01`, to: thisMonth },
    { label: 'Kuartal ini', from: `${thisMonth.slice(0, 4)}-${String(Math.floor((Number(thisMonth.slice(5)) - 1) / 3) * 3 + 1).padStart(2, '0')}`, to: thisMonth },
    { label: 'Tahun lalu', from: `${Number(thisMonth.slice(0, 4)) - 1}-01`, to: `${Number(thisMonth.slice(0, 4)) - 1}-12` },
  ];
  const [busy, setBusy] = useState(false);

  // The modal key is only client state; the scope check here is what keeps a
  // role with no sales data (purchasing) from rendering anything.
  const scope = useMemo(() => (currentUser ? execScopeFor(currentUser, prospects) : null), [currentUser, prospects]);
  const a = useMemo<ExecAnalysis | null>(
    () => (scope && show ? buildExecAnalysis(prospects, budgetTargets, salesPlans, scope, periode, formatRupiah, new Date(), periodeTo) : null),
    [scope, show, prospects, budgetTargets, salesPlans, periode, periodeTo],
  );

  async function onGeneratePpt() {
    if (!a) return;
    setBusy(true);
    try {
      const { default: PptxGen } = await import('pptxgenjs');
      const pres = new PptxGen();
      pres.layout = 'LAYOUT_WIDE';
      const chartOpts = { chartColors: CHART_COLORS };
      const H = (t: string) => ({ text: t, options: { bold: true, fill: { color: GRAPHITE }, color: 'FFFFFF' } });
      const title = (s: PptxGenJS.Slide, t: string) => s.addText(t, { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 24, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      const tbl = { border: { type: 'solid' as const, color: 'DDDDDD', pt: 0.5 } };

      // 1. Sampul
      const s1 = pres.addSlide();
      s1.background = { color: GRAPHITE };
      s1.addText('Laporan Analisa Eksekutif', { x: 0.8, y: 2.1, w: 11, h: 1, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Cambria' });
      s1.addText(`${a.scope.label} · Periode ${a.periodLabel}`, { x: 0.8, y: 3.1, w: 11, h: 0.5, fontSize: 18, color: 'D7E3EC' });
      s1.addText('PT. TIRA AUSTENITE, Tbk — Steel Division', { x: 0.8, y: 3.9, w: 8, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF' });
      s1.addText(`Dibuat otomatis ${formatDateID(todayStr())} oleh ${currentUser?.name || '-'} — internal & rahasia`, { x: 0.8, y: 6.9, w: 11, h: 0.3, fontSize: 10, color: 'A9B8C6' });

      // 2. Ringkasan
      const s2 = pres.addSlide();
      title(s2, 'Ringkasan Eksekutif');
      const kpi = [
        [H('Indikator'), H('Nilai')],
        [a.scope.kind === 'se' ? 'Target Cabang (acuan)' : 'Target', formatRupiah(a.target)],
        ['Rencana Penjualan', formatRupiah(a.rencana)],
        ['Realisasi (Won)', `${formatRupiah(a.won)} · ${a.wonCount} deal`],
        ['  PO/Kontrak · DO GIT · DO Omzet', `${formatRupiah(a.wonPo)} · ${formatRupiah(a.wonDoGit)} · ${formatRupiah(a.wonDoOmzet)}`],
        ['Achievement vs Target', `${a.achievement}%`],
        [`vs ${a.compareLabel.replace(/^./, (c) => c.toUpperCase())}`, a.momPct == null ? '-' : `${a.momPct >= 0 ? '+' : ''}${a.momPct}% (${formatRupiah(a.prevWon)})`],
        ['Sisa Gap', formatRupiah(a.gap) + (a.requiredPerDay ? ` · perlu ${formatRupiah(a.requiredPerDay)}/hari kerja` : '')],
        ['Weighted Pipeline · Coverage', `${formatRupiah(a.weighted)} · ${a.coverage == null ? '-' : `${Math.round(a.coverage * 100)}%`}`],
        ['Win Rate', a.winRate == null ? '-' : `${a.winRate}% (${a.wonCount} menang / ${a.lostCount} kalah)`],
        ['Rata-rata Nilai Deal', formatRupiah(a.avgDeal)],
      ];
      s2.addTable(tableRows(kpi), { x: 0.5, y: 1.2, w: 12, fontSize: 12.5, ...tbl, autoPage: false });

      // 3. Per regional / cabang
      if (a.scope.kind === 'nasional' && a.regRows.length > 0) {
        const s3 = pres.addSlide();
        title(s3, 'Performa per Regional (Rp juta)');
        const labels = a.regRows.map((r) => (r.reg != null ? `Regional ${r.reg}` : 'Belum Diketahui'));
        s3.addChart(
          pres.ChartType.bar,
          [
            { name: 'Target', labels, values: a.regRows.map((r) => Math.round(r.totals.target / 1e6)) },
            { name: 'Rencana', labels, values: a.regRows.map((r) => Math.round(r.totals.rencana / 1e6)) },
            { name: 'Realisasi', labels, values: a.regRows.map((r) => Math.round(r.totals.won / 1e6)) },
          ],
          { x: 0.5, y: 1.2, w: 12, h: 5.6, barGrouping: 'clustered', showLegend: true, valAxisTitle: 'Rp Juta', showValAxisTitle: true, ...chartOpts },
        );
      }
      if (a.scope.kind !== 'se' && a.rows.length > 0) {
        const s4 = pres.addSlide();
        title(s4, 'Performa per Cabang');
        const body = a.rows.filter((r) => r.target > 0 || r.won > 0 || r.openCount > 0 || r.rencana > 0).map((r) => [r.cabang, formatRupiah(r.target), formatRupiah(r.rencana), formatRupiah(r.won), `${r.achievement}%`, formatRupiah(r.weighted), String(r.agingCount)]);
        s4.addTable(tableRows([['Cabang', 'Target', 'Rencana', 'Realisasi', 'Ach.', 'Weighted Pipeline', 'Mangkrak'].map(H), ...body]), { x: 0.4, y: 1.15, w: 12.5, fontSize: 10.5, ...tbl, autoPage: true, autoPageCharWeight: -1 });
      }

      // 4. SE & customer
      const s5 = pres.addSlide();
      title(s5, a.scope.kind === 'se' ? 'Customer Terbesar Periode Ini' : 'Peringkat SE & Customer Terbesar');
      if (a.scope.kind !== 'se') {
        const seBody = a.seRows.slice(0, 12).map((r) => [r.se, r.cabang, formatRupiah(r.won), String(r.wonCount), formatRupiah(r.weighted)]);
        s5.addTable(tableRows([['SE', 'Cabang', 'Realisasi', 'Deal', 'Weighted'].map(H), ...(seBody.length ? seBody : [['Belum ada data', '', '', '', '']])]), { x: 0.4, y: 1.15, w: 6.3, fontSize: 9.5, ...tbl });
      }
      const cBody = a.topCustomers.map((c) => [c.name, c.cabang, formatRupiah(c.value), String(c.count)]);
      s5.addTable(tableRows([['Customer', 'Cabang', 'Realisasi', 'Deal'].map(H), ...(cBody.length ? cBody : [['Belum ada realisasi', '', '', '']])]), {
        x: a.scope.kind === 'se' ? 0.4 : 6.9, y: 1.15, w: a.scope.kind === 'se' ? 12.5 : 6.0, fontSize: 9.5, ...tbl,
      });

      // 5. Pipeline
      const s6 = pres.addSlide();
      title(s6, 'Kesehatan Pipeline');
      s6.addChart(pres.ChartType.bar, [{ name: 'Nilai (Rp juta)', labels: a.funnel.map((f) => STATUS_META[f.stage]?.label ?? String(f.stage)), values: a.funnel.map((f) => Math.round(f.value / 1e6)) }], {
        x: 0.5, y: 1.1, w: 6.2, h: 4.3, showLegend: false, valAxisTitle: 'Rp Juta', showValAxisTitle: true, ...chartOpts,
      });
      s6.addText(`${a.aging.length} deal mangkrak · ${formatRupiah(a.agingValue)}`, { x: 7.0, y: 1.1, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: RUST });
      const agingLines = a.aging.slice(0, 8).map((x) => `${x.record.customer} (${x.record.cabang || '-'}) — ${x.days} hari, ${formatRupiah(x.record.value)}`);
      s6.addText(agingLines.length ? agingLines.join('\n') : 'Tidak ada deal yang mangkrak.', { x: 7.0, y: 1.55, w: 5.8, h: 2.6, fontSize: 10.5, color: GRAPHITE, valign: 'top' });
      s6.addText(`${a.gitOld.length} DO belum terfaktur >30 hari`, { x: 7.0, y: 4.3, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: AMBER });
      s6.addText(a.gitOld.slice(0, 5).map((g) => `${g.customer} (${g.cabang}) — ${g.days} hari, ${formatRupiah(g.value)}`).join('\n') || '-', { x: 7.0, y: 4.75, w: 5.8, h: 2, fontSize: 10.5, color: GRAPHITE, valign: 'top' });

      // 6. Customer
      const s7 = pres.addSlide();
      title(s7, 'Kesehatan Customer');
      s7.addChart(pres.ChartType.pie, [{ name: 'Customer', labels: Object.keys(a.health), values: Object.values(a.health) }], { x: 0.5, y: 1.1, w: 5.8, h: 4.6, showLegend: true, showPercent: true, ...chartOpts });
      const dBody = a.topDingin.map((c) => [c.name, c.cabang, `${c.daysSinceOrder ?? '-'} hari`, formatRupiah(c.wonValue)]);
      s7.addText('Customer Dingin Bernilai Terbesar', { x: 6.7, y: 1.1, w: 6.1, h: 0.4, fontSize: 14, bold: true, color: RUST });
      s7.addTable(tableRows([['Customer', 'Cabang', 'Tidak Order', 'Nilai Historis'].map(H), ...(dBody.length ? dBody : [['Tidak ada', '', '', '']])]), { x: 6.7, y: 1.55, w: 6.1, fontSize: 9.5, ...tbl });

      // 7. Kualitas data
      const s8 = pres.addSlide();
      title(s8, 'Kualitas Data');
      const qBody = a.dataIssues.map((d) => [d.label, String(d.count), d.hint]);
      s8.addTable(tableRows([['Masalah', 'Jumlah', 'Dampak'].map(H), ...(qBody.length ? qBody : [['Tidak ada masalah data terdeteksi', '', '']])]), { x: 0.4, y: 1.15, w: 12.5, fontSize: 11, ...tbl });

      // 8. Catatan
      const s9 = pres.addSlide();
      s9.background = { color: GRAPHITE };
      s9.addText('Catatan & Rekomendasi', { x: 0.8, y: 0.5, w: 11, h: 0.7, fontSize: 26, bold: true, color: 'FFFFFF', fontFace: 'Cambria' });
      s9.addText((a.insights.length ? a.insights : ['Tidak ada catatan khusus periode ini.']).map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), {
        x: 0.8, y: 1.4, w: 11.8, h: 5.6, fontSize: 13, color: 'D7E3EC', valign: 'top', paraSpaceAfter: 6,
      });

      await pres.writeFile({ fileName: `Analisa-Eksekutif-${a.scope.label.replace(/[^\w-]+/g, '_')}-${a.periode}${a.periodeTo !== a.periode ? `_sd_${a.periodeTo}` : ''}.pptx` });
      toast('PPT analisa berhasil dibuat', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat PPT', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!scope) return null;

  const cabangRows = a ? a.rows.filter((r) => r.target > 0 || r.won > 0 || r.openCount > 0 || r.rencana > 0) : [];
  const hiddenCabang = a ? a.rows.length - cabangRows.length : 0;
  const regionRows = a ? a.regRows.filter((r) => r.totals.target > 0 || r.totals.won > 0 || r.totals.weighted > 0 || r.totals.rencana > 0) : [];
  const pctBadge = (v: number) => <span className={`badge ${achColor(v)}`}>{v}%</span>;

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={`Analisa Eksekutif — ${scope.label}`}
      xwide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !a} onClick={onGeneratePpt}>
            <IconDownload /> {busy ? 'Membuat PPT…' : 'Buat PPT'}
          </button>
        </>
      }
    >
      {a && (
        <>
          <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12 }}>
            <label style={{ margin: 0 }}>Periode</label>
            <input type="month" value={periode} onChange={(e) => setRange(e.target.value, periodeTo)} style={{ maxWidth: 170 }} title="Dari bulan" />
            <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>s/d</span>
            <input type="month" value={periodeTo} onChange={(e) => setRange(periode, e.target.value)} style={{ maxWidth: 170 }} title="Sampai bulan" />
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className={`btn btn-sm ${periode === q.from && periodeTo === q.to ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setRange(q.from, q.to)}
              >
                {q.label}
              </button>
            ))}
            <span className="field-note" style={{ margin: 0 }}>
              <b>{a.periodLabel}</b>{a.monthCount > 1 ? ` (${a.monthCount} bulan)` : ''} · Cakupan: <b>{scope.label}</b>
              {scope.kind === 'se' && ' — target yang ditampilkan adalah target cabang sebagai acuan kontribusi Anda'}
            </span>
          </div>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">{scope.kind === 'se' ? 'Target Cabang' : 'Target'}</div>
              <div className="value" title={formatRupiah(a.target)}>{rpShort(a.target)}</div>
              <div className="foot">Rencana {formatRupiah(a.rencana)} ({a.rencanaVsTarget}%)</div>
            </div>
            <div className="kpi won">
              <div className="label">Realisasi</div>
              <div className="value" title={formatRupiah(a.won)}>{rpShort(a.won)}</div>
              <div className="foot">
                {a.wonCount} deal · {a.momPct == null ? `${a.compareLabel} -` : `${a.momPct >= 0 ? '▲' : '▼'} ${Math.abs(a.momPct)}% vs ${a.compareLabel}`}
              </div>
            </div>
            <div className="kpi">
              <div className="label">Achievement</div>
              <div className="value">{a.achievement}%</div>
              <div className="foot">Realisasi vs rencana {a.wonVsRencana}%</div>
            </div>
            <div className="kpi lost">
              <div className="label">Sisa Gap</div>
              <div className="value" title={formatRupiah(a.gap)}>{rpShort(a.gap)}</div>
              <div className="foot">{a.requiredPerDay ? `Perlu ${formatRupiah(a.requiredPerDay)}/hari kerja (${a.daysLeft} hari)` : a.daysLeft == null ? 'Bukan periode berjalan' : 'Target tercapai'}</div>
            </div>
            <div className="kpi aktif">
              <div className="label">Weighted Pipeline</div>
              <div className="value" title={formatRupiah(a.weighted)}>{rpShort(a.weighted)}</div>
              <div className="foot">Coverage gap {a.coverage == null ? '-' : `${Math.round(a.coverage * 100)}%`}</div>
            </div>
            <div className="kpi">
              <div className="label">Win Rate</div>
              <div className="value">{a.winRate == null ? '-' : `${a.winRate}%`}</div>
              <div className="foot">
                {a.lostCount} kalah · {formatRupiah(a.lostValue)}
              </div>
            </div>
          </div>

          <div className="import-summary" style={{ marginTop: 0, marginBottom: 14 }}>
            <b>Komposisi realisasi:</b> PO/Kontrak {formatRupiah(a.wonPo)} · DO GIT (belum faktur) {formatRupiah(a.wonDoGit)} · DO Omzet (terfaktur) {formatRupiah(a.wonDoOmzet)} · rata-rata per deal {formatRupiah(a.avgDeal)}
          </div>

          <Section title="Catatan & Rekomendasi">
            {a.insights.length === 0 ? (
              <div className="field-note">Tidak ada catatan khusus untuk periode ini.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
                {a.insights.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </Section>

          {scope.kind === 'nasional' && regionRows.length > 0 && (
            <Section title="Per Regional">
              <Table
                head={['Regional', 'Target', 'Rencana', 'Realisasi', 'Ach.', 'Weighted']}
                rows={regionRows.map((r) => [r.reg != null ? `Regional ${r.reg}` : 'Belum diketahui', formatRupiah(r.totals.target), formatRupiah(r.totals.rencana), formatRupiah(r.totals.won), pctBadge(r.totals.achievement), formatRupiah(r.totals.weighted)])}
              />
            </Section>
          )}

          {scope.kind !== 'se' && (
            <Section title="Per Cabang">
              <Table
                head={['Cabang', 'Target', 'Rencana', 'Realisasi', 'Ach.', 'Weighted', 'Deal aktif', 'Mangkrak']}
                rows={cabangRows.map((r) => [r.cabang, formatRupiah(r.target), formatRupiah(r.rencana), formatRupiah(r.won), pctBadge(r.achievement), formatRupiah(r.weighted), r.openCount, r.agingCount])}
              />
              {hiddenCabang > 0 && <div className="field-note">{hiddenCabang} cabang tanpa target, rencana, maupun aktivitas pada periode ini tidak ditampilkan.</div>}
            </Section>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
            {scope.kind !== 'se' && (
              <Section title="Peringkat SE (realisasi periode)">
                <Table head={['SE', 'Cabang', 'Realisasi', 'Deal', 'Weighted']} rows={a.seRows.slice(0, 15).map((r) => [r.se, r.cabang, formatRupiah(r.won), r.wonCount, formatRupiah(r.weighted)])} />
              </Section>
            )}
            <Section title="Customer terbesar (realisasi periode)">
              <Table head={['Customer', 'Cabang', 'Realisasi', 'Deal']} rows={a.topCustomers.map((c) => [c.name, c.cabang, formatRupiah(c.value), c.count])} />
            </Section>
            <Section title="Pipeline aktif per tahap">
              <Table head={['Tahap', 'Deal', 'Nilai']} rows={a.funnel.map((f) => [STATUS_META[f.stage]?.label ?? f.stage, f.count, formatRupiah(f.value)])} />
            </Section>
            <Section title={`Kalah periode ini — kompetitor (${a.lostCount} deal)`}>
              <Table head={['Kompetitor', 'Kali menang atas kita']} rows={a.topCompetitors.map((c) => [c.name, c.count])} empty="Belum ada data kompetitor pada deal kalah" />
            </Section>
            <Section title={`Deal mangkrak (${a.aging.length})`}>
              <Table head={['Customer', 'Cabang', 'Tahap', 'Hari', 'Nilai']} rows={a.aging.slice(0, 10).map((x) => [x.record.customer, x.record.cabang || '-', STATUS_META[Number(x.record.status)]?.label ?? '-', x.days, formatRupiah(x.record.value)])} />
            </Section>
            <Section title={`DO belum terfaktur > 30 hari (${a.gitOld.length})`}>
              <Table head={['Customer', 'Cabang', 'Hari', 'Nilai']} rows={a.gitOld.slice(0, 10).map((g) => [g.customer, g.cabang, g.days, formatRupiah(g.value)])} />
            </Section>
            <Section title="Customer dingin bernilai terbesar">
              <Table head={['Customer', 'Cabang', 'Tidak order', 'Nilai historis']} rows={a.topDingin.map((c) => [c.name, c.cabang, `${c.daysSinceOrder ?? '-'} hari`, formatRupiah(c.wonValue)])} />
            </Section>
          </div>

          <Section title="Kualitas Data — perlu dirapikan agar angka akurat">
            {a.dataIssues.length === 0 ? (
              <div className="field-note">Tidak ada masalah data terdeteksi. 👍</div>
            ) : (
              <Table
                head={['Masalah', 'Jumlah', 'Dampak', 'Contoh']}
                rows={a.dataIssues.map((d) => [<b key="l">{d.label}</b>, <span key="c" className="badge amber">{d.count}</span>, d.hint, <span key="e" style={{ fontSize: 12 }}>{d.examples.join('; ')}</span>])}
              />
            )}
          </Section>
        </>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 6px' }}>{title}</div>
      {children}
    </div>
  );
}

function Table({ head, rows, empty = 'Tidak ada data' }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <div className="field-note">{empty}</div>;
  return (
    <div className="table-wrap" style={{ borderTop: 'none' }}>
      <table className="simple-table" style={{ minWidth: 0 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
