'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload } from '../icons';
import { CABANG_LIST, STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah, todayStr } from '@/lib/format';
import { buildAgingList, buildCustomerIntel, buildFollowUpRows, buildForecast, buildForecastByReg, buildForecastNasional } from '@/lib/reports';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

const GRAPHITE = '1A2A3D';
const STEEL = '2E5C7E';
const AMBER = 'D9822B';
const GREEN = '2F8F5B';
const RUST = 'B94A3D';
const CHART_COLORS = [STEEL, AMBER, GREEN, RUST, '6B7684'];

const SOURCE_LABEL: Record<string, string> = { terjadwal: 'Terjadwal', aging: 'Pipeline Mangkrak', reaktivasi: 'Customer Dingin' };

/** "2026-09" -> "September 2026" — a raw YYYY-MM reads fine in a form input, not on a title slide. */
function formatPeriodeLong(periode: string): string {
  const d = new Date(`${periode}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return periode;
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function currentPeriode(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * GM-only. Synthesizes signals already computed elsewhere in the app
 * (Forecast's target/rencana/realisasi, Customer Intelligence's health
 * tiers, Aging pipeline, Follow-up backlog) into one executive view, plus a
 * "Buat PPT" button that turns the same numbers into a downloadable deck —
 * generated client-side with pptxgenjs (already the pattern this app uses
 * for Excel exports via the `xlsx` package: dynamic import, build in the
 * browser, trigger a download, no server round-trip).
 *
 * Deliberately reuses buildForecast/buildCustomerIntel/buildAgingList/
 * buildFollowUpRows rather than recomputing any of this — those are the
 * exact functions Forecast, Marketing's Reaktivasi tab, and the Follow-up
 * dashboard already render from, so this can't silently drift from what
 * those screens show.
 */
export function GmAnalysisModal() {
  const show = useUiStore((s) => s.modal === 'gmAnalysis');
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const toast = useDataStore((s) => s.toast);

  const [periode, setPeriode] = useState(currentPeriode());
  const [busy, setBusy] = useState(false);

  // Defense in depth: the TopBar button is already hidden for non-GM (see
  // TopBar.tsx), but a modal key is just client state, not a real access
  // boundary — a stale UI after a role change, or the key being opened
  // directly, must not render GM-only figures for anyone else.
  const allowed = currentUser?.role === 'gm';

  const rows = useMemo(() => buildForecast(prospects, budgetTargets, periode, CABANG_LIST, salesPlans), [prospects, budgetTargets, periode, salesPlans]);
  const regRows = useMemo(() => buildForecastByReg(rows), [rows]);
  const nasional = useMemo(() => buildForecastNasional(rows), [rows]);
  const intel = useMemo(() => buildCustomerIntel(prospects), [prospects]);
  const aging = useMemo(() => buildAgingList(prospects), [prospects]);
  const followUps = useMemo(() => buildFollowUpRows(prospects), [prospects]);
  const urgentFollowUps = useMemo(() => followUps.filter((r) => r.tier === 'terlambat'), [followUps]);

  const healthCounts = useMemo(() => {
    const c: Record<string, number> = { Aktif: 0, Menghangat: 0, 'Dingin (Follow-up)': 0, 'Belum Pernah Order': 0 };
    intel.forEach((x) => {
      c[x.health] = (c[x.health] || 0) + 1;
    });
    return c;
  }, [intel]);

  const funnelCounts = useMemo(
    () =>
      [1, 2, 3, 4].map((stage) => {
        const inStage = prospects.filter((p) => p.status === stage && classify(p) === 'Aktif');
        return { stage, label: STATUS_META[stage]?.label ?? String(stage), count: inStage.length, value: inStage.reduce((s, p) => s + p.value, 0) };
      }),
    [prospects],
  );

  const topDingin = useMemo(() => intel.filter((c) => c.health.startsWith('Dingin')).sort((a, b) => b.wonValue - a.wonValue).slice(0, 5), [intel]);
  const topAging = useMemo(() => aging.slice(0, 5), [aging]);

  const insights = useMemo(() => {
    const out: string[] = [];
    const weakRegions = regRows.filter((r) => r.totals.target > 0 && r.totals.achievement < 50);
    if (nasional.target > 0) {
      out.push(
        `Realisasi nasional ${nasional.achievement}% dari target (${formatRupiah(nasional.won)} dari ${formatRupiah(nasional.target)}); Rencana yang diisi Sales baru mencakup ${nasional.rencanaVsTarget}% dari target.`,
      );
    }
    if (weakRegions.length > 0) {
      out.push(`${weakRegions.length} dari ${regRows.length} regional pencapaiannya masih di bawah 50% target bulan ini.`);
    }
    if (aging.length > 0) {
      out.push(`${aging.length} deal aktif mangkrak tanpa progres, senilai ${formatRupiah(aging.reduce((s, a) => s + a.record.value, 0))} tertahan di pipeline.`);
    }
    const dinginCount = intel.filter((c) => c.health.startsWith('Dingin')).length;
    if (dinginCount > 0) {
      out.push(`${dinginCount} customer sudah lama tidak order, dengan riwayat pembelian ${formatRupiah(topDingin.reduce((s, c) => s + c.wonValue, 0))} pada 5 terbesar saja.`);
    }
    if (urgentFollowUps.length > 0) {
      out.push(`${urgentFollowUps.length} follow-up sudah lewat jadwal dan belum ditindaklanjuti.`);
    }
    return out;
  }, [nasional, regRows, aging, intel, topDingin, urgentFollowUps]);

  async function onGeneratePpt() {
    setBusy(true);
    try {
      // Dynamic import + CJS/ESM interop for this package's default export
      // isn't something this sandbox can verify against Next.js's actual
      // bundler output (see xlsx's own `const XLSX = await import('xlsx')`
      // elsewhere in this codebase, used directly with no `.default`) —
      // `any` here is a deliberate, narrow escape hatch for that one
      // uncertain line, not a general type-safety shortcut.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pptxgenModule: any = await import('pptxgenjs');
      const PptxGen = pptxgenModule.default ?? pptxgenModule;
      const pres = new PptxGen();
      pres.layout = 'LAYOUT_WIDE';
      const chartOpts = { chartColors: CHART_COLORS };

      // 1. Sampul
      const s1 = pres.addSlide();
      s1.background = { color: GRAPHITE };
      s1.addText('Laporan Analisa Eksekutif', { x: 0.8, y: 2.3, w: 11, h: 1, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Cambria' });
      s1.addText(`Periode ${formatPeriodeLong(periode)}`, { x: 0.8, y: 3.25, w: 8, h: 0.5, fontSize: 16, color: 'D7E3EC' });
      s1.addText('PT Tira Austenite — Steel Division', { x: 0.8, y: 4.0, w: 8, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF' });
      s1.addText(`Dibuat otomatis ${formatDateID(todayStr())} — hanya untuk kalangan GM`, { x: 0.8, y: 6.9, w: 10, h: 0.3, fontSize: 10, color: 'A9B8C6' });

      // 2. Ringkasan eksekutif
      const s2 = pres.addSlide();
      s2.addText('Ringkasan Eksekutif', { x: 0.5, y: 0.4, w: 11, h: 0.6, fontSize: 26, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      const kpiRows = [
        [{ text: 'Indikator', options: { bold: true, fill: { color: GRAPHITE }, color: 'FFFFFF' } }, { text: 'Nilai', options: { bold: true, fill: { color: GRAPHITE }, color: 'FFFFFF' } }],
        ['Target Nasional', formatRupiah(nasional.target)],
        ['Rencana Penjualan (Sales)', formatRupiah(nasional.rencana)],
        ['Realisasi (Won)', formatRupiah(nasional.won)],
        ['Achievement vs Target', `${nasional.achievement}%`],
        ['Rencana vs Target', `${nasional.rencanaVsTarget}%`],
        ['Realisasi vs Rencana', `${nasional.wonVsRencana}%`],
        ['Weighted Pipeline Aktif', formatRupiah(nasional.weighted)],
      ];
      s2.addTable(kpiRows, { x: 0.5, y: 1.3, w: 8, fontSize: 13, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 }, autoPage: false });

      // 3. Performa per Regional
      const s3 = pres.addSlide();
      s3.addText('Performa per Regional', { x: 0.5, y: 0.4, w: 11, h: 0.6, fontSize: 24, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      if (regRows.length > 0) {
        // Values scaled to millions for the chart axis — a raw "2500000000"
        // tick label is unreadable at a glance; the full-precision figure
        // is already on the Ringkasan Eksekutif table (slide 2) for anyone
        // who needs it exact.
        s3.addChart(
          pres.ChartType.bar,
          [
            { name: 'Target', labels: regRows.map((r) => (r.reg != null ? `Regional ${r.reg}` : 'Belum Diketahui')), values: regRows.map((r) => Math.round(r.totals.target / 1e6)) },
            { name: 'Rencana', labels: regRows.map((r) => (r.reg != null ? `Regional ${r.reg}` : 'Belum Diketahui')), values: regRows.map((r) => Math.round(r.totals.rencana / 1e6)) },
            { name: 'Realisasi', labels: regRows.map((r) => (r.reg != null ? `Regional ${r.reg}` : 'Belum Diketahui')), values: regRows.map((r) => Math.round(r.totals.won / 1e6)) },
          ],
          { x: 0.5, y: 1.2, w: 12, h: 5.6, barGrouping: 'clustered', showLegend: true, valAxisTitle: 'Rp Juta', showValAxisTitle: true, ...chartOpts },
        );
      }

      // 4. Performa per Cabang
      const s4 = pres.addSlide();
      s4.addText('Performa per Cabang', { x: 0.5, y: 0.4, w: 11, h: 0.6, fontSize: 24, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      const branchHeader = ['Cabang', 'Target', 'Rencana', 'Realisasi', 'Achievement'].map((t) => ({ text: t, options: { bold: true, fill: { color: GRAPHITE }, color: 'FFFFFF' } }));
      const branchBody = rows.map((r) => [r.cabang, formatRupiah(r.target), formatRupiah(r.rencana), formatRupiah(r.won), `${r.achievement}%`]);
      s4.addTable([branchHeader, ...branchBody], { x: 0.4, y: 1.15, w: 12.5, fontSize: 10.5, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 }, autoPage: true, autoPageCharWeight: -1 });

      // 5. Pipeline funnel + aging
      const s5 = pres.addSlide();
      s5.addText('Kesehatan Pipeline', { x: 0.5, y: 0.4, w: 11, h: 0.6, fontSize: 24, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      s5.addChart(pres.ChartType.bar, [{ name: 'Jumlah Deal', labels: funnelCounts.map((f) => f.label), values: funnelCounts.map((f) => f.count) }], {
        x: 0.5, y: 1.1, w: 6.2, h: 4.3, showLegend: false, ...chartOpts,
      });
      s5.addText(`${aging.length} Deal Mangkrak (Aging)`, { x: 7.0, y: 1.1, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: RUST });
      const agingLines = topAging.map((a) => `${a.record.customer} (${a.record.cabang || '-'}) — ${a.days} hari, ${formatRupiah(a.record.value)}`);
      s5.addText(agingLines.length > 0 ? agingLines.join('\n') : 'Tidak ada deal yang mangkrak.', { x: 7.0, y: 1.55, w: 5.8, h: 3.8, fontSize: 11, color: GRAPHITE, valign: 'top', lineSpacingMultiple: 1.3 });

      // 6. Kesehatan customer
      const s6 = pres.addSlide();
      s6.addText('Kesehatan Customer', { x: 0.5, y: 0.4, w: 11, h: 0.6, fontSize: 24, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      s6.addChart(pres.ChartType.pie, [{ name: 'Customer', labels: Object.keys(healthCounts), values: Object.values(healthCounts) }], {
        x: 0.5, y: 1.1, w: 5.8, h: 4.6, showLegend: true, showPercent: true, ...chartOpts,
      });
      s6.addText('5 Customer Dingin Bernilai Terbesar', { x: 6.7, y: 1.1, w: 6.1, h: 0.4, fontSize: 14, bold: true, color: RUST });
      const dinginHeader = ['Customer', 'Cabang', 'Tidak Order', 'Nilai Historis'].map((t) => ({ text: t, options: { bold: true, fill: { color: GRAPHITE }, color: 'FFFFFF', fontSize: 10 } }));
      const dinginBody = topDingin.map((c) => [c.name, c.cabang, `${c.daysSinceOrder ?? '-'} hari`, formatRupiah(c.wonValue)]);
      s6.addTable([dinginHeader, ...(dinginBody.length > 0 ? dinginBody : [['Tidak ada customer dingin bernilai besar', '', '', '']])], {
        x: 6.7, y: 1.55, w: 6.1, fontSize: 9.5, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 },
      });

      // 7. Follow-up
      const s7 = pres.addSlide();
      s7.addText('Follow-up Perlu Segera', { x: 0.5, y: 0.4, w: 11, h: 0.6, fontSize: 24, bold: true, color: GRAPHITE, fontFace: 'Cambria' });
      const fuHeader = ['Customer', 'Cabang', 'Sumber', 'Alasan'].map((t) => ({ text: t, options: { bold: true, fill: { color: GRAPHITE }, color: 'FFFFFF' } }));
      const fuBody = urgentFollowUps.slice(0, 15).map((r) => [r.customer, r.cabang, SOURCE_LABEL[r.source] ?? r.source, r.reason]);
      s7.addTable([fuHeader, ...(fuBody.length > 0 ? fuBody : [['Tidak ada follow-up yang terlambat', '', '', '']])], {
        x: 0.4, y: 1.15, w: 12.5, fontSize: 11, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 }, autoPage: true,
      });

      // 8. Catatan & rekomendasi
      const s8 = pres.addSlide();
      s8.background = { color: GRAPHITE };
      s8.addText('Catatan & Rekomendasi', { x: 0.8, y: 0.6, w: 11, h: 0.7, fontSize: 26, bold: true, color: 'FFFFFF', fontFace: 'Cambria' });
      const insightText = insights.length > 0 ? insights : ['Tidak ada catatan khusus periode ini.'];
      insightText.forEach((t, i) => {
        s8.addText(`•  ${t}`, { x: 0.8, y: 1.6 + i * 0.85, w: 11.5, h: 0.8, fontSize: 14, color: 'D7E3EC', valign: 'top' });
      });

      await pres.writeFile({ fileName: `Analisa-Eksekutif-${periode}.pptx` });
      toast('PPT analisa berhasil dibuat', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat PPT', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Analisa Eksekutif (GM)"
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onGeneratePpt}>
            <IconDownload /> {busy ? 'Membuat PPT…' : 'Buat PPT'}
          </button>
        </>
      }
    >
      <div className="import-summary" style={{ marginBottom: 14 }}>
        Menyatukan Forecast, Customer Intelligence, Aging Pipeline, dan Follow-up jadi satu ringkasan — plus tombol{' '}
        <b>Buat PPT</b> untuk mengunduh versi lengkapnya sebagai file presentasi. Halaman ini hanya terlihat untuk role GM.
      </div>

      <div style={{ marginBottom: 14 }}>
        <label>Periode</label>
        <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} style={{ maxWidth: 180 }} />
      </div>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div className="kpi">
          <div className="label">Target Nasional</div>
          <div className="value">{formatRupiah(nasional.target)}</div>
        </div>
        <div className="kpi">
          <div className="label">Rencana</div>
          <div className="value">{formatRupiah(nasional.rencana)}</div>
        </div>
        <div className="kpi won">
          <div className="label">Realisasi</div>
          <div className="value">{formatRupiah(nasional.won)}</div>
        </div>
        <div className="kpi rate">
          <div className="label">Achievement</div>
          <div className="value">{nasional.achievement}%</div>
        </div>
        <div className="kpi lost">
          <div className="label">Deal Mangkrak</div>
          <div className="value">{aging.length}</div>
        </div>
        <div className="kpi lost">
          <div className="label">Follow-up Terlambat</div>
          <div className="value">{urgentFollowUps.length}</div>
        </div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 12.5, margin: '4px 0 8px' }}>Catatan &amp; Rekomendasi</div>
      {insights.length === 0 ? (
        <div className="field-note">Tidak ada catatan khusus untuk periode ini.</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.7 }}>
          {insights.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
