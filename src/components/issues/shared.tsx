'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCan } from '@/hooks/useCan';
import { api } from '@/lib/api-client';
import { ROLE_LABELS, STATUS_META } from '@/lib/constants';
import { formatRupiah } from '@/lib/format';
import { buildGroupIndex, groupForCustomer } from '@/lib/kam';
import { localToday } from '@/lib/sales-activity';
import {
  HASIL_META,
  ISSUE_CATS,
  ISSUE_STATUS_META,
  URGENSI,
  daysSince,
  isActiveIssue,
  issueCatLabel,
  urgensiLabel,
  type IssueHasil,
  type PipelineIssue,
} from '@/lib/issues';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { ItemChat } from '../ItemChat';
import { openPurchDoc } from '@/hooks/useCrmSocket';

export interface RosterUser {
  id: string;
  username: string;
  name: string;
  role: string;
  cabang: string | null;
  se: string | null;
}

let rosterCache: RosterUser[] | null = null;
let rosterPromise: Promise<RosterUser[]> | null = null;
/** Daftar user (untuk memilih penanggung jawab), dimuat sekali per sesi. */
export function useRoster(): RosterUser[] {
  const [list, setList] = useState<RosterUser[]>(rosterCache || []);
  useEffect(() => {
    if (rosterCache) return;
    rosterPromise ||= api.get<{ roster: RosterUser[] }>('/api/users/roster').then((r) => (rosterCache = r.roster)).catch(() => []);
    let alive = true;
    rosterPromise.then((r) => alive && setList(r));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export const userLabel = (u: RosterUser) => `${u.name} · ${ROLE_LABELS[u.role] || u.role}${u.cabang ? ` ${u.cabang}` : ''}`;
export const nameOf = (roster: RosterUser[], id: string) => roster.find((u) => u.id === id)?.name || '(user)';

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/** Usulan PJ otomatis per kategori (user id), dari role & cabang prospek. */
export function suggestPjIds(kategori: string, p: Pick<Prospect, 'cabang' | 'se' | 'customer'>, roster: RosterUser[], groups: ReturnType<typeof useDataStore.getState>['customerGroups']): string[] {
  const roles = ISSUE_CATS.find((c) => c.key === kategori)?.pjRoles || [];
  const out: string[] = [];
  roles.forEach((r) => {
    if (r === 'kam') {
      const g = groupForCustomer(buildGroupIndex(groups), p.customer);
      if (g?.ketuaId) out.push(g.ketuaId);
      return;
    }
    roster
      .filter((u) => {
        if (r === 'purchasing') return u.role === 'purchasing';
        if (r === 'sales') return u.role === 'sales' && up(u.se) === up(p.se);
        return u.role === r && up(u.cabang) === up(p.cabang);
      })
      .forEach((u) => out.push(u.id));
  });
  return Array.from(new Set(out)).slice(0, 4);
}

export function issueAgeText(i: PipelineIssue, today = localToday()): string {
  if (i.status === 'selesai') return 'selesai';
  const d = daysSince(i.dilaporAt || i.createdAt, today);
  return d ? `${d} hari` : 'baru';
}

/** Badge ⚑ di kartu/tabel prospek bila ada masalah aktif. */
export function IssueBadge({ prospectId, compact }: { prospectId: string; compact?: boolean }) {
  const issue = useDataStore((s) => s.issues.find((i) => i.prospectId === prospectId && isActiveIssue(i)));
  if (!issue) return null;
  const usulan = issue.status === 'usulan';
  const text = usulan ? 'Diajukan ke BM' : `${compact ? '' : `${issueCatLabel(issue.kategori)} · `}${issueAgeText(issue)}`;
  return (
    <span className={`badge ${usulan ? 'violet' : 'rust'} issue-badge`} title={`Masalah: ${issueCatLabel(issue.kategori)} — ${ISSUE_STATUS_META[issue.status].label}. ${issue.keterangan}`}>
      ⚑ {text}
    </span>
  );
}

function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** PJ: chip user + tambah user dari daftar; PJ pertama = utama. */
export function PjPicker({ value, onChange, roster, suggested, disabled }: { value: string[]; onChange: (v: string[]) => void; roster: RosterUser[]; suggested: string[]; disabled?: boolean }) {
  return (
    <div className="issue-pj">
      <div className="issue-pj-chips">
        {value.length === 0 && <span className="field-note" style={{ margin: 0 }}>Belum ada penanggung jawab.</span>}
        {value.map((id, i) => {
          const u = roster.find((x) => x.id === id);
          return (
            <span key={id} className="kam-chip">
              {u ? u.name : '(user)'}
              <span className="issue-pj-role">{u ? `${ROLE_LABELS[u.role] || u.role}${u.cabang ? ` ${u.cabang}` : ''}` : ''}</span>
              {i === 0 ? <span className="badge steel issue-pj-tag">utama</span> : suggested.includes(id) ? <span className="badge amber issue-pj-tag">usulan</span> : null}
              {!disabled && (
                <button type="button" aria-label={`Hapus ${u?.name || ''}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!disabled && (
        <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">+ Tambah penanggung jawab (pilih user)…</option>
          {roster.filter((u) => !value.includes(u.id) && u.role !== 'admin').map((u) => (
            <option key={u.id} value={u.id}>{userLabel(u)}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * Form masalah:
 *  - "lapor"  : BM membuat laporan resmi (PJ wajib);
 *  - "usulan" : Sales mengajukan ke BM (tanpa PJ);
 *  - "terima" : BM memproses usulan Sales (isi PJ lalu Buat laporan, atau Tolak).
 */
export function IssueForm({ mode, prospect, issue, kategoriAwal, saran, onDone, onCancel }: {
  mode: 'lapor' | 'usulan' | 'terima';
  prospect: Prospect;
  issue?: PipelineIssue | null;
  kategoriAwal?: string;
  saran?: string | null;
  onDone: (i: PipelineIssue) => void;
  onCancel: () => void;
}) {
  const roster = useRoster();
  const groups = useDataStore((s) => s.customerGroups);
  const toast = useDataStore((s) => s.toast);
  const [kategori, setKategori] = useState(issue?.kategori || kategoriAwal || 'harga');
  const [urgensi, setUrgensi] = useState(issue?.urgensi || 'sedang');
  const [keterangan, setKeterangan] = useState(issue?.keterangan || '');
  const [targetDate, setTargetDate] = useState(issue?.targetDate || plusDays(3));
  const [sug, setSug] = useState<string[]>([]);
  const [pjIds, setPjIds] = useState<string[]>([]);
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const withPj = mode !== 'usulan';

  // Usulan PJ awal setelah daftar user termuat.
  const [seeded, setSeeded] = useState(false);
  if (withPj && !seeded && roster.length) {
    const s = suggestPjIds(kategori, prospect, roster, groups);
    setSug(s);
    setPjIds(s);
    setSeeded(true);
  }

  function pickKategori(k: string) {
    setKategori(k);
    if (!withPj) return;
    const manual = pjIds.filter((id) => !sug.includes(id));
    const s = suggestPjIds(k, prospect, roster, groups);
    setSug(s);
    setPjIds([...s, ...manual.filter((id) => !s.includes(id))]);
  }

  async function submit() {
    setBusy(true);
    try {
      const body = { kategori, urgensi, keterangan, targetDate, pjIds };
      const r =
        mode === 'terima' && issue
          ? await api.put<{ issue: PipelineIssue }>(`/api/pipeline-issues/${issue.id}`, { action: 'terima', ...body })
          : await api.post<{ issue: PipelineIssue }>('/api/pipeline-issues', { mode, prospectId: prospect.id, saran: saran || undefined, ...body });
      useDataStore.getState().upsertIssue(r.issue);
      toast(mode === 'usulan' ? 'Masalah diajukan ke BM' : 'Masalah dilaporkan — penanggung jawab diberi tahu', 'success');
      onDone(r.issue);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!issue) return;
    setBusy(true);
    try {
      const r = await api.put<{ issue: PipelineIssue }>(`/api/pipeline-issues/${issue.id}`, { action: 'tolak', alasan });
      useDataStore.getState().upsertIssue(r.issue);
      toast('Usulan ditolak — Sales diberi tahu', 'success');
      onDone(r.issue);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menolak', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="issue-form">
      <div className="issue-form-head">
        <b>{mode === 'usulan' ? '⚑ Ajukan masalah ke BM' : mode === 'terima' ? `⚑ Proses usulan dari ${issue?.diajukanNama || 'Sales'}` : '⚑ Laporkan masalah'}</b>
        <span className="field-note" style={{ margin: 0 }}>
          {prospect.customer} · <span className="mono">{formatRupiah(Number(prospect.value) || 0)}</span> · {prospect.se || '-'} {prospect.cabang || ''}
        </span>
      </div>
      <label>Kategori masalah *</label>
      <div className="sa-pills">
        {ISSUE_CATS.map((c) => (
          <button key={c.key} type="button" className={kategori === c.key ? 'on' : ''} aria-pressed={kategori === c.key} onClick={() => pickKategori(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      {withPj && (
        <>
          <label>Penanggung jawab * · {pjIds.length} orang</label>
          <PjPicker value={pjIds} onChange={setPjIds} roster={roster} suggested={sug} />
          <div className="field-note" style={{ margin: 0 }}>Usulan otomatis dari kategori — boleh dihapus atau ditambah user lain. Semua PJ mendapat notifikasi & ikut diskusi kartu; yang pertama = PJ utama.</div>
        </>
      )}
      <div className="form-grid" style={{ marginTop: 6 }}>
        <div>
          <label>Urgensi</label>
          <div className="sa-pills">
            {URGENSI.map((u) => (
              <button key={u.key} type="button" className={urgensi === u.key ? 'on' : ''} aria-pressed={urgensi === u.key} onClick={() => setUrgensi(u.key)}>
                {u.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label>Target selesai</label>
          <input type="date" value={targetDate || ''} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      </div>
      <label>Keterangan *</label>
      <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="cth. Customer minta harga ≤ 105rb/kg seperti repeat order lalu; harga baru 118rb/kg." rows={3} />
      <div className="field-note" style={{ margin: 0 }}>
        {mode === 'usulan' ? 'BM akan menerima notifikasi dan membuat laporan resmi (menentukan penanggung jawab).' : 'Belum ditangani 2 hari → notifikasi ke BM; belum selesai 4 hari → RM & GM. Lampiran: unggah di bagian Lampiran prospek.'}
      </div>
      {mode === 'terima' && (
        <div className="issue-reject">
          <input type="text" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan bila usulan ditolak…" />
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || alasan.trim().length < 5} onClick={reject}>
            Tolak usulan
          </button>
        </div>
      )}
      <div className="issue-form-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel} disabled={busy}>
          Batal
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {mode === 'usulan' ? 'Ajukan ke BM' : 'Laporkan masalah'}
        </button>
      </div>
    </div>
  );
}

/** Panel detail masalah: ringkasan prospek (baca), dokumen terkait, laporan, diskusi kartu, tindak lanjut. */
export function IssueDetail({ issue }: { issue: PipelineIssue }) {
  const roster = useRoster();
  const me = useDataStore((s) => s.currentUser);
  const prospect = useDataStore((s) => s.prospects.find((p) => p.id === issue.prospectId)) || null;
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const toast = useDataStore((s) => s.toast);
  const [solusi, setSolusi] = useState('');
  const [hasil, setHasil] = useState<IssueHasil>('deal');
  const [editPj, setEditPj] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [terima, setTerima] = useState(false);
  const canE = useCan('masalah', 'e');

  const docs = useMemo(
    () => [
      ...rfqs.filter((r) => r.prospectId === issue.prospectId).map((r) => ({ kind: 'RFQ' as const, id: r.id, no: r.noRfq || 'RFQ' })),
      ...fupas.filter((f) => f.prospectId === issue.prospectId).map((f) => ({ kind: 'FUPA' as const, id: f.id, no: f.noFupa || 'FUP A' })),
    ],
    [rfqs, fupas, issue.prospectId],
  );
  const isBm = !!me && (me.role === 'admin' || (me.role === 'bm' && up(me.cabang) === up(issue.cabang)));
  const isPj = !!me && issue.pjIds.includes(me.id);
  const canHandle = canE && (isPj || isBm);
  const st = ISSUE_STATUS_META[issue.status];

  async function act(action: string, extra: Record<string, unknown> = {}, ok = 'Tersimpan') {
    setBusy(true);
    try {
      const r = await api.put<{ issue: PipelineIssue }>(`/api/pipeline-issues/${issue.id}`, { action, ...extra });
      useDataStore.getState().upsertIssue(r.issue);
      toast(ok, 'success');
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="issue-detail">
      <div className="issue-card">
        <div className="issue-detail-head">
          <div>
            <div className="kam-title" style={{ fontSize: 22 }}>{issue.customer}</div>
            <div className="field-note" style={{ margin: 0 }}>Prospek · hanya baca{prospect?.uraian ? ` · ${prospect.uraian}` : ''}</div>
          </div>
          <span className={`badge ${st.badge}`}>{st.label}</span>
        </div>
        <div className="issue-facts">
          <div><span className="kam-role">NILAI PROSPEK</span><b className="mono">{prospect ? formatRupiah(Number(prospect.value) || 0) : '-'}</b></div>
          <div><span className="kam-role">TAHAP</span><b>{prospect ? stageLabel(prospect.status) : '-'}</b></div>
          <div><span className="kam-role">SALES · CABANG</span><b>{issue.se || '-'} · {issue.cabang || '-'}</b></div>
          <div><span className="kam-role">TARGET SELESAI</span><b>{issue.targetDate || '-'}</b></div>
        </div>
        <div className="issue-docs">
          <span className="kam-role">DOKUMEN TERKAIT</span>
          {docs.length === 0 ? (
            <span className="field-note" style={{ margin: 0 }}>— belum ada RFQ / FUP A</span>
          ) : (
            docs.map((d) => (
              <button key={d.id} type="button" className="issue-doc" onClick={() => openPurchDoc(d.kind, d.id)}>
                {d.no} ↗
              </button>
            ))
          )}
        </div>
        <div className="issue-report">
          <div>
            <b>⚑ {issueCatLabel(issue.kategori)}</b> <span className={`badge ${URGENSI.find((u) => u.key === issue.urgensi)?.badge || 'slate'}`}>{urgensiLabel(issue.urgensi)}</span>{' '}
            <span className="field-note" style={{ margin: 0, display: 'inline' }}>
              {issue.status === 'usulan' ? `diajukan ${issue.diajukanNama || '-'}` : `dilaporkan ${issue.dilaporNama || '-'}${issue.diajukanNama ? ` (usulan ${issue.diajukanNama})` : ''}`} · {issueAgeText(issue)}
              {issue.eskalasi ? ` · ↑ dieskalasi ${issue.eskalasi >= 2 ? 'RM & GM' : 'BM'}` : ''}
            </span>
          </div>
          <div style={{ marginTop: 3 }}>{issue.keterangan}</div>
          {issue.pjIds.length > 0 && <div className="field-note" style={{ margin: '4px 0 0' }}>Penanggung jawab: {issue.pjIds.map((id, i) => `${nameOf(roster, id)}${i === 0 ? ' (utama)' : ''}`).join(', ')}</div>}
          {issue.status === 'ditolak' && <div className="field-note" style={{ margin: '4px 0 0' }}>Ditolak: {issue.alasanTolak}</div>}
          {issue.status === 'selesai' && <div className="issue-done">✓ {issue.solusi} · {issue.hasil ? HASIL_META[issue.hasil] : ''} ({issue.selesaiNama})</div>}
        </div>
      </div>

      <div className="issue-card">
        <div className="issue-detail-head" style={{ marginBottom: 6 }}>
          <b>Diskusi</b>
          <span className="field-note" style={{ margin: 0 }}>thread yang sama dengan Diskusi di kartu prospek</span>
        </div>
        <ItemChat entity="prospect" entityId={issue.prospectId} />
      </div>

      {issue.status === 'usulan' && isBm && canE && (
        <div className="issue-card">
          {terima && prospect ? (
            <IssueForm mode="terima" prospect={prospect} issue={issue} onDone={() => setTerima(false)} onCancel={() => setTerima(false)} />
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setTerima(true)} disabled={!prospect}>
              Proses usulan (tentukan PJ / tolak)
            </button>
          )}
        </div>
      )}

      {(issue.status === 'open' || issue.status === 'proses') && (
        <div className="issue-card issue-actions">
          <b>Tindak lanjut</b>
          {canHandle ? (
            <>
              {issue.status === 'open' && (
                <div className="issue-row">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act('tangani', {}, 'Status → Ditangani')}>
                    Tangani
                  </button>
                  <span className="field-note" style={{ margin: 0 }}>Status → Ditangani; Sales, BM & PJ lain diberi tahu.</span>
                </div>
              )}
              <label>Solusi *</label>
              <textarea rows={2} value={solusi} onChange={(e) => setSolusi(e.target.value)} placeholder="cth. Stok plate 6 mm tersedia di vendor — kirim 10 hari, harga sudah dikirim di RFQ." />
              <div className="issue-row">
                <span className="kam-role">HASIL</span>
                <div className="sa-pills">
                  {(Object.keys(HASIL_META) as IssueHasil[]).map((h) => (
                    <button key={h} type="button" className={hasil === h ? 'on' : ''} aria-pressed={hasil === h} onClick={() => setHasil(h)}>
                      {HASIL_META[h]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginLeft: 'auto' }}
                  disabled={busy || solusi.trim().length < 5}
                  onClick={async () => {
                    if (await act('selesai', { solusi, hasil }, 'Masalah ditandai selesai')) setSolusi('');
                  }}
                >
                  Tandai Selesai
                </button>
              </div>
            </>
          ) : (
            <span className="field-note" style={{ margin: 0 }}>Ditangani oleh penanggung jawab. Anda bisa ikut berdiskusi di atas.</span>
          )}
          {isBm && canE && (
            <div style={{ marginTop: 8 }}>
              {editPj ? (
                <>
                  <label>Ubah penanggung jawab</label>
                  <PjPicker value={editPj} onChange={setEditPj} roster={roster} suggested={[]} />
                  <div className="issue-row">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditPj(null)}>Batal</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy || !editPj.length} onClick={async () => { if (await act('ubah', { pjIds: editPj }, 'Penanggung jawab diperbarui')) setEditPj(null); }}>
                      Simpan PJ
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditPj(issue.pjIds)}>Ubah penanggung jawab</button>
              )}
            </div>
          )}
          <span className="field-note" style={{ margin: 0 }}>Penanggung jawab hanya mengubah status masalah & berdiskusi — data prospek tetap milik Sales.</span>
        </div>
      )}
    </div>
  );
}

export const stageLabel = (s: number | string) => STATUS_META[Number(s)]?.label || String(s);
