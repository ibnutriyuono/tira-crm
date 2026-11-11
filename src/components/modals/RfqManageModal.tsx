'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { AttachNoteBadges } from '../AttachNoteBadges';
import { ItemChatBadge, useItemChatCounts } from '../ItemChatBadge';
import { IconCheck, IconEdit, IconTrash } from '../icons';
import { formatDateID, formatDateTimeID, formatRupiah, num, todayStr } from '@/lib/format';
import { STATUS_META } from '@/lib/constants';
import { WORKFLOW_META, WORKFLOW_STAGES, rfqAsWorkflowDoc, workflowStage, type WorkflowStage } from '@/lib/purchasing-workflow';
import { appendSheet, buildRfqSheet } from '@/lib/exports';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Rfq, RfqItem } from '@/lib/types';
import { canNow } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
/** Mirrors the single-file app's rfqJawabanSummary(). */
function jawabanSummary(items: RfqItem[]): string {
  const answered = (items || []).filter((it) => it.hargaPurchasing || it.coo);
  if (answered.length === 0) return '-';
  const first = answered[0];
  const label = `${first.hargaPurchasing ? formatRupiah(first.hargaPurchasing) : '-'}${first.coo ? ` · ${first.coo}` : ''}`;
  return answered.length > 1 ? `${label} (+${answered.length - 1} lainnya)` : label;
}

function statusColor(status: string): string {
  return status === 'Selesai' ? 'green' : status === 'Terkirim' ? 'steel' : 'slate';
}

