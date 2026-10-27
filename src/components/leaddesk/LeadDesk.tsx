'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { CABANG_LIST } from '@/lib/constants';
import { formatRupiah, normalizeLine, num } from '@/lib/format';
import { buildPoIndent } from '@/lib/po-indent';
import { rfqAsWorkflowDoc, workflowStage } from '@/lib/purchasing-workflow';
import { buildTargetAchievement } from '@/lib/target-achievement';
import { avlOf, expiringDocs } from '@/lib/vendor-profile';
import { hasHpp, hppIdr } from '@/lib/rfq-price';
import { issueCatLabel, isOpenIssue } from '@/lib/issues';
import { canApproveVendor, isOpsLead } from '@/lib/roles';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import type { Rfq, Vendor } from '@/lib/types';
import type { MarginApprovalView } from '@/lib/margin-server';

/**
 * Beranda pimpinan: GM Operation (Purchasing, IPC, gudang) dan VP (seluruh
 * divisi). Angka dihitung dari data yang sudah ada di store; keputusan
 * (AVL vendor, persetujuan margin) langsung dari daftar.
 */
export interface LeadDeskProps {
  /** Buka detail RFQ (ruang kerja Purchasing). */
  onOpenRfq?: (id: string) => void;
  /** Pindah tab Purchasing: indent | masalah | vendor | masuk. */
  onGoTab?: (tab: 'indent' | 'masalah' | 'vendor' | 'masuk') => void;
}

const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ageDays = (iso: string | null | undefined, today: string) => (iso ? Math.floor((Date.parse(today) - Date.parse(String(iso).slice(0, 10))) / DAY) : 0);
const fmt1 = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const ton = (kg: number) => (kg >= 1000 ? `${fmt1(kg / 1000)} ton` : `${Math.round(kg).toLocaleString('id-ID')} kg`);
const linesOf = (r: Rfq) => Array.from(new Set((r.items || []).flatMap((it) => normalizeLine(it.line).split(/\s*,\s*/)).filter(Boolean)));

interface Decision {
  id: string;
  kind: string;
  tone: 'vio' | 'org' | 'red' | 'blu';
  name: string;
  sub: string;
  acts: { label: string; run: () => void; cls?: string; needNote?: 'blokir' | 'tolak' }[];
}

