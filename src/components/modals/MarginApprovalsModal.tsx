'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { formatDateID } from '@/lib/format';
import type { MarginApprovalView } from '@/lib/margin-server';
import { MARGIN_LEVEL_LABEL } from '@/lib/margin-tier';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

const fmt1 = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const STATUS_BADGE: Record<string, string> = { menunggu: 'amber', disetujui: 'green', ditolak: 'rust' };

/**
 * Persetujuan Margin: pengajuan Surat Penawaran dengan margin di bawah batas,
 * untuk BM (cabangnya), RM (regionalnya), GM, VP & Admin. Tingkat yang
 * dibutuhkan mengikuti margin terendah (Batas Waktu & Margin); tombol
 * Setujui / Tolak hanya untuk yang berwenang. BM melihat persentase margin,
 * tanpa HPP.
 */
export function MarginApprovalsModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'marginApprovals');
  const closeModal = useUiStore((s) => s.closeModal);
  const toast = useDataStore((s) => s.toast);
  const rules = useDataStore((s) => s.opsRules);
  const [rows, setRows] = useState<MarginApprovalView[] | null>(null);
  const [tab, setTab] = useState<'menunggu' | 'riwayat'>('menunggu');
  const [noteId, setNoteId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ approvals: MarginApprovalView[] }>('/api/margin-approvals')
      .then((r) => setRows(r.approvals))
      .catch((e) => toast(e instanceof Error ? e.message : 'Gagal memuat', 'error'));
  }, [toast]);
  useEffect(() => {
    if (!show) return;
    load();
    const s = getSocket();
    s.on('marginApproval:updated', load);
    return () => {
      s.off('marginApproval:updated', load);
    };
  }, [show, load]);

  async function decide(a: MarginApprovalView, action: 'setuju' | 'tolak') {
    if (action === 'tolak' && note.trim().length < 5) return toast(tr('Tulis alasan penolakan.'), 'error');
    setBusy(true);
    try {
      await api.patch(`/api/margin-approvals/${a.id}`, { action, catatan: noteId === a.id ? note.trim() : '' });
      toast(action === 'setuju' ? tr('Margin disetujui — pengaju diberi tahu') : tr('Pengajuan margin ditolak'), 'success');
      setNoteId('');
      setNote('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  const wait = (rows || []).filter((a) => a.status === 'menunggu');
  const mine = wait.filter((a) => a.canDecide);
  const list = tab === 'menunggu' ? [...mine, ...wait.filter((a) => !a.canDecide)] : (rows || []).filter((a) => a.status !== 'menunggu');

  return (
    <Modal show={show} onClose={closeModal} title={tr('Persetujuan Margin')} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>}>
      <div className="ma-tiers">
        <span>{tr('Margin surat')}: ≥ {rules.marginMin}% {tr('langsung')}</span>
        <span className="badge steel">≥ {rules.marginBm}% BM</span>
        <span className="badge steel">≥ {rules.marginRm}% RM</span>
        <span className="badge steel">≥ {rules.marginGm}% GM</span>
        <span className="badge violet">&lt; {rules.marginGm}% VP</span>
      </div>
      <div className="ea-tabs" role="tablist" style={{ marginBottom: 10 }}>
        <button type="button" role="tab" aria-selected={tab === 'menunggu'} className={tab === 'menunggu' ? 'on' : ''} onClick={() => setTab('menunggu')}>
          {tr('Menunggu')} ({wait.length}){mine.length > 0 && <span className="item-chat-bubble">{mine.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'riwayat'} className={tab === 'riwayat' ? 'on' : ''} onClick={() => setTab('riwayat')}>{tr('Riwayat 60 hari')}</button>
      </div>
      {!rows && <div className="field-note">{tr('Memuat…')}</div>}
      {rows && list.length === 0 && <div className="field-note">{tab === 'menunggu' ? tr('Tidak ada pengajuan margin yang menunggu.') : tr('Belum ada riwayat.')}</div>}
      <div className="ma-list">
        {list.map((a) => {
          const low = (a.lines || []).filter((l) => l.below);
          return (
            <div key={a.id} className={`ma-card${a.canDecide ? ' mine' : ''}`}>
              <div className="ma-head">
                <div>
                  <b>{a.customer}</b>{a.nomor ? <span className="muted"> · {a.nomor}</span> : null}
                  <div className="muted">
                    {a.requestedByName} · {a.cabang || '-'}{a.se ? ` · SE ${a.se}` : ''} · {formatDateID(a.createdAt)}
                  </div>
                </div>
                <div className="ma-tags">
                  <span className="badge violet" title={tr('Tingkat persetujuan yang dibutuhkan')}>{tr('Perlu')} {MARGIN_LEVEL_LABEL[a.level]}</span>
                  {a.lowestMargin != null && <span className="badge rust">{tr('Terendah')} {fmt1(a.lowestMargin)}%</span>}
                  <span className={`badge ${STATUS_BADGE[a.status] || 'slate'}`}>{tr(a.status)}</span>
                </div>
              </div>
              {low.length > 0 && (
                <table className="simple-table ma-lines">
                  <thead><tr><th>{tr('Item di bawah')} {a.minMargin}%</th><th className="r">{tr('Margin')}</th>{low.some((l) => l.hpp != null) && <><th className="r">HPP</th><th className="r">{tr('Harga surat')}</th></>}</tr></thead>
                  <tbody>
                    {low.map((l) => (
                      <tr key={l.idx}>
                        <td>{l.uraian || `Item ${l.idx + 1}`}</td>
                        <td className="r mono">{l.margin == null ? '–' : `${fmt1(l.margin)}%`}</td>
                        {low.some((x) => x.hpp != null) && (
                          <>
                            <td className="r mono">{l.hpp != null ? l.hpp.toLocaleString('id-ID') : '–'}</td>
                            <td className="r mono">{l.price != null ? l.price.toLocaleString('id-ID') : '–'}{l.uom ? ` /${l.uom.toLowerCase()}` : ''}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="ma-why"><span className="muted">{tr('Alasan')}:</span> {a.alasan || '-'}</div>
              {a.status !== 'menunggu' && (
                <div className="ma-why">
                  <span className="muted">{a.status === 'disetujui' ? tr('Disetujui') : tr('Ditolak')} {tr('oleh')}</span> {a.decidedByName || '-'}
                  {a.decisionNote ? ` — ${a.decisionNote}` : ''}
                  {a.decidedAt ? <span className="muted"> · {formatDateID(a.decidedAt)}</span> : null}
                </div>
              )}
              {a.status === 'menunggu' && a.canDecide && (
                <div className="ma-act">
                  {noteId === a.id ? (
                    <>
                      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Catatan / alasan penolakan')} />
                      <button type="button" className="btn btn-sm btn-danger-soft" disabled={busy} onClick={() => void decide(a, 'tolak')}>{tr('Tolak')}</button>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void decide(a, 'setuju')}>{tr('Setujui dengan catatan')}</button>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => setNoteId('')}>{tr('Batal')}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void decide(a, 'setuju')}>{tr('Setujui')}</button>
                      <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => { setNoteId(a.id); setNote(''); }}>{tr('Tolak / beri catatan')}</button>
                    </>
                  )}
                </div>
              )}
              {a.status === 'menunggu' && !a.canDecide && <div className="field-note" style={{ margin: '6px 0 0' }}>{tr('Menunggu')} {MARGIN_LEVEL_LABEL[a.level]} {tr('atau di atasnya — Anda hanya dapat melihat.')}</div>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
