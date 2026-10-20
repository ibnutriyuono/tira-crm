'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { ACT_LABEL, BASE_ROLES, PERM_MODULES, clampPerms, limitReason, normalizePerms, permDiff, viewOnlyPerms, type PermAct, type Perms } from '@/lib/permissions';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

import { useT } from '@/store/useLangStore';
export interface RoleItem {
  key: string;
  label: string;
  base: string;
  builtin: boolean;
  locked: boolean;
  customized: boolean;
  perms: Perms;
  users: string[];
  updatedBy: string | null;
}

const ACTS: PermAct[] = ['v', 'e', 'd', 'x'];
const GROUPS = Array.from(new Set(PERM_MODULES.map((m) => m.group)));
const MENU: [string, string][] = [
  ['prospek', 'Pipeline'], ['aktivitas', 'Aktivitas'], ['rencana', 'Rencana Penjualan'], ['customer', 'Kelola Customer'], ['rfq', 'Kelola RFQ / FUP A'],
  ['kam', 'Key Account'], ['forecast', 'Forecast'], ['kpi', 'KPI'], ['analisa', 'Analisa Eksekutif'], ['marketing', 'Marketing · CI · QCD'],
  ['faktur', 'Antrian Admin'], ['trip', 'Perjalanan Dinas'], ['purch', 'Purchasing'], ['log', 'Log Aktivitas'],
];
const baseMeta = (k: string) => BASE_ROLES.find((b) => b.key === k);

/**
 * Kelola Role (khusus Admin): hak Lihat / Tambah-Ubah / Hapus / Download per
 * modul untuk role bawaan dan role tambahan. Hak hanya membatasi — aturan tipe
 * dasar (cakupan data, alur persetujuan) tetap berlaku.
 */