export function LeadDesk({ onOpenRfq, onGoTab }: LeadDeskProps) {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const rfqs = useDataStore((s) => s.rfqs);
  const vendors = useDataStore((s) => s.vendors);
  const issues = useDataStore((s) => s.issues);
  const prospects = useDataStore((s) => s.prospects);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const rules = useDataStore((s) => s.opsRules);
  const upsertVendor = useDataStore((s) => s.upsertVendor);
  const toast = useDataStore((s) => s.toast);
  const role = me?.role;
  const isVp = role === 'vp' || role === 'admin';
  const [view, setView] = useState<'ops' | 'vp'>(role === 'gmops' ? 'ops' : 'vp');
  const ops = view === 'ops';
  const [today] = useState(() => ymd(new Date()));
  const [approvals, setApprovals] = useState<MarginApprovalView[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [note, setNote] = useState<{ id: string; kind: 'blokir' | 'tolak'; text: string } | null>(null);

  const loadApprovals = useCallback(() => {
    api
      .get<{ approvals: MarginApprovalView[]; canApprove: boolean }>('/api/margin-approvals')
      .then((r) => {
        setApprovals(r.approvals);
        setCanApprove(r.canApprove);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadApprovals();
    const s = getSocket();
    s.on('marginApproval:updated', loadApprovals);
    return () => {
      s.off('marginApproval:updated', loadApprovals);
    };
  }, [loadApprovals]);

  // ── Operation ────────────────────────────────────────────────────────
  const live = useMemo(() => rfqs.filter((r) => !r.cancelledAt && r.sentToPurchasingAt), [rfqs]);
  const unanswered = useMemo(() => live.filter((r) => [1, 2].includes(workflowStage(rfqAsWorkflowDoc(r)))), [live]);
  const overdueRfq = unanswered.filter((r) => ageDays(r.sentToPurchasingAt, today) > rules.rfqEskalasiHari);
  const answered90 = live.filter((r) => r.jawabanRfqAt && Date.parse(r.jawabanRfqAt) >= Date.parse(today) - 90 * DAY);
  const respDays = (r: Rfq) => Math.max(0, (Date.parse(String(r.jawabanRfqAt)) - Date.parse(String(r.sentToPurchasingAt))) / DAY);
  const avgResp = answered90.length ? answered90.reduce((s, r) => s + respDays(r), 0) / answered90.length : null;
  const inTarget = answered90.length ? Math.round((answered90.filter((r) => respDays(r) <= rules.rfqTargetHari).length / answered90.length) * 100) : null;

  const indent = buildPoIndent(prospects);
  const lateItems = indent.flatMap((g) =>
    g.items.filter((it) => it.eta && it.stat !== 'tiba' && it.eta < today).map((it) => ({ g, it, late: ageDays(it.eta, today), janji: !!g.janji && it.eta > g.janji })),
  );
  const indentKg = indent.reduce((s, g) => s + g.items.filter((it) => it.stat !== 'tiba').reduce((a, it) => a + num(it.kg), 0), 0);
  const avlWait = vendors.filter((v) => avlOf(v) === 'evaluasi');
  const docSoon = vendors.filter((v) => expiringDocs(v, today).length > 0);
  const purchIssues = issues.filter((i) => i.sumber === 'purchasing' && i.status === 'usulan');
  const purchOpen = issues.filter((i) => i.sumber === 'purchasing' && isOpenIssue(i));
  const nego = prospects.filter((p) => num(p.status) === 3);
  const negoKg = nego.reduce((s, p) => s + (Array.isArray(p.materials) ? p.materials : []).reduce((a, m) => a + num(m.qty) * num(m.beratPc), 0), 0);

  const lineRows = (() => {
    const m = new Map<string, { aktif: number; lewat: number; resp: number[]; telat: number }>();
    const row = (l: string) => {
      if (!m.has(l)) m.set(l, { aktif: 0, lewat: 0, resp: [], telat: 0 });
      return m.get(l)!;
    };
    unanswered.forEach((r) => linesOf(r).forEach((l) => {
      row(l).aktif++;
      if (ageDays(r.sentToPurchasingAt, today) > rules.rfqEskalasiHari) row(l).lewat++;
    }));
    answered90.forEach((r) => linesOf(r).forEach((l) => row(l).resp.push(respDays(r))));
    lateItems.forEach(({ it }) => String(it.line || '').split(/\s*,\s*/).filter(Boolean).forEach((l) => row(normalizeLine(l)).telat++));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  // ── VP ───────────────────────────────────────────────────────────────
  const ach = useMemo(
    () => buildTargetAchievement(prospects, budgetTargets, CABANG_LIST, { year: today.slice(0, 4), month: Number(today.slice(5, 7)), today }),
    [prospects, budgetTargets, today],
  );
  const regOf = useMemo(() => {
    const m = new Map<string, number>();
    prospects.forEach((p) => p.cabang && p.reg != null && m.set(p.cabang.trim().toUpperCase(), p.reg));
    return m;
  }, [prospects]);
  const regRows = useMemo(() => {
    const m = new Map<string, { target: number; real: number }>();
    ach.rows.forEach((r) => {
      const k = regOf.has(r.cabang) ? `Regional ${regOf.get(r.cabang)}` : 'Cabang tanpa regional';
      const x = m.get(k) || { target: 0, real: 0 };
      x.target += r.target;
      x.real += r.real;
      m.set(k, x);
    });
    return Array.from(m.entries()).filter(([, x]) => x.target || x.real).sort((a, b) => a[0].localeCompare(b[0]));
  }, [ach, regOf]);
  const pipeline = prospects.filter((p) => [1, 2, 3].includes(num(p.status))).reduce((s, p) => s + num(p.value), 0);
  const marginItems = live.flatMap((r) => (r.items || []).filter((it) => hasHpp(it as never) && num(it.hargaPurchasing) > 0));
  const avgMargin = (() => {
    const base = marginItems.reduce((s, it) => s + hppIdr(it as never), 0);
    const sell = marginItems.reduce((s, it) => s + num(it.hargaPurchasing), 0);
    return base > 0 ? ((sell - base) / base) * 100 : null;
  })();
  const escIssues = issues.filter((i) => isOpenIssue(i) && i.eskalasi >= 2);
  const marginWait = approvals.filter((a) => a.status === 'menunggu');

  // ── Aksi ─────────────────────────────────────────────────────────────
  async function setAvl(v: Vendor, status: 'aktif' | 'diblokir', alasan = '') {
    try {
      const r = await api.patch<{ vendor: Vendor }>(`/api/vendors/${v.id}`, { action: 'avl', status, alasan });
      upsertVendor(r.vendor);
      toast(status === 'aktif' ? `${v.nama}: ${tr('disetujui (Aktif)')}` : `${v.nama}: ${tr('diblokir')}`, 'success');
      setNote(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    }
  }
  async function decideMargin(a: MarginApprovalView, action: 'setuju' | 'tolak', catatan = '') {
    try {
      await api.patch(`/api/margin-approvals/${a.id}`, { action, catatan });
      toast(action === 'setuju' ? tr('Margin disetujui — Sales diberi tahu') : tr('Pengajuan margin ditolak'), 'success');
      setNote(null);
      loadApprovals();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    }
  }
  const openIssue = (id: string) => {
    useUiStore.setState({ issueFocus: { id } });
    if (onGoTab) onGoTab('masalah');
    else useUiStore.getState().openModal('pipelineIssues');
  };
  const openIndent = (prospectId: string) => {
    if (onGoTab) onGoTab('indent');
    else useUiStore.setState({ itemFlowCtx: { prospectId }, modal: 'itemFlow' });
  };
  const openRfq = (id: string) => {
    if (onOpenRfq) onOpenRfq(id);
    else useUiStore.getState().openModal('purchasing');
  };

  const decisions: Decision[] = [];
  if (ops) {
    const vendorBoss = canApproveVendor(role);
    avlWait.forEach((v) =>
      decisions.push({
        id: `v:${v.id}`,
        kind: /usul blokir/i.test(v.statusAlasan || '') ? tr('USUL BLOKIR') : /usul aktif/i.test(v.statusAlasan || '') ? tr('USUL AKTIF') : tr('VENDOR BARU / EVALUASI'),
        tone: /blokir/i.test(v.statusAlasan || '') ? 'red' : 'vio',
        name: v.nama,
        sub: [v.statusAlasan, v.statusOleh].filter(Boolean).join(' — ') || tr('Menunggu keputusan status vendor'),
        acts: vendorBoss
          ? [
              { label: tr('Setujui (Aktif)'), run: () => setAvl(v, 'aktif', 'Disetujui dari Beranda'), cls: 'btn-primary' },
              { label: tr('Blokir'), run: () => setNote({ id: `v:${v.id}`, kind: 'blokir', text: '' }), needNote: 'blokir' },
            ]
          : [],
      }),
    );
    purchIssues.forEach((i) =>
      decisions.push({
        id: `i:${i.id}`,
        kind: tr('MASALAH PURCHASING'),
        tone: 'org',
        name: `${i.noDoc || i.customer} · ${tr(issueCatLabel(i.kategori))}`,
        sub: `${i.diajukanNama || 'Purchasing'} · ${tr('urgensi')} ${i.urgensi} · ${i.customer} · ${ageDays(i.createdAt, today)} ${tr('hari')}`,
        acts: [{ label: tr('Proses & tunjuk PJ'), run: () => openIssue(i.id), cls: 'btn-primary' }],
      }),
    );
    overdueRfq.forEach((r) =>
      decisions.push({
        id: `r:${r.id}`,
        kind: `${tr('RFQ LEWAT')} ${rules.rfqEskalasiHari} ${tr('HARI')}`,
        tone: 'blu',
        name: `${r.noRfq || 'RFQ'} · ${(r.items || []).length} item`,
        sub: `${tr('Belum dijawab')} ${ageDays(r.sentToPurchasingAt, today)} ${tr('hari')} · ${r.cabang || '-'} · ${tr('Line')} ${linesOf(r).join(', ') || '-'}`,
        acts: [{ label: tr('Buka RFQ'), run: () => openRfq(r.id) }],
      }),
    );
    lateItems
      .filter((x) => x.late > rules.telatOpsHari)
      .forEach((x) =>
        decisions.push({
          id: `t:${x.g.prospectId}:${x.it.itemId}`,
          kind: `${tr('BARANG TELAT')} ${x.late} ${tr('HARI')}`,
          tone: 'red',
          name: `${x.it.label}`,
          sub: `${x.g.noPo || 'PO'} · ${x.g.customer} · ${x.g.cabang} · ${tr('target')} ${x.it.eta}${x.janji ? ` · ${tr('melewati janji ke customer')}` : ''}`,
          acts: [{ label: tr('Buka PO Indent'), run: () => openIndent(x.g.prospectId) }],
        }),
      );
  } else {
    marginWait.forEach((a) => {
      const low = (a.lines || []).filter((l) => l.below);
      decisions.push({
        id: `m:${a.id}`,
        kind: tr('MARGIN DI BAWAH BATAS'),
        tone: 'vio',
        name: `${a.customer}${a.nomor ? ` · ${a.nomor}` : ''}`,
        sub: `${a.requestedByName} · ${a.cabang || '-'} · ${low.length} ${tr('item di bawah')} ${a.minMargin}%${low.length ? ` (${low.map((l) => `${l.uraian.slice(0, 28)}: ${l.margin == null ? '-' : `${fmt1(l.margin)}%`}`).join('; ')})` : ''} · ${tr('Alasan')}: ${a.alasan || '-'}`,
        acts: canApprove
          ? [
              { label: tr('Setujui'), run: () => decideMargin(a, 'setuju'), cls: 'btn-primary' },
              { label: tr('Tolak'), run: () => setNote({ id: `m:${a.id}`, kind: 'tolak', text: '' }), needNote: 'tolak' },
            ]
          : [],
      });
    });
    escIssues.forEach((i) =>
      decisions.push({
        id: `e:${i.id}`,
        kind: i.sumber === 'purchasing' ? tr('ESKALASI OPERATION') : tr('ESKALASI SALES'),
        tone: i.sumber === 'purchasing' ? 'org' : 'red',
        name: `${i.customer} · ${tr(issueCatLabel(i.kategori))}`,
        sub: `${tr('Belum selesai')} ${ageDays(i.dilaporAt || i.createdAt, today)} ${tr('hari')} · ${i.cabang || '-'}`,
        acts: [{ label: tr('Buka diskusi'), run: () => openIssue(i.id) }],
      }),
    );
    lateItems
      .filter((x) => x.late > rules.telatVpHari)
      .forEach((x) =>
        decisions.push({
          id: `t:${x.g.prospectId}:${x.it.itemId}`,
          kind: `${tr('BARANG TELAT')} ${x.late} ${tr('HARI')}`,
          tone: 'red',
          name: x.it.label,
          sub: `${x.g.noPo || 'PO'} · ${x.g.customer} · ${x.g.cabang} · ${tr('target')} ${x.it.eta}`,
          acts: [{ label: tr('Lihat'), run: () => openIndent(x.g.prospectId) }],
        }),
      );
  }

  const kpis = ops
    ? [
        { lb: tr('RFQ BELUM DIJAWAB'), v: String(unanswered.length), sub: `${overdueRfq.length} ${tr('lewat')} ${rules.rfqEskalasiHari} ${tr('hari')}`, tone: 'blu', go: () => onGoTab?.('masuk') },
        { lb: tr('WAKTU JAWAB'), v: avgResp == null ? '–' : `${fmt1(avgResp)} ${tr('hari')}`, sub: `${tr('90 hari')} · ${tr('target')} ≤ ${rules.rfqTargetHari}${inTarget == null ? '' : ` · ${inTarget}% ${tr('tepat')}`}`, tone: avgResp != null && avgResp > rules.rfqTargetHari ? 'org' : 'grn' },
        { lb: tr('BARANG TELAT'), v: String(lateItems.length), sub: `${lateItems.filter((x) => x.janji).length} ${tr('melewati janji customer')}`, tone: 'red', go: () => onGoTab?.('indent') },
        { lb: tr('MENUNGGU AVL'), v: String(avlWait.length), sub: tr('vendor baru / usulan'), tone: 'vio', go: () => onGoTab?.('vendor') },
        { lb: tr('MASALAH PURCH.'), v: String(purchIssues.length), sub: `${purchOpen.length} ${tr('masih terbuka')}`, tone: 'org', go: () => onGoTab?.('masalah') },
        { lb: tr('DOKUMEN VENDOR'), v: String(docSoon.length), sub: tr('habis ≤ 30 hari'), tone: 'gry', go: () => onGoTab?.('vendor') },
      ]
    : [
        { lb: tr('OMZET BULAN INI'), v: formatRupiah(ach.real), sub: ach.target ? `${Math.round((ach.real / ach.target) * 100)}% ${tr('dari target')}` : tr('target belum diisi'), tone: ach.target && ach.real < ach.target * ach.pace ? 'org' : 'grn' },
        { lb: tr('OMZET YTD'), v: ach.ytdTarget ? `${Math.round((ach.ytdReal / ach.ytdTarget) * 100)}%` : '–', sub: `${formatRupiah(ach.ytdReal)}`, tone: 'grn' },
        { lb: tr('PIPELINE TERBUKA'), v: formatRupiah(pipeline), sub: ach.target ? `${tr('coverage')} ${fmt1(pipeline / Math.max(1, ach.target - ach.real))}×` : '', tone: 'blu' },
        { lb: tr('MARGIN RATA-RATA'), v: avgMargin == null ? '–' : `${fmt1(avgMargin)}%`, sub: tr('jawaban RFQ ber-HPP'), tone: avgMargin != null && avgMargin < rules.marginMin ? 'red' : 'grn' },
        { lb: tr('BARANG TELAT'), v: String(lateItems.length), sub: tr('Operation'), tone: 'red' },
        { lb: tr('MENUNGGU VP'), v: String(marginWait.length + escIssues.length), sub: `${marginWait.length} ${tr('margin')} · ${escIssues.length} ${tr('eskalasi')}`, tone: 'vio' },
      ];

  return (
    <div className="ld">
      <div className="ld-head">
        <div>
          <div className="muted">{me?.name} · {role === 'gmops' ? 'GM Operation' : role === 'vp' ? 'VP' : role === 'admin' ? 'Admin' : role}</div>
          <h2 className="ld-title">{ops ? tr('Beranda GM Operation') : tr('Beranda VP')}</h2>
        </div>
        <div className="ld-scope">
          {isVp && (
            <span className="qr-seg" role="group" aria-label={tr('Tampilan')}>
              <button type="button" className={!ops ? 'on' : ''} onClick={() => setView('vp')}>{tr('Divisi (VP)')}</button>
              <button type="button" className={ops ? 'on' : ''} onClick={() => setView('ops')}>{tr('Operation')}</button>
            </span>
          )}
          <span className="muted">{ops ? tr('Cakupan: nasional · Purchasing, IPC, gudang · pipeline Sales hanya baca') : tr('Cakupan: seluruh divisi · Sales & Operation')}</span>
        </div>
      </div>

      <div className="ld-kpis">
        {kpis.map((k) => (
          <button key={k.lb} type="button" className={`ld-kpi ${k.tone}`} onClick={'go' in k && k.go ? k.go : undefined} disabled={!('go' in k && k.go && onGoTab)}>
            <span className="lb">{k.lb}</span>
            <span className="n">{k.v}</span>
            <span className="sub">{k.sub}</span>
          </button>
        ))}
      </div>

      <div className="ld-grid">
        <section className="ld-card">
          <div className="ld-card-h">
            <b>{ops ? tr('Perlu keputusan Anda') : tr('Eskalasi & persetujuan')}</b>
            <span className="muted">{decisions.length} {tr('menunggu')}</span>
          </div>
          {decisions.length === 0 && <div className="ld-empty">{tr('Tidak ada yang menunggu. 👍')}</div>}
          {decisions.slice(0, 40).map((d) => (
            <div key={d.id} className="ld-dec">
              <div className="ld-dec-t">
                <span className={`ld-tag ${d.tone}`}>{d.kind}</span>
                <b>{d.name}</b>
                <span className="muted">{d.sub}</span>
                {note && note.id === d.id && (
                  <span className="ld-note">
                    <input type="text" autoFocus value={note.text} placeholder={note.kind === 'blokir' ? tr('Alasan blokir') : tr('Alasan penolakan')} onChange={(e) => setNote({ ...note, text: e.target.value })} />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={note.text.trim().length < 5}
                      onClick={() => {
                        if (note.kind === 'blokir') {
                          const v = vendors.find((x) => `v:${x.id}` === d.id);
                          if (v) setAvl(v, 'diblokir', note.text.trim());
                        } else {
                          const a = approvals.find((x) => `m:${x.id}` === d.id);
                          if (a) decideMargin(a, 'tolak', note.text.trim());
                        }
                      }}
                    >
                      OK
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setNote(null)}>×</button>
                  </span>
                )}
              </div>
              <div className="ld-acts">
                {d.acts.map((a) => (
                  <button key={a.label} type="button" className={`btn btn-sm ${a.cls || 'btn-outline'}`} onClick={a.run}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="ld-card">
          {ops ? (
            <>
              <div className="ld-card-h"><b>{tr('Kinerja Purchasing per Line')}</b><span className="muted">{tr('waktu jawab: 90 hari')}</span></div>
              <table className="simple-table ld-tbl">
                <thead><tr><th>{tr('Line')}</th><th className="r">{tr('Belum dijawab')}</th><th className="r">{tr('Waktu jawab')}</th><th className="r">&gt; {rules.rfqEskalasiHari} {tr('hr')}</th><th className="r">{tr('Telat')}</th></tr></thead>
                <tbody>
                  {lineRows.length === 0 && <tr><td colSpan={5} className="field-note">{tr('Belum ada RFQ.')}</td></tr>}
                  {lineRows.map(([l, x]) => {
                    const avg = x.resp.length ? x.resp.reduce((s, v) => s + v, 0) / x.resp.length : null;
                    return (
                      <tr key={l}>
                        <td>{tr('Line')} {l}</td>
                        <td className="r mono">{x.aktif}</td>
                        <td className={`r mono ${avg != null && avg > rules.rfqTargetHari ? 'warn' : ''}`}>{avg == null ? '–' : `${fmt1(avg)} ${tr('hari')}`}</td>
                        <td className={`r mono ${x.lewat ? 'bad' : ''}`}>{x.lewat}</td>
                        <td className={`r mono ${x.telat ? 'bad' : ''}`}>{x.telat}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="ld-foot muted">{tr('Target waktu jawab')} ≤ {rules.rfqTargetHari} {tr('hari')} · {tr('batas diatur Admin di Batas Waktu & Margin')}</div>
            </>
          ) : (
            <>
              <div className="ld-card-h"><b>{tr('Divisi per bagian')}</b><span className="muted">{tr('bulan berjalan')}</span></div>
              <table className="simple-table ld-tbl">
                <thead><tr><th>{tr('Bagian')}</th><th className="r">{tr('Target')}</th><th className="r">{tr('Realisasi')}</th><th className="r">{tr('Status')}</th></tr></thead>
                <tbody>
                  {regRows.map(([k, x]) => {
                    const pct = x.target ? Math.round((x.real / x.target) * 100) : null;
                    return (
                      <tr key={k}>
                        <td>{tr('Sales')} · {k}</td>
                        <td className="r mono">{formatRupiah(x.target)}</td>
                        <td className="r mono">{formatRupiah(x.real)}</td>
                        <td className={`r mono ${pct == null ? '' : pct >= 100 ? 'ok' : pct >= 80 ? 'warn' : 'bad'}`}>{pct == null ? '–' : `${pct}%`}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>{tr('Operation')} · {tr('RFQ dijawab ≤')} {rules.rfqTargetHari} {tr('hari')}</td>
                    <td className="r mono">90%</td>
                    <td className="r mono">{inTarget == null ? '–' : `${inTarget}%`}</td>
                    <td className={`r mono ${inTarget == null ? '' : inTarget >= 90 ? 'ok' : 'warn'}`}>{inTarget == null ? '–' : inTarget >= 90 ? tr('sesuai') : tr('di bawah')}</td>
                  </tr>
                  <tr>
                    <td>{tr('Operation')} · {tr('item PO Indent lewat target')}</td>
                    <td className="r mono">0</td>
                    <td className="r mono">{lateItems.length}</td>
                    <td className={`r mono ${lateItems.length ? 'bad' : 'ok'}`}>{lateItems.length ? tr('perlu tindakan') : tr('sesuai')}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      <section className="ld-card">
        <div className="ld-card-h"><b>{ops ? tr('Operasional') : tr('Ringkasan dua GM')}</b></div>
        <div className="ld-low">
          {(ops
            ? [
                { h: tr('Kebutuhan barang mendatang (pipeline, baca)'), lines: [[`${tr('Negosiasi')} · ${nego.length} ${tr('prospek')}`, negoKg ? ton(negoKg) : '–'], [`${tr('PO Indent belum tiba')}`, indentKg ? ton(indentKg) : '–'], [tr('PO / DO dengan item Indent / Import'), String(indent.length)]] },
                { h: tr('Barang telat (PO Indent)'), lines: [[tr('Lewat target kedatangan'), `${lateItems.length} item`], [tr('Melewati janji ke customer'), `${lateItems.filter((x) => x.janji).length} item`], [`> ${rules.telatOpsHari} ${tr('hari')}`, `${lateItems.filter((x) => x.late > rules.telatOpsHari).length} item`]] },
                { h: tr('Database Vendor'), lines: [[tr('Menunggu keputusan AVL'), String(avlWait.length)], [tr('Dokumen habis ≤ 30 hari'), `${docSoon.length} vendor`], [tr('Vendor aktif'), String(vendors.filter((v) => avlOf(v) === 'aktif').length)]] },
              ]
            : [
                { h: tr('Sales (GM)'), lines: [[tr('Pipeline terbuka'), formatRupiah(pipeline)], [tr('Prospek Negosiasi'), String(nego.length)], [tr('Masalah Sales terbuka'), String(issues.filter((i) => i.sumber !== 'purchasing' && isOpenIssue(i)).length)]] },
                { h: tr('Operation (GM Operation)'), lines: [[tr('RFQ belum dijawab'), String(unanswered.length)], [tr('Barang telat'), `${lateItems.length} item`], [tr('Masalah Purchasing terbuka'), String(purchOpen.length + purchIssues.length)]] },
                { h: tr('Margin & harga'), lines: [[tr('Margin rata-rata RFQ'), avgMargin == null ? '–' : `${fmt1(avgMargin)}%`], [tr('Batas margin minimum'), `${rules.marginMin}%`], [tr('Pengajuan margin menunggu'), String(marginWait.length)]] },
              ]
          ).map((b) => (
            <div key={b.h} className="ld-low-col">
              <b>{b.h}</b>
              {b.lines.map(([a, v]) => (
                <div key={a} className="ld-low-row"><span className="muted">{a}</span><span className="mono">{v}</span></div>
              ))}
            </div>
          ))}
        </div>
      </section>
      {!isOpsLead(role) && role !== 'admin' && <div className="field-note">{tr('Tampilan ini untuk VP dan GM Operation.')}</div>}
    </div>
  );
}