export function RfqManageModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'rfqManage';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const rfqs = useDataStore((s) => s.rfqs);
  const prospects = useDataStore((s) => s.prospects);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const toast = useDataStore((s) => s.toast);

  const chatCounts = useItemChatCounts('rfq', show);
  const opsRules = useDataStore((s) => s.opsRules);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [preset, setPreset] = useState<'' | 'bulan' | 'lalu' | '3bulan' | 'tahun'>('');
  const [regF, setRegF] = useState('');
  const [cabF, setCabF] = useState('');
  const [seF, setSeF] = useState('');
  const [stageF, setStageF] = useState('');
  const [jawabF, setJawabF] = useState<'' | 'belum' | 'sudah'>('');
  const [linkF, setLinkF] = useState<'' | 'ya' | 'tidak'>('');
  const [quick, setQuick] = useState<'' | 'tunggu' | 'telat' | 'dijawab' | 'selesai' | 'lepas'>('');

  const today = todayStr();
  const target = num(opsRules.rfqTargetHari) || 2;
  const byProspect = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  // Satu baris RFQ diperkaya: SE (dari prospek), tahap Purchasing, umur menunggu jawaban.
  const rows = useMemo(
    () =>
      rfqs.map((r) => {
        const p = r.prospectId ? byProspect.get(r.prospectId) : undefined;
        const stage = workflowStage(rfqAsWorkflowDoc(r)) as WorkflowStage;
        const sent = (r.sentToPurchasingAt || '').slice(0, 10);
        const waiting = (stage === 1 || stage === 2) && r.status !== 'Draft';
        const age = waiting && sent ? Math.max(0, Math.round((Date.parse(today) - Date.parse(sent)) / 86400000)) : null;
        return { r, p, se: (p?.se || '').toUpperCase(), stage, waiting, age, late: age != null && age > target };
      }),
    [rfqs, byProspect, today, target],
  );
  const range = useMemo((): [string, string] => {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    const pad = (n: number) => String(n).padStart(2, '0');
    if (preset === 'bulan') return [`${today.slice(0, 7)}-01`, today];
    if (preset === 'lalu') {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-31`];
    }
    if (preset === '3bulan') {
      const d = new Date(y, m - 3, 1);
      return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, today];
    }
    if (preset === 'tahun') return [`${y}-01-01`, today];
    return ['', ''];
  }, [preset, today]);

  // Saringan dasar (periode, wilayah, Sales) — dasar angka ringkasan.
  const base = useMemo(
    () =>
      rows.filter(({ r, se }) => {
        const tgl = (r.tglRfq || r.createdAt || '').slice(0, 10);
        if (range[0] && (tgl < range[0] || tgl > range[1])) return false;
        if (regF && String(r.reg ?? '') !== regF) return false;
        if (cabF && (r.cabang || '').toUpperCase() !== cabF) return false;
        if (seF && se !== seF) return false;
        return true;
      }),
    [rows, range, regF, cabF, seF],
  );
  const kpi = useMemo(
    () => ({
      total: base.length,
      draft: base.filter((x) => x.r.status === 'Draft').length,
      tunggu: base.filter((x) => x.waiting).length,
      telat: base.filter((x) => x.late).length,
      dijawab: base.filter((x) => x.stage === 3).length,
      selesai: base.filter((x) => x.stage === 4).length,
      lepas: base.filter((x) => !x.r.prospectId).length,
    }),
    [base],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.filter(({ r, p, se, stage, waiting, late }) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (stageF && String(stage) !== stageF) return false;
      if (jawabF === 'sudah' && !r.jawabanRfqDikirim) return false;
      if (jawabF === 'belum' && r.jawabanRfqDikirim) return false;
      if (linkF === 'ya' && !r.prospectId) return false;
      if (linkF === 'tidak' && r.prospectId) return false;
      if (quick === 'tunggu' && !waiting) return false;
      if (quick === 'telat' && !late) return false;
      if (quick === 'dijawab' && stage !== 3) return false;
      if (quick === 'selesai' && stage !== 4) return false;
      if (quick === 'lepas' && r.prospectId) return false;
      if (q) {
        const hay = [r.noRfq, r.customer, r.cabang, se, r.requestedBy, p?.customer, ...(r.items || []).map((i) => `${i.material || ''} ${i.grade || ''}`)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [base, statusFilter, stageF, jawabF, linkF, quick, search]);
  const list = shown.map((x) => x.r);
  const meta = new Map(shown.map((x) => [x.r.id, x]));

  const regOpts = Array.from(new Set(rfqs.map((r) => r.reg).filter((x) => x != null))).sort() as number[];
  const cabOpts = Array.from(new Set(rfqs.filter((r) => !regF || String(r.reg ?? '') === regF).map((r) => (r.cabang || '').toUpperCase()).filter(Boolean))).sort();
  const seOpts = Array.from(new Set(rows.filter((x) => (!cabF || (x.r.cabang || '').toUpperCase() === cabF) && (!regF || String(x.r.reg ?? '') === regF)).map((x) => x.se).filter(Boolean))).sort();
  const anyFilter = !!(search || statusFilter || preset || regF || cabF || seF || stageF || jawabF || linkF || quick);
  const reset = () => {
    setSearch(''); setStatusFilter(''); setPreset(''); setRegF(''); setCabF(''); setSeF(''); setStageF(''); setJawabF(''); setLinkF(''); setQuick('');
  };
  const tile = (k: typeof quick, cls: string, label: string, value: number, foot: string) => (
    <button type="button" className={`kpi ${cls} rq-tile${quick === k ? ' on' : ''}`} onClick={() => setQuick(quick === k ? '' : k)} aria-pressed={quick === k}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="foot">{foot}</div>
    </button>
  );

  async function exportExcel() {
    if (list.length === 0) return toast('Tidak ada data RFQ untuk diexport.', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, buildRfqSheet(list));
    XLSX.writeFile(wb, `Kelola_RFQ_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${list.length} RFQ`, 'success');
  }

  async function markDone(id: string) {
    try {
      const { rfq } = await api.patch<{ rfq: Rfq }>(`/api/rfqs/${id}`, { status: 'Selesai' });
      upsertRfq(rfq);
      toast('RFQ ditandai selesai', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memperbarui RFQ', 'error');
    }
  }

  return (
    <Modal show={show} onClose={closeModal} title={tr("Kelola RFQ")} xwide stickyHead footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr("Tutup")}</button>}>
      <div className="kpi-grid rq-kpis">
        {tile('', 'aktif', tr('RFQ'), kpi.total, `${kpi.draft} ${tr('masih draft')}`)}
        {tile('tunggu', 'git', tr('Menunggu jawaban'), kpi.tunggu, tr('Baru / Diterima Purchasing'))}
        {tile('telat', 'lost', tr('Lewat target'), kpi.telat, `${tr('belum dijawab >')} ${target} ${tr('hari')}`)}
        {tile('dijawab', 'rate', tr('Dijawab'), kpi.dijawab, tr('harga / COO sudah diisi'))}
        {tile('selesai', 'won', tr('Selesai'), kpi.selesai, tr('ditutup'))}
        {tile('lepas', 'pending', tr('Belum terhubung'), kpi.lepas, tr('ke prospek'))}
      </div>
      <div className="toolbar-row rq-filters">
        <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} aria-label={tr('Periode')}>
          <option value="">{tr('Semua tanggal')}</option>
          <option value="bulan">{tr('Bulan ini')}</option>
          <option value="lalu">{tr('Bulan lalu')}</option>
          <option value="3bulan">{tr('3 bulan terakhir')}</option>
          <option value="tahun">{tr('Tahun ini')}</option>
        </select>
        {regOpts.length > 1 && (
          <select value={regF} onChange={(e) => { setRegF(e.target.value); setCabF(''); setSeF(''); }} aria-label={tr('Regional')}>
            <option value="">{tr('Semua Regional')}</option>
            {regOpts.map((r) => <option key={r} value={String(r)}>{tr('Regional')} {r}</option>)}
          </select>
        )}
        {cabOpts.length > 1 && (
          <select value={cabF} onChange={(e) => { setCabF(e.target.value); setSeF(''); }} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua Cabang')}</option>
            {cabOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {seOpts.length > 1 && (
          <select value={seF} onChange={(e) => setSeF(e.target.value)} aria-label={tr('Sales')}>
            <option value="">{tr('Semua Sales')}</option>
            {seOpts.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <select value={stageF} onChange={(e) => setStageF(e.target.value)} aria-label={tr('Tahap Purchasing')}>
          <option value="">{tr('Semua tahap Purchasing')}</option>
          {WORKFLOW_STAGES.map((st) => <option key={st} value={String(st)}>{WORKFLOW_META[st].label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={tr('Status dokumen')}>
          <option value="">{tr("Semua Status")}</option>
          <option value="Draft">{tr("Draft")}</option>
          <option value="Terkirim">{tr("Terkirim")}</option>
          <option value="Selesai">{tr("Selesai")}</option>
        </select>
        <select value={jawabF} onChange={(e) => setJawabF(e.target.value as typeof jawabF)} aria-label={tr('Jawaban ke Sales')}>
          <option value="">{tr('Semua jawaban')}</option>
          <option value="sudah">{tr('Jawaban terkirim')}</option>
          <option value="belum">{tr('Jawaban belum dikirim')}</option>
        </select>
        <select value={linkF} onChange={(e) => setLinkF(e.target.value as typeof linkF)} aria-label={tr('Prospek')}>
          <option value="">{tr('Semua prospek')}</option>
          <option value="ya">{tr('Terhubung prospek')}</option>
          <option value="tidak">{tr('Belum terhubung')}</option>
        </select>
        <input type="search" className="rq-search" placeholder={tr("Cari No RFQ, customer, SE, material, pembuat…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        {canNow('rfq', 'x') && (
          <button className="btn btn-outline btn-sm" onClick={exportExcel}>{tr("Export Excel")}</button>
        )}
      </div>
      <div className="rq-count">
        {tr('Menampilkan')} <b>{list.length}</b> {tr('dari')} {rfqs.length} RFQ
        {anyFilter && <button type="button" className="link-btn" onClick={reset}>{tr('Reset filter')}</button>}
      </div>
      <div className="import-summary">
        {tr("RFQ digunakan untuk meminta ketersediaan/harga material ke Purchasing selama prospek masih berjalan (Aktif). Setelah prospek dinyatakan")} <b>{tr("Won")}</b>{tr(", buat")} <b>{tr("FUP A")}</b> {tr("(permintaan pembelian resmi) dari menu Kelola FUP A dengan merujuk No. RFQ ini.")}
      </div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}>
          <h3>{rfqs.length === 0 ? tr("Belum ada RFQ") : tr("Tidak ditemukan")}</h3>
          <p>{rfqs.length === 0 ? tr("Buat RFQ dari tombol RFQ pada prospek.") : tr("Coba ubah filter atau kata kunci pencarian.")}</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead>
              <tr>
                <th>{tr("No RFQ")}</th>
                <th>{tr("Tanggal")}</th>
                <th>{tr("Cabang")}</th>
                <th>{tr("Customer")}</th>
                <th>{tr("Prospek")}</th>
                <th>{tr("Material")}</th>
                <th>{tr("Status")}</th>
                <th>{tr("FUP A")}</th>
                <th>{tr("Purchasing")}</th>
                <th>{tr("Lampiran")}</th>
                <th>{tr("Jawaban Harga")}</th>
                <th>{tr("Dibuat Oleh")}</th>
                <th>{tr("Aksi")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.noRfq || '-'}<ItemChatBadge count={chatCounts[r.id]} /></td>
                  <td className="mono">{formatDateID(r.tglRfq)}</td>
                  <td>{r.cabang || '-'}</td>
                  <td>{r.customer || '-'}{meta.get(r.id)?.se && <div className="text-muted" style={{ fontSize: 11 }}>SE {meta.get(r.id)!.se}</div>}</td>
                  <td>
                    {r.prospectId ? (
                      (() => {
                        const p = prospects.find((x) => x.id === r.prospectId);
                        return <span className="badge green" title={p ? `${p.customer} · SE ${p.se || '-'}` : ''}>{p ? STATUS_META[num(p.status)]?.label || tr('Terhubung') : tr('Terhubung')}</span>;
                      })()
                    ) : (
                      <>
                        <span className="badge amber">{tr('Belum terhubung')}</span>
                        {canNow('rfq', 'e') && canNow('prospek', 'v') && (
                          <button
                            type="button"
                            className="link-btn"
                            style={{ display: 'block', marginTop: 3, fontSize: 11.5 }}
                            onClick={() => {
                              useUiStore.setState({ rfqCtx: { prospectId: null, rfqId: r.id } });
                              openModal('rfq');
                            }}
                          >
                            {tr('Hubungkan')} →
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td className="center">{(r.items || []).length}</td>
                  <td>
                    <span className={`badge ${statusColor(r.status)}`}>{r.status || tr("Draft")}</span>
                  </td>
                  <td>
                    {r.fupaId ? <span className="badge amber">{tr("Ada")}</span> : <span className="badge slate">-</span>}
                  </td>
                  <td>
                    {/* The real 5-stage Purchasing status, same as the detail
                        screen and Permintaan Masuk. This column used to show the
                        retired purchStatus ladder, so a row could read Status
                        "Selesai" while Purchasing still said "Baru". */}
                    <span className={`badge ${WORKFLOW_META[workflowStage(rfqAsWorkflowDoc(r))].color}`}>
                      {WORKFLOW_META[workflowStage(rfqAsWorkflowDoc(r))].label}
                    </span>
                    <div className="text-muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                      {r.sentToPurchasingAt ? `Dikirim ${formatDateTimeID(r.sentToPurchasingAt)}` : tr("Belum dikirim")}
                    </div>
                    {meta.get(r.id)?.age != null && (
                      <div className={`rq-age${meta.get(r.id)!.late ? ' late' : ''}`}>{tr('menunggu')} {meta.get(r.id)!.age} {tr('hari')}</div>
                    )}
                  </td>
                  <td><AttachNoteBadges rfqId={r.id} /></td>
                  <td>
                    {r.jawabanRfqDikirim ? (
                      <span className="badge green" title={formatDateID(r.jawabanRfqAt)}>{tr("Terkirim")}</span>
                    ) : (
                      <span className="badge slate">{tr("Belum")}</span>
                    )}
                    <div className="text-muted" style={{ fontSize: 11 }}>{jawabanSummary(r.items)}</div>
                  </td>
                  <td>{r.requestedBy || '-'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        title={canNow('rfq', 'e') ? tr("Buka / Edit") : tr("Lihat (hanya-baca)")}
                        onClick={() => {
                          useUiStore.setState({ rfqCtx: { prospectId: r.prospectId, rfqId: r.id } });
                          openModal('rfq');
                        }}
                      >
                        <IconEdit />
                      </button>
                      {r.status !== 'Selesai' && canNow('rfq', 'e') && (
                        <button className="icon-btn" title={tr("Tandai Selesai")} onClick={() => markDone(r.id)}>
                          <IconCheck />
                        </button>
                      )}
                      {canNow('rfq', 'd') && (
                      <button
                        className="icon-btn danger"
                        title={tr("Hapus")}
                        onClick={() => {
                          useUiStore.setState({
                            deleteCtx: { mode: 'rfq', id: r.id, title: 'Hapus RFQ', message: `Yakin ingin menghapus RFQ "${r.noRfq || '(tanpa nomor)'}" untuk ${r.customer || '-'}? Tindakan ini tidak dapat dibatalkan.` },
                          });
                          openModal('delete');
                        }}
                      >
                        <IconTrash />
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
