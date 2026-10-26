'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { PURCH_ISSUE_CATS, URGENSI, type PipelineIssue } from '@/lib/issues';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';

export interface PurchIssueTarget {
  /** RFQ / FUP A, atau PO (prospek) dari tab PO Indent. */
  rfqId?: string;
  fupaId?: string;
  prospectId?: string;
  noDoc: string;
  cabang: string;
  customer: string;
  sales?: string;
  hasProspect: boolean;
  items: string[];
}

/**
 * ⚑ Laporkan masalah dari Purchasing — masuk sebagai usulan ke BM cabang
 * dokumen (BM menunjuk PJ atau menolak), Sales pemilik prospek diberi tahu.
 */
export function PurchIssueModal({ target, onClose }: { target: PurchIssueTarget; onClose: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [kategori, setKategori] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [ket, setKet] = useState('');
  const [solusi, setSolusi] = useState('');
  const [urgensi, setUrgensi] = useState('sedang');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!kategori) return setErr('Pilih kategori masalah.');
    if (ket.trim().length < 10) return setErr('Isi uraian masalah (min. 10 karakter).');
    setBusy(true);
    setErr('');
    try {
      const r = await api.post<{ issue: PipelineIssue }>('/api/pipeline-issues', {
        mode: 'purch',
        rfqId: target.rfqId,
        fupaId: target.fupaId,
        prospectId: target.prospectId,
        kategori,
        keterangan: ket,
        solusi,
        urgensi,
        items: picked,
      });
      useDataStore.getState().upsertIssue(r.issue);
      toast(`Laporan masalah ${target.noDoc} dikirim ke BM ${target.cabang}`, 'success');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pi-hist-back" onClick={onClose}>
      <div className="pi-hist pm" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tr("Laporkan masalah")}>
        <div className="pi-hist-head">
          <b>⚑ {tr("Laporkan masalah —")} {target.noDoc}</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr("Tutup")}>×</button>
        </div>
        <label>{tr("Kategori *")}</label>
        <div className="sa-pills">
          {PURCH_ISSUE_CATS.map((c) => (
            <button key={c.key} type="button" className={kategori === c.key ? 'on' : ''} aria-pressed={kategori === c.key} onClick={() => setKategori(c.key)}>
              {tr(c.label)}
            </button>
          ))}
        </div>
        {target.items.length > 0 && (
          <>
            <label>{tr("Item terkait")}</label>
            <div className="vr-items">
              {target.items.map((it) => (
                <label key={it}>
                  <input type="checkbox" checked={picked.includes(it)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, it] : x.filter((y) => y !== it)))} /> {it}
                </label>
              ))}
            </div>
          </>
        )}
        <label>{tr("Uraian masalah *")}</label>
        <textarea rows={3} value={ket} onChange={(e) => setKet(e.target.value)} placeholder={tr("cth. Harga mill naik 8% mulai November; penawaran vendor lama tidak berlaku lagi.")} />
        <label>{tr("Usulan solusi (opsional)")}</label>
        <input type="text" value={solusi} onChange={(e) => setSolusi(e.target.value)} placeholder={tr("cth. Tawarkan grade alternatif HB450 yang ready")} />
        <label>{tr("Urgensi")}</label>
        <div className="sa-pills">
          {URGENSI.map((u) => (
            <button key={u.key} type="button" className={urgensi === u.key ? 'on' : ''} onClick={() => setUrgensi(u.key)}>{tr(u.label)}</button>
          ))}
        </div>
        <div className="pm-route">
          <div>{tr("Dikirim ke:")} <b>{tr("BM cabang")} {target.cabang || '-'}</b> {target.hasProspect ? <>{tr("sebagai usulan masalah di prospek")} <b>{target.customer}</b></> : tr("(dokumen tanpa prospek — diskusi di thread dokumen)")}</div>
          {target.sales && <div>{tr("Diberi tahu:")} {target.sales} {tr("(Sales pemilik)")}</div>}
          <div>{tr("BM memutuskan: buka masalah & tunjuk PJ, atau tolak dengan alasan. Pantau di tab ⚑ Masalah → Dilaporkan oleh saya.")}</div>
        </div>
        {err && <div className="form-error">{err}</div>}
        <div className="toolbar-row" style={{ marginTop: 10, marginBottom: 0, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{tr("Batal")}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>{tr("Kirim ke BM")}</button>
        </div>
      </div>
    </div>
  );
}

/** Buka tab ⚑ Masalah pada laporan tertentu. */
export const focusIssue = (id: string) => useUiStore.setState({ issueFocus: { id } });
