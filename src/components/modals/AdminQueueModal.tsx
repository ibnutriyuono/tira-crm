'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { formatDateID, formatRupiah, num } from '@/lib/format';
import { canSeeAdminQueue, canSetFaktur } from '@/lib/roles';
import { localToday } from '@/lib/sales-activity';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

const DAY = 86400000;
const daysSince = (d: string | null | undefined, today: string) => (d ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(d.slice(0, 10))) / DAY)) : null);

/** Dokumen yang belum lengkap pada prospek PO/Kontrak (4) atau DO (5). */
export function missingDocs(p: Prospect): string[] {
  const s = num(p.status);
  if (s !== 4 && s !== 5) return [];
  const out: string[] = [];
  if (!(p.noPo || '').trim()) out.push('No PO');
  if (!p.tglPO) out.push('Tgl PO');
  if (s === 5 && !p.tglDelivery) out.push('Tgl delivery');
  if (s === 5 && p.terfaktur && !p.tglFaktur) out.push('Tgl faktur');
  return out;
}

/** Jumlah tugas terbuka (untuk badge tombol Antrian Admin). */
export function adminTaskCount(prospects: Prospect[]): number {
  return prospects.filter((p) => (num(p.status) === 5 && !p.terfaktur) || missingDocs(p).length > 0 || (num(p.status) >= 1 && num(p.status) <= 3 && !p.penawaranTerkirim)).length;
}

/**
 * Antrian Kerja Admin Sales: DO belum terfaktur (tandai terfaktur massal),
 * dokumen PO/DO belum lengkap, dan penawaran belum dikirim — semua dalam
 * cakupan cabang pengguna.
 */
