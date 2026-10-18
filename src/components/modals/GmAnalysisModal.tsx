'use client';

import { useMemo, useState } from 'react';
import type PptxGenJS from 'pptxgenjs';
import { Modal } from '../Modal';
import { IconDownload } from '../icons';
import { STATUS_META } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { buildDeck } from '@/lib/exec-deck';
import type { PptImage } from '@/lib/exec-ppt';
import { BUILTIN_ROLE_LABEL } from '@/lib/permissions';
import type { ActivityTarget, SalesActivity, VisitTrip } from '@/lib/types';
import { formatRupiah } from '@/lib/format';
import { buildExecAnalysis, execScopeFor, inScope, localPeriode, type ExecAnalysis } from '@/lib/exec-analysis';
import { PipelineTab } from '../analisa/PipelineTab';
import { ProductTab } from '../analisa/ProductTab';
import { TargetTab } from '../analisa/TargetTab';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { canNow } from '@/hooks/useCan';



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
  const [tab, setTab] = useState<'sales' | 'target' | 'product' | 'pipeline'>('sales');

  // The modal key is only client state; the scope check here is what keeps a
  // role with no sales data (purchasing) from rendering anything.
  const scope = useMemo(() => (currentUser ? execScopeFor(currentUser, prospects) : null), [currentUser, prospects]);
  const a = useMemo<ExecAnalysis | null>(
    () => (scope && show ? buildExecAnalysis(prospects, budgetTargets, salesPlans, scope, periode, formatRupiah, new Date(), periodeTo) : null),
    [scope, show, prospects, budgetTargets, salesPlans, periode, periodeTo],
  );

  const scopedProspects = useMemo(() => (!scope ? [] : scope.kind === 'se' ? prospects : prospects.filter(inScope(scope))), [scope, prospects]);

  // Data tambahan yang tidak disimpan di store; gagal dimuat = bagiannya dilewati.
  async function loadExtras() {
    const get = async <T,>(url: string, key: string): Promise<T | null> => {
      try {
        return ((await api.get<Record<string, T>>(url)) as Record<string, T>)[key] ?? null;
      } catch {
        return null;
      }
    };
    const [activities, activityTargets, trips] = await Promise.all([
      canNow('aktivitas', 'v') ? get<SalesActivity[]>('/api/sales-activities?all=1', 'activities') : Promise.resolve(null),
      canNow('kpi', 'v') && scope?.kind !== 'se' ? get<ActivityTarget[]>(`/api/activity-targets?periode=${periodeTo}`, 'targets') : Promise.resolve(null),
      canNow('trip', 'v') ? get<VisitTrip[]>('/api/visit-trips', 'trips') : Promise.resolve(null),
    ]);
    return { activities, activityTargets, trips };
  }

  async function loadLogoImage(): Promise<PptImage | null> {
    try {
      const blob = await (await fetch('/logo.png')).blob();
      const bmp = await createImageBitmap(blob);
      const dim = { w: bmp.width, h: bmp.height };
      bmp.close();
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      return { data: dataUrl.replace(/^data:/, ''), ...dim };
    } catch {
      return null;
    }
  }

  async function onGeneratePpt() {
    if (!a || !currentUser) return;
    setBusy(true);
    try {
      const st = useDataStore.getState();
      const extras = await loadExtras();
      const deck = buildDeck({
        a,
        prospects,
        budgetTargets,
        seTargets: st.seTargets,
        salesPlans,
        rfqs: st.rfqs,
        fupas: st.fupas,
        issues: st.issues,
        customerGroups: st.customerGroups,
        ...extras,
        can: (m) => canNow(m, 'v'),
        user: { name: currentUser.name, role: currentUser.role, se: currentUser.se },
        roleLabel: currentUser.customRoleLabel || BUILTIN_ROLE_LABEL[currentUser.role] || currentUser.role,
      });
      const [{ default: PptxGen }, { renderExecDeck }, logo] = await Promise.all([import('pptxgenjs'), import('@/lib/exec-ppt'), loadLogoImage()]);
      const pres = await renderExecDeck(PptxGen as unknown as new () => PptxGenJS, deck, logo);
      await pres.writeFile({ fileName: `Analisa-${a.scope.label.replace(/[^\w-]+/g, '_')}-${a.periode}${a.periodeTo !== a.periode ? `_sd_${a.periodeTo}` : ''}.pptx` });
      toast(`PPT analisa berhasil dibuat (${deck.slides.length + 3} slide)`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat PPT', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!scope) return null;
  const tabCabangs = scope.kind === 'se' ? null : scope.cabangs;

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
          {tab === 'sales' && canNow('analisa', 'x') && (
            <button type="button" className="btn btn-primary" disabled={busy || !a} onClick={onGeneratePpt}>
              <IconDownload /> {busy ? 'Membuat PPT…' : 'Buat PPT'}
            </button>
          )}
        </>
      }
    >
      <div className="ea-tabs" role="tablist">
        {(
          [
            ['sales', 'Sales'],
            ['target', 'Target'],
            ['product', 'Product'],
            ['pipeline', 'Pipeline'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {show && tab === 'target' && <TargetTab prospects={scopedProspects} scopeLabel={scope.label} cabangs={scope.cabangs} isSe={scope.kind === 'se'} />}
      {show && tab === 'product' && <ProductTab prospects={scopedProspects} scopeLabel={scope.label} cabangs={tabCabangs} thisMonth={thisMonth} />}
      {show && tab === 'pipeline' && <PipelineTab prospects={scopedProspects} scopeLabel={scope.label} cabangs={tabCabangs} thisMonth={thisMonth} />}
      {a && tab === 'sales' && (
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
