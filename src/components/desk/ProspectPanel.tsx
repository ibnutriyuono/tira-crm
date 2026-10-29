'use client';

import { useEffect, useMemo, useState } from 'react';
import { STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah, klasBadgeColor, materialsWithValue, num } from '@/lib/format';
import { isOpenIssue } from '@/lib/issues';
import { fupaAsWorkflowDoc, rfqAsWorkflowDoc, WORKFLOW_META, workflowStage } from '@/lib/purchasing-workflow';
import { quotePermAct } from '@/lib/roles';
import { useCan } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { KamBadge } from '../KamBadge';
import { IconDoc, IconEdit, IconRfq, IconWa } from '../icons';

const STAGES = [1, 2, 3, 4, 5];
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00`).getTime()) / 86400000);

/**
 * Panel kanan tampilan baru: ringkasan satu prospek tanpa menutup daftar —
 * tahap, follow-up, penawaran, item, RFQ/FUP A, masalah, dan aksi cepat.
 */
export function ProspectPanel({ id }: { id: string }) {
  const tr = useT();
  const p = useDataStore((s) => s.prospects.find((x) => x.id === id));
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const issues = useDataStore((s) => s.issues);
  const me = useDataStore((s) => s.currentUser);
  const canE = useCan('prospek', 'e');
  const canX = useCan('prospek', quotePermAct(me?.role));
  const canRfq = useCan('rfq', 'e');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const close = () => useUiStore.setState({ deskPanelId: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUiStore.getState().modal && !useUiStore.getState().paletteOpen) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const docs = useMemo(() => {
    if (!p) return [];
    return [
      ...rfqs.filter((r) => r.prospectId === p.id).map((r) => ({ id: r.id, jenis: 'RFQ' as const, no: r.noRfq || tr('(draft)'), tgl: r.tglRfq, stage: workflowStage(rfqAsWorkflowDoc(r)), draft: r.status === 'Draft' })),
      ...fupas.filter((f) => f.prospectId === p.id).map((f) => ({ id: f.id, jenis: 'FUP A' as const, no: f.noFupa || tr('(draft)'), tgl: f.tglFupa, stage: workflowStage(fupaAsWorkflowDoc(f)), draft: f.status === 'Draft' })),
    ];
  }, [p, rfqs, fupas, tr]);

  if (!p) {
    return (
      <aside className="dk-panel">
        <div className="dk-panel-h"><b>{tr('Prospek tidak ditemukan')}</b><button type="button" className="dk-x" onClick={close} aria-label={tr('Tutup')}>×</button></div>
      </aside>
    );
  }

  const st = num(p.status);
  const klas = classify(p);
  const meta = STATUS_META[st] || STATUS_META[0];
  const inStage = Math.max(0, dayDiff(String(p.statusChangedAt || p.updatedAt), today));
  const fuLate = p.followUpAt ? p.followUpAt < today : false;
  const mats = materialsWithValue(p);
  const openIssues = issues.filter((i) => i.prospectId === p.id && isOpenIssue(i));
  const set = useUiStore.setState;
  const open = useUiStore.getState().openModal;

  return (
    <aside className="dk-panel" aria-label={tr('Detail prospek')}>
      <div className="dk-panel-h">
        <div style={{ minWidth: 0 }}>
          <button type="button" className="dk-cust" title={tr('Buka Profil Customer')} onClick={() => { set({ profileCustomer: p.customer, profileReturnTo: null }); open('customerProfile'); }}>
            {p.customer} <KamBadge customer={p.customer} />
          </button>
          <div className="dk-sub">{[p.cabang, p.se, p.reg ? `Reg ${p.reg}` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="dk-x" onClick={close} aria-label={tr('Tutup panel')} title={tr('Tutup (Esc)')}>×</button>
      </div>

      <div className="dk-panel-b">
        <div className="dk-val">
          <b className="mono">{formatRupiah(p.value)}</b>
          <span className={`badge ${klasBadgeColor(klas)}`}>{klas}</span>
        </div>
        <div className="dk-sub">{[p.line ? `Line ${p.line}` : null, p.uraian].filter(Boolean).join(' · ') || '-'}</div>

        {st >= 1 && st <= 5 && (
          <div className="dk-steps" aria-label={tr('Tahap')}>
            {STAGES.map((s) => (
              <div key={s} className={`dk-step${s < st ? ' done' : s === st ? ' on' : ''}`}>
                <i />
                <small>{tr(STATUS_META[s].label)}</small>
              </div>
            ))}
          </div>
        )}
        <div className="dk-line">
          <span className={`badge ${meta.color}`}>{st} · {tr(meta.label)}</span>
          {klas === 'Aktif' && <span className={inStage > 30 ? 'dk-bad' : 'muted'}>{inStage} {tr('hari di tahap ini')}</span>}
        </div>

        <section className="dk-sec">
          <h4>{tr('Follow-up')}</h4>
          {p.followUpAt ? (
            <div className={`dk-fu${fuLate ? ' late' : ''}`}>
              <b>{formatDateID(p.followUpAt)}</b>
              <span>{fuLate ? `${tr('terlambat')} ${dayDiff(p.followUpAt, today)} ${tr('hari')}` : p.followUpAt === today ? tr('hari ini') : ''}</span>
              {p.followUpNote && <small>{p.followUpNote}</small>}
            </div>
          ) : (
            <div className={klas === 'Aktif' ? 'dk-bad' : 'muted'}>{tr('Belum ada jadwal follow-up')}</div>
          )}
        </section>

        <section className="dk-sec">
          <h4>{tr('Penawaran')}</h4>
          <div className="dk-kv"><span>{tr('Tanggal')}</span><b>{formatDateID(p.tglPenawaran)}</b></div>
          <div className="dk-kv"><span>{tr('Status kirim')}</span><span className={`badge ${p.penawaranTerkirim ? 'green' : 'rust'}`}>{p.penawaranTerkirim ? tr('Terkirim') : tr('Pending')}</span></div>
          {p.noPo && <div className="dk-kv"><span>{tr('No. PO')}</span><b>{p.noPo}</b></div>}
          {p.tglPO && <div className="dk-kv"><span>{tr('Tgl PO')}</span><b>{formatDateID(p.tglPO)}</b></div>}
          {p.kondisiStock && <div className="dk-kv"><span>{tr('Kondisi stok')}</span><b>{p.kondisiStock}</b></div>}
        </section>

        {mats.length > 0 && (
          <section className="dk-sec">
            <h4>{tr('Item')} · {mats.length}</h4>
            <table className="dk-items">
              <tbody>
                {mats.slice(0, 8).map((m, i) => (
                  <tr key={i}>
                    <td>{m.uraian || '-'}</td>
                    <td className="r mono">{num(m.qty).toLocaleString('id-ID')}</td>
                    <td className="r mono">{formatRupiah(m.nilai)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mats.length > 8 && <small className="muted">+{mats.length - 8} {tr('item lain')}</small>}
          </section>
        )}

        {docs.length > 0 && (
          <section className="dk-sec">
            <h4>{tr('Purchasing')}</h4>
            {docs.map((d) => (
              <button
                key={d.id}
                type="button"
                className="dk-doc"
                onClick={() => {
                  if (d.jenis === 'RFQ') { set({ rfqCtx: { prospectId: p.id, rfqId: d.id } }); open('rfq'); }
                  else { set({ fupaCtx: { fupaId: d.id, sourceRfqId: null, prospectId: p.id } }); open('fupa'); }
                }}
              >
                <span>{d.jenis} {d.no}</span>
                <span className={`badge ${d.draft ? 'slate' : WORKFLOW_META[d.stage].color}`}>{d.draft ? 'Draft' : tr(WORKFLOW_META[d.stage].label)}</span>
              </button>
            ))}
          </section>
        )}

        {openIssues.length > 0 && (
          <section className="dk-sec">
            <h4>⚑ {tr('Masalah terbuka')}</h4>
            {openIssues.map((i) => (
              <button key={i.id} type="button" className="dk-doc" onClick={() => { set({ issueFocus: { id: i.id } }); open('pipelineIssues'); }}>
                <span>{i.kategori}</span>
                <small className="muted">{i.keterangan.slice(0, 60)}</small>
              </button>
            ))}
          </section>
        )}

        {p.keterangan && (
          <section className="dk-sec">
            <h4>{tr('Keterangan')}</h4>
            <p className="dk-note">{p.keterangan}</p>
          </section>
        )}
      </div>

      <div className="dk-panel-f">
        {canE && <button type="button" className="btn btn-wa btn-sm" onClick={() => { set({ followUpCtx: { type: 'prospect', id: p.id } }); open('followUp'); }}><IconWa /> {tr('Follow-up')}</button>}
        {canX && <button type="button" className="btn btn-outline btn-sm" onClick={() => { set({ quotationProspectId: p.id }); open('quotation'); }}><IconDoc /> {tr('Surat Penawaran')}</button>}
        {canRfq && klas === 'Aktif' && <button type="button" className="btn btn-outline btn-sm" onClick={() => { set({ rfqCtx: { prospectId: p.id, rfqId: null } }); open('rfq'); }}><IconRfq /> RFQ</button>}
        {klas === 'Won' && <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ itemFlowCtx: { prospectId: p.id }, modal: 'itemFlow' })}>{tr('Status Item')}</button>}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { set({ editProspectId: p.id }); open('prospectForm'); }}><IconEdit /> {canE ? tr('Edit') : tr('Lihat')}</button>
      </div>
    </aside>
  );
}