export function AdminQueueModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'adminQueue';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const prospects = useDataStore((s) => s.prospects);
  const currentUser = useDataStore((s) => s.currentUser);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);
  const today = localToday();

  const [tab, setTab] = useState<'faktur' | 'dokumen' | 'penawaran'>('faktur');
  const [se, setSe] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [tglFaktur, setTglFaktur] = useState(today);
  const [noFaktur, setNoFaktur] = useState('');
  const [busy, setBusy] = useState(false);

  const fakturOk = canSetFaktur(currentUser?.role);
  const list = useMemo(() => prospects.filter((p) => !se || (p.se || '').toUpperCase() === se), [prospects, se]);
  const seOptions = useMemo(() => Array.from(new Set(prospects.map((p) => (p.se || '').toUpperCase()).filter(Boolean))).sort(), [prospects]);

  const git = useMemo(
    () =>
      list
        .filter((p) => num(p.status) === 5 && !p.terfaktur)
        .map((p) => ({ p, age: daysSince(p.tglDelivery || p.statusChangedAt, today) }))
        .sort((a, b) => (b.age ?? 0) - (a.age ?? 0)),
    [list, today],
  );
  const docs = useMemo(() => list.map((p) => ({ p, miss: missingDocs(p) })).filter((x) => x.miss.length), [list]);
  const pending = useMemo(
    () =>
      list
        .filter((p) => num(p.status) >= 1 && num(p.status) <= 3 && !p.penawaranTerkirim)
        .map((p) => ({ p, age: daysSince(p.tglPenawaran || p.createdAt, today) }))
        .sort((a, b) => (b.age ?? 0) - (a.age ?? 0)),
    [list, today],
  );
  const month = today.slice(0, 7);
  const fakturMonth = list.filter((p) => num(p.status) === 5 && p.terfaktur && (p.tglFaktur || '').startsWith(month));
  const gitValue = git.reduce((s, x) => s + num(x.p.value), 0);
  const gitOld = git.filter((x) => (x.age ?? 0) > 30).length;

  if (!show || !canSeeAdminQueue(currentUser?.role)) return null;

  const openProspect = (id: string) => {
    useUiStore.setState({ editProspectId: id });
    openModal('prospectForm');
  };

  async function markFaktur() {
    if (!picked.length) return;
    setBusy(true);
    try {
      const res = await api.post<{ prospects: Prospect[]; skipped: string[] }>('/api/prospects/faktur', { ids: picked, tglFaktur, noFaktur });
      res.prospects.forEach(upsertProspect);
      setPicked([]);
      setNoFaktur('');
      toast(`${res.prospects.length} DO ditandai terfaktur ${formatDateID(tglFaktur)}${res.skipped.length ? ` · ${res.skipped.length} dilewati` : ''}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menandai terfaktur', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function markSent(p: Prospect) {
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${p.id}`, { penawaranTerkirim: true });
      upsertProspect(prospect);
      toast(`Penawaran ${p.customer} ditandai terkirim`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    }
  }

  const allGit = git.map((x) => x.p.id);
  const allPicked = allGit.length > 0 && allGit.every((id) => picked.includes(id));
  const pickedValue = git.filter((x) => picked.includes(x.p.id)).reduce((s, x) => s + num(x.p.value), 0);

  return (
    <Modal show={show} onClose={closeModal} title={`Antrian Admin Sales${currentUser?.cabang ? ` — ${currentUser.cabang}` : ''}`} xwide stickyHead footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="kpi-grid">
        <div className="kpi git"><div className="label">DO belum terfaktur</div><div className="value">{git.length}</div><div className="foot">{formatRupiah(gitValue)}</div></div>
        <div className="kpi lost"><div className="label">GIT &gt; 30 hari</div><div className="value">{gitOld}</div><div className="foot">percepat faktur / penagihan</div></div>
        <div className="kpi rate"><div className="label">Dokumen belum lengkap</div><div className="value">{docs.length}</div><div className="foot">PO / DO tanpa No PO, tanggal</div></div>
        <div className="kpi pending"><div className="label">Penawaran pending</div><div className="value">{pending.length}</div><div className="foot">belum dikirim ke customer</div></div>
        <div className="kpi won"><div className="label">Terfaktur bulan ini</div><div className="value">{fakturMonth.length}</div><div className="foot">{formatRupiah(fakturMonth.reduce((s, p) => s + num(p.value), 0))}</div></div>
      </div>

      <div className="toolbar-row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="ea-tabs" role="tablist" style={{ margin: 0, borderBottom: 'none' }}>
          {(
            [
              ['faktur', `Faktur (${git.length})`],
              ['dokumen', `Dokumen PO/DO (${docs.length})`],
              ['penawaran', `Penawaran pending (${pending.length})`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <select value={se} onChange={(e) => { setSe(e.target.value); setPicked([]); }} style={{ maxWidth: 170, marginLeft: 'auto' }} aria-label="Filter SE">
          <option value="">Semua Sales</option>
          {seOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {tab === 'faktur' && (
        <>
          {fakturOk && (
            <div className="aq-bar">
              <b>{picked.length} DO dipilih</b> <span className="mono">{formatRupiah(pickedValue)}</span>
              <label>Tgl faktur <input type="date" value={tglFaktur} onChange={(e) => setTglFaktur(e.target.value)} /></label>
              <label>No faktur <input type="text" value={noFaktur} onChange={(e) => setNoFaktur(e.target.value)} placeholder="opsional — satu faktur gabungan" style={{ width: 220 }} /></label>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !picked.length || !tglFaktur} onClick={markFaktur}>
                {busy ? 'Menyimpan…' : `Tandai terfaktur (${picked.length})`}
              </button>
            </div>
          )}
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table">
              <thead>
                <tr>
                  {fakturOk && <th style={{ width: 34 }}><input type="checkbox" aria-label="Pilih semua" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? allGit : [])} /></th>}
                  <th>Customer</th><th>SE</th><th>No PO</th><th>Tgl delivery</th><th>Umur GIT</th><th>Nilai</th><th></th>
                </tr>
              </thead>
              <tbody>
                {git.length === 0 && <tr><td colSpan={8} className="field-note">Semua DO sudah terfaktur.</td></tr>}
                {git.map(({ p, age }) => (
                  <tr key={p.id}>
                    {fakturOk && (
                      <td><input type="checkbox" aria-label={`Pilih ${p.customer}`} checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /></td>
                    )}
                    <td style={{ fontWeight: 600 }}>{p.customer}</td>
                    <td>{p.se || '-'}</td>
                    <td className="mono">{p.noPo || <span className="badge rust">kosong</span>}</td>
                    <td>{p.tglDelivery ? formatDateID(p.tglDelivery) : <span className="badge amber">kosong</span>}</td>
                    <td>{age == null ? '-' : <span className={`badge ${age > 30 ? 'rust' : age > 14 ? 'amber' : 'slate'}`}>{age} hari</span>}</td>
                    <td className="mono">{formatRupiah(num(p.value))}</td>
                    <td><button type="button" className="btn btn-outline btn-sm" onClick={() => openProspect(p.id)}>Buka</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="field-note" style={{ marginTop: 6 }}>
            Omzet dibukukan di bulan <b>tanggal faktur</b> (Target vs Pencapaian, KPI). Umur GIT dihitung dari tanggal delivery. No faktur diisi sama untuk semua DO yang dipilih bila diisi.
          </div>
        </>
      )}

      {tab === 'dokumen' && (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead><tr><th>Customer</th><th>SE</th><th>Status</th><th>Belum ada</th><th>Nilai</th><th></th></tr></thead>
            <tbody>
              {docs.length === 0 && <tr><td colSpan={6} className="field-note">Semua dokumen PO/DO lengkap.</td></tr>}
              {docs.map(({ p, miss }) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.customer}</td>
                  <td>{p.se || '-'}</td>
                  <td>{num(p.status) === 5 ? 'DO' : 'PO / Kontrak'}</td>
                  <td>{miss.map((m) => <span key={m} className="badge amber" style={{ marginRight: 4 }}>{m}</span>)}</td>
                  <td className="mono">{formatRupiah(num(p.value))}</td>
                  <td><button type="button" className="btn btn-outline btn-sm" onClick={() => openProspect(p.id)}>Lengkapi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'penawaran' && (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table">
            <thead><tr><th>Customer</th><th>SE</th><th>Tgl penawaran</th><th>Umur</th><th>Nilai</th><th></th></tr></thead>
            <tbody>
              {pending.length === 0 && <tr><td colSpan={6} className="field-note">Tidak ada penawaran pending.</td></tr>}
              {pending.map(({ p, age }) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.customer}</td>
                  <td>{p.se || '-'}</td>
                  <td>{p.tglPenawaran ? formatDateID(p.tglPenawaran) : '-'}</td>
                  <td>{age == null ? '-' : <span className={`badge ${age > 7 ? 'rust' : age > 3 ? 'amber' : 'slate'}`}>{age} hari</span>}</td>
                  <td className="mono">{formatRupiah(num(p.value))}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => markSent(p)} style={{ marginRight: 6 }}>Tandai terkirim</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openProspect(p.id)}>Buka</button>
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
