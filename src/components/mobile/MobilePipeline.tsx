'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { STATUS_META } from '@/lib/constants';
import { num } from '@/lib/format';
import { ACTIVE_PIPELINE_STATUSES, followUpDateProblem } from '@/lib/followup-rule';
import { useCan } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import type { Prospect } from '@/lib/types';

const STAGES = [1, 2, 3, 4, 5];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const jt = (v: number) => (v >= 1e9 ? `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M` : `${Math.round(v / 1e6).toLocaleString('id-ID')} jt`);

/** Pipeline HP: per tahap, kartu ringkas, pindah tahap (dengan follow-up), kirim penawaran, catat kunjungan. */
export function MobilePipeline({ onVisit }: { onVisit: (customer: string, prospectId?: string) => void }) {
  const tr = useT();
  const prospects = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);
  const openModal = useUiStore((s) => s.openModal);
  const canE = useCan('prospek', 'e');
  const canX = useCan('prospek', 'x');
  const [stage, setStage] = useState(2);
  const [q, setQ] = useState('');
  const [today] = useState(() => ymd(new Date()));
  const [move, setMove] = useState<{ p: Prospect; to: number; fu: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const ql = q.trim().toLowerCase();
  const list = prospects
    .filter((p) => num(p.status) === stage && (!ql || [p.customer, p.uraian, p.se].some((x) => (x || '').toLowerCase().includes(ql))))
    .sort((a, b) => (a.followUpAt || '9999').localeCompare(b.followUpAt || '9999') || num(b.value) - num(a.value));
  const age = (p: Prospect) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(String(p.statusChangedAt || p.createdAt).slice(0, 10))) / 86400000));

  function startMove(p: Prospect, to: number) {
    // PO / Kontrak (No. PO) dan Lose (QCD) punya isian wajib: lewat Edit Prospek lengkap.
    if (to === 4 || to === 5 || to === 6) {
      useUiStore.setState({ editProspectId: p.id });
      openModal('prospectForm');
      return;
    }
    setMove({ p, to, fu: p.followUpAt && p.followUpAt >= today ? p.followUpAt : '', note: p.followUpNote || '' });
  }

  async function doMove() {
    if (!move) return;
    const needFu = ACTIVE_PIPELINE_STATUSES.includes(move.to);
    const err = needFu ? followUpDateProblem(move.fu, today) : null;
    if (err) return toast(tr(err), 'error');
    setBusy(true);
    try {
      const r = await api.patch<{ prospect: Prospect }>(`/api/prospects/${move.p.id}`, { status: move.to, ...(needFu ? { followUpAt: move.fu, followUpNote: move.note } : {}) });
      upsertProspect(r.prospect);
      toast(`${move.p.customer} → ${tr(STATUS_META[move.to].label)}`, 'success');
      setMove(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal memindahkan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-page">
      <div className="mb-chips" role="tablist" aria-label={tr('Tahap')}>
        {STAGES.map((s) => {
          const n = prospects.filter((p) => num(p.status) === s).length;
          return (
            <button key={s} type="button" role="tab" aria-selected={stage === s} className={stage === s ? 'on' : ''} onClick={() => setStage(s)}>
              {s} · {tr(STATUS_META[s].label)} <span>{n}</span>
            </button>
          );
        })}
      </div>
      <input className="mb-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Cari customer / material')} />
      <div className="mb-sum muted">{list.length} {tr('prospek')} · Rp {jt(list.reduce((s, p) => s + num(p.value), 0))}</div>
      {list.length === 0 && <div className="mb-empty">{tr('Tidak ada prospek di tahap ini.')}</div>}
      {list.slice(0, 80).map((p) => {
        const late = !!p.followUpAt && p.followUpAt < today;
        return (
          <article key={p.id} className="mb-card mb-deal">
            <button type="button" className="mb-deal-t" onClick={() => { useUiStore.setState({ editProspectId: p.id }); openModal('prospectForm'); }}>
              <b>{p.customer}</b>
              <small className="muted">{(p.uraian || '').slice(0, 70)}</small>
              <span className="mb-row">
                <b className="mono">Rp {jt(num(p.value))}</b>
                <small className={late ? 'bad' : 'muted'}>{p.followUpAt ? `${tr('FU')} ${p.followUpAt}${late ? ` · ${tr('terlambat')}` : ''}` : tr('belum ada jadwal FU')} · {age(p)} {tr('hr di tahap ini')}</small>
              </span>
            </button>
            <div className="mb-item-a">
              {canE && stage < 5 && (
                <select aria-label={tr('Pindah tahap')} value="" onChange={(e) => e.target.value && startMove(p, Number(e.target.value))}>
                  <option value="">{tr('Pindah ke…')}</option>
                  {[1, 2, 3, 4, 6].filter((s) => s !== stage).map((s) => <option key={s} value={s}>{s} · {tr(STATUS_META[s].label)}</option>)}
                </select>
              )}
              {canX && (stage === 2 || stage === 3) && (
                <button type="button" className="mb-btn" onClick={() => { useUiStore.setState({ quotationProspectId: p.id }); openModal('quotation'); }}>{tr('Penawaran')}</button>
              )}
              <button type="button" className="mb-btn pri" onClick={() => onVisit(p.customer, p.id)}>{tr('Kunjungi')}</button>
            </div>
          </article>
        );
      })}

      {move && (
        <div className="mb-sheet-bg" onClick={() => !busy && setMove(null)}>
          <div className="mb-sheet" role="dialog" aria-label={tr('Pindah tahap')} onClick={(e) => e.stopPropagation()}>
            <b className="mb-sheet-t">{move.p.customer}</b>
            <span className="muted">{tr(STATUS_META[num(move.p.status)].label)} → <b>{tr(STATUS_META[move.to].label)}</b></span>
            {ACTIVE_PIPELINE_STATUSES.includes(move.to) && (
              <>
                <label>{tr('Follow-up berikutnya')} *</label>
                <input type="date" min={today} value={move.fu} onChange={(e) => setMove({ ...move, fu: e.target.value })} />
                <label>{tr('Catatan follow-up')}</label>
                <input type="text" value={move.note} placeholder={tr('cth. tanya keputusan PO')} onChange={(e) => setMove({ ...move, note: e.target.value })} />
              </>
            )}
            <div className="mb-sheet-a">
              <button type="button" className="mb-btn" disabled={busy} onClick={() => setMove(null)}>{tr('Batal')}</button>
              <button type="button" className="mb-btn pri" disabled={busy} onClick={doMove}>{tr('Pindahkan')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