export function RolesModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'roles';
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState<Perms | null>(null);
  const [label, setLabel] = useState('');
  const [base, setBase] = useState('bm');
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newBase, setNewBase] = useState('bm');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (keep?: string) => {
    try {
      const r = await api.get<{ roles: RoleItem[] }>('/api/roles');
      setRoles(r.roles);
      const k = keep && r.roles.some((x) => x.key === keep) ? keep : r.roles[1]?.key || r.roles[0]?.key || '';
      const it = r.roles.find((x) => x.key === k);
      setSel(k);
      setDraft(it ? it.perms : null);
      setLabel(it?.label || '');
      setBase(it?.base || 'bm');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat role', 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (show) void load(sel || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the modal opens
  }, [show]);

  const role = roles.find((r) => r.key === sel) || null;
  const reference = useMemo(() => {
    if (!role) return null;
    if (role.builtin) return role.perms;
    return roles.find((r) => r.builtin && r.key === base)?.perms || null;
  }, [role, roles, base]);
  // Tipe dasar yang menentukan batas hak: key role bawaan, atau pilihan tipe dasar role tambahan.
  const limitBase = role ? (role.builtin ? role.key : base) : '';
  const dirty = !!role && !!draft && (permDiff(draft, role.perms) > 0 || (!role.builtin && (label !== role.label || base !== role.base)));
  const diffFromBase = role && draft && !role.builtin && reference ? permDiff(draft, reference) : 0;

  if (!show || currentUser?.role !== 'admin') return null;

  function pick(k: string) {
    if (dirty && !window.confirm('Perubahan pada role ini belum disimpan. Tinggalkan?')) return;
    const it = roles.find((x) => x.key === k);
    setSel(k);
    setDraft(it ? it.perms : null);
    setLabel(it?.label || '');
    setBase(it?.base || 'bm');
    setAdding(false);
  }

  function toggle(mod: string, act: PermAct) {
    if (!draft || role?.locked) return;
    const cur = draft[mod];
    const val = !cur[act];
    const next = { ...cur, [act]: val };
    if (act === 'v' && !val) Object.assign(next, { e: false, d: false, x: false });
    if (act !== 'v' && val) next.v = true;
    setDraft(clampPerms({ ...draft, [mod]: next }, limitBase));
  }

  async function save() {
    if (!role || !draft) return;
    setBusy(true);
    try {
      await api.put(`/api/roles/${role.key}`, role.builtin ? { perms: draft } : { perms: draft, label, base });
      toast(`Role "${role.builtin ? role.label : label}" disimpan — berlaku langsung untuk ${role.users.length} user`, 'success');
      await load(role.key);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan role', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function resetOrDelete() {
    if (!role) return;
    const msg = role.builtin
      ? `Kembalikan hak role "${role.label}" ke bawaan (semua hak yang tersedia untuk tipe dasarnya)?`
      : `Hapus role "${role.label}"?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.del(`/api/roles/${role.key}`);
      toast(role.builtin ? `Hak role "${role.label}" dikembalikan ke bawaan` : `Role "${role.label}" dihapus`, 'success');
      await load(role.builtin ? role.key : undefined);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const nm = newLabel.trim();
    if (!nm) return toast('Nama role wajib diisi', 'error');
    setBusy(true);
    try {
      const from = roles.find((r) => r.builtin && r.key === newBase)?.perms;
      const r = await api.post<{ role: { key: string } }>('/api/roles', { label: nm, base: newBase, perms: from || {} });
      toast(`Role "${nm}" dibuat — atur haknya lalu Simpan`, 'success');
      setAdding(false);
      setNewLabel('');
      await load(r.role.key);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat role', 'error');
    } finally {
      setBusy(false);
    }
  }

  const builtin = roles.filter((r) => r.builtin);
  const custom = roles.filter((r) => !r.builtin);
  const ListItem = ({ r }: { r: RoleItem }) => (
    <button type="button" className={`rl-item${r.key === sel ? ' on' : ''}`} onClick={() => pick(r.key)}>
      <span>
        <b>{r.label}</b>
        <small>{r.key === 'admin' ? tr("Semua data") : r.key === 'purchasing05' ? tr("Dokumen Line 05") : baseMeta(r.base)?.scope}</small>
      </span>
      <span className="rl-meta">
        <small>{r.users.length} {tr("user")}</small>
        <span className={`badge ${r.locked ? 'slate' : !r.builtin ? 'violet' : r.customized ? 'amber' : 'steel'}`}>{r.locked ? 'terkunci' : !r.builtin ? 'tambahan' : r.customized ? 'diubah' : 'bawaan'}</span>
      </span>
    </button>
  );

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr("Kelola Role")}
      xwide
      footer={
        <>
          {role && !role.locked && (
            <button type="button" className="btn btn-outline" style={{ marginRight: 'auto', color: role.builtin ? undefined : 'var(--rust-600)' }} disabled={busy || (role.builtin && !role.customized)} onClick={resetOrDelete}>
              {role.builtin ? tr("Kembalikan ke bawaan") : tr("Hapus role")}
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={() => { if (!dirty || window.confirm('Perubahan belum disimpan. Tutup?')) closeModal(); }}>
            {tr("Tutup")}
          </button>
          {role && !role.locked && (
            <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
              {busy ? tr("Menyimpan…") : tr("Simpan role")}
            </button>
          )}
        </>
      }
    >
      <div className="rl-grid">
        <div className="rl-list">
          {adding ? (
            <div className="rl-new">
              <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={tr("Nama role, cth. Supervisor Cabang")} autoFocus />
              <select value={newBase} onChange={(e) => setNewBase(e.target.value)} aria-label={tr("Tipe dasar")}>
                {BASE_ROLES.map((b) => <option key={b.key} value={b.key}>{tr("Tipe dasar:")} {b.label}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(false)}>{tr("Batal")}</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={create}>{tr("Buat")}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>{tr("+ Role baru")}</button>
          )}
          <div className="rl-cap">{tr("ROLE BAWAAN")}</div>
          {builtin.map((r) => <ListItem key={r.key} r={r} />)}
          <div className="rl-cap">{tr("ROLE TAMBAHAN")}</div>
          {custom.length === 0 && <div className="field-note" style={{ margin: 0 }}>{tr("Belum ada. Klik + Role baru.")}</div>}
          {custom.map((r) => <ListItem key={r.key} r={r} />)}
        </div>

        {role && draft && (
          <div className="rl-edit">
            <div className="rl-head">
              <label>
                {tr("Nama role")}
                {role.builtin ? <b>{role.label}</b> : <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />}
              </label>
              <label>
                {tr("Tipe dasar")}
                {role.builtin ? (
                  <b>{role.key === 'admin' ? tr("Admin") : baseMeta(role.base)?.label}</b>
                ) : (
                  <select value={base} onChange={(e) => { setBase(e.target.value); setDraft(clampPerms(draft, e.target.value)); }}>
                    {BASE_ROLES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                )}
              </label>
              <label>
                {tr("Cakupan data")}
                <span className="rl-scope">{role.key === 'admin' ? tr("Semua data") : role.key === 'purchasing05' ? tr("Dokumen Line 05 saja") : baseMeta(role.builtin ? role.base : base)?.scope}</span>
              </label>
              {!role.builtin && reference && <span className={`badge ${diffFromBase ? 'amber' : 'steel'}`} style={{ alignSelf: 'center' }}>{diffFromBase ? `${diffFromBase} beda dari ${baseMeta(base)?.label}` : `sama dengan ${baseMeta(base)?.label}`}</span>}
            </div>
            {role.locked ? (
              <div className="import-summary" style={{ marginTop: 0 }}><b>{tr("Role Admin terkunci")}</b> {tr("— selalu memiliki semua hak, termasuk Kelola User, Kelola Role dan Database.")}</div>
            ) : (
              <div className="field-note" style={{ marginTop: 0 }}>
                {baseMeta(role.builtin ? role.base : base)?.note} {tr("Centang = menu & tombol tampil dan berfungsi untuk role ini. Sel")} <span className="rl-x">✕</span> {tr("= tidak tersedia untuk tipe dasarnya (alasan di bawah nama modul).")}
              </div>
            )}

            {!role.locked && (
              <div className="toolbar-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft(clampPerms(viewOnlyPerms(draft), limitBase))}>{tr("Jadikan hanya-lihat")}</button>
                <select value="" onChange={(e) => { const r = roles.find((x) => x.key === e.target.value); if (r) setDraft(clampPerms(normalizePerms(r.perms), limitBase)); }} style={{ maxWidth: 220 }} aria-label={tr("Salin hak dari role lain")}>
                  <option value="">{tr("Salin hak dari…")}</option>
                  {roles.filter((r) => r.key !== role.key).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {dirty && <span className="badge amber" style={{ alignSelf: 'center' }}>{tr("Belum disimpan")}</span>}
              </div>
            )}

            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table rl-table">
                <thead>
                  <tr><th>{tr("Modul")}</th>{ACTS.map((a) => <th key={a} className="c">{ACT_LABEL[a]}</th>)}</tr>
                </thead>
                <tbody>
                  {GROUPS.map((g) => (
                    <FragmentRows key={g} group={g} base={role.locked ? '' : limitBase} draft={draft} saved={role.perms} locked={role.locked} toggle={toggle} />
                  ))}
                  <tr className="rl-group"><td colSpan={5}>SISTEM</td></tr>
                  <tr><td><b>{tr("Kelola User · Kelola Role · Database")}</b><small>{tr("selalu khusus Admin")}</small></td>{ACTS.map((a) => <td key={a} className="c"><span className="rl-lock">{tr("Admin")}</span></td>)}</tr>
                </tbody>
              </table>
            </div>

            <div className="rl-bottom">
              <div className="rl-box">
                <b>{tr("Menu yang tampil untuk")} {role.builtin ? role.label : label || tr("role ini")}</b>
                <div className="rl-chips">
                  {MENU.map(([k, l]) => (
                    <span key={k} className={`rl-chip ${draft[k]?.v ? 'on' : ''}`}>{l}{draft[k]?.v && draft[k]?.x ? ' ⤓' : ''}</span>
                  ))}
                </div>
                <small>{tr("Dicoret = tidak tampil · ⤓ = tombol download/export tersedia")}</small>
              </div>
              <div className="rl-box">
                <b>{tr("User dengan role ini (")}{role.users.length})</b>
                <div className="rl-users">{role.users.length ? role.users.slice(0, 12).join(', ') + (role.users.length > 12 ? `, … ${role.users.length - 12} lainnya` : '') : '—'}</div>
                <small>{tr("Ganti role user di Kelola User. Perubahan hak berlaku langsung, tanpa logout, dan tercatat di Log Aktivitas.")}</small>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function FragmentRows({ group, base, draft, saved, locked, toggle }: { group: string; base: string; draft: Perms; saved: Perms; locked: boolean; toggle: (m: string, a: PermAct) => void }) {
  return (
    <>
      <tr className="rl-group"><td colSpan={5}>{group}</td></tr>
      {PERM_MODULES.filter((m) => m.group === group).map((m) => {
        const why = Array.from(new Set(m.acts.map((a) => limitReason(base, m.key, a)).filter(Boolean)));
        return (
        <tr key={m.key} className={draft[m.key]?.v ? '' : 'rl-off'}>
          <td><b>{m.label}</b><small>{m.hint}</small>{why.map((w) => <small key={w} className="rl-why">✕ {w}</small>)}</td>
          {ACTS.map((a) => (
            <td key={a} className={`c${!locked && m.acts.includes(a) && draft[m.key]?.[a] !== saved[m.key]?.[a] ? ' rl-changed' : ''}`}>
              {!m.acts.includes(a) ? (
                <span className="rl-na">–</span>
              ) : limitReason(base, m.key, a) ? (
                <span className="rl-x" title={limitReason(base, m.key, a) || ''} aria-label={`${m.label} — ${ACT_LABEL[a]}: tidak tersedia`}>✕</span>
              ) : (
                <input type="checkbox" checked={!!draft[m.key]?.[a]} disabled={locked} onChange={() => toggle(m.key, a)} aria-label={`${m.label} — ${ACT_LABEL[a]}`} />
              )}
            </td>
          ))}
        </tr>
        );
      })}
    </>
  );
}
