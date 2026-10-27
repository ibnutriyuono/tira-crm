'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CABANG_LIST } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { validEmail } from '@/lib/notif-prefs';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { SafeUser } from '@/lib/types';

import { useT } from '@/store/useLangStore';
export function UserFormModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'userForm';
  const userEditId = useUiStore((s) => s.userEditId);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const users = useDataStore((s) => s.users);
  const records = useDataStore((s) => s.prospects);
  const upsertUser = useDataStore((s) => s.upsertUser);
  const toast = useDataStore((s) => s.toast);

  const editing = userEditId ? users.find((u) => u.id === userEditId) || null : null;

  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('sales');
  const [reg, setReg] = useState('');
  const [se, setSe] = useState('');
  const [cabang, setCabang] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // Role tambahan dari Kelola Role (nilai "custom:<key>").
  const [customRoles, setCustomRoles] = useState<{ key: string; label: string; base: string }[]>([]);
  useEffect(() => {
    if (!show) return;
    let alive = true;
    api
      .get<{ roles?: { key: string; label: string; base: string; builtin: boolean }[] }>('/api/roles')
      .then((r) => alive && setCustomRoles((r.roles || []).filter((x) => !x.builtin)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);
  const baseOf = (r: string) => (r.startsWith('custom:') ? customRoles.find((x) => x.key === r.slice(7))?.base || '' : r);

  useEffect(() => {
    if (!show) return;
    if (editing) {
      setUsername(editing.username);
      setName(editing.name);
      setRole(editing.customRole ? `custom:${editing.customRole}` : editing.role);
      setReg(editing.reg ? String(editing.reg) : '');
      setSe(editing.se || '');
      setCabang(editing.cabang || '');
      setEmail(editing.email || '');
    } else {
      setUsername('');
      setName('');
      setRole('sales');
      setReg('');
      setSe('');
      setCabang('');
      setEmail('');
    }
    setPassword('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, userEditId]);

  const cabangOptions = useMemo(() => Array.from(new Set([...CABANG_LIST, ...records.map((r) => r.cabang).filter(Boolean)])) as string[], [records]);

  async function onSubmit() {
    const uname = username.trim().toLowerCase();
    const nm = name.trim();
    if (!uname || !nm) return toast('Username dan nama wajib diisi', 'error');
    if (!userEditId && (!password || password.length < 4)) return toast('Password wajib diisi (minimal 4 karakter)', 'error');
    if (password && password.length < 4) return toast('Password minimal 4 karakter', 'error');
    if (baseOf(role) === 'salesadmin' && !cabang.trim()) return toast('Admin Sales wajib diisi Cabang', 'error');

    setBusy(true);
    if (email.trim() && !validEmail(email.trim())) return toast('Format email tidak valid', 'error');
    const payload = { username: uname, name: nm, role, reg: reg || null, se: se.trim().toUpperCase(), cabang: cabang.trim().toUpperCase(), email: email.trim().toLowerCase(), password: password || undefined };
    try {
      const { user } = userEditId ? await api.put<{ user: SafeUser }>(`/api/users/${userEditId}`, payload) : await api.post<{ user: SafeUser }>('/api/users', payload);
      upsertUser(user);
      closeModal();
      openModal('users');
      toast('Data user disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan user', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={() => {
        closeModal();
        openModal('users');
      }}
      title={userEditId ? tr("Edit User") : tr("Tambah User")}
      onSubmit={onSubmit}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              closeModal();
              openModal('users');
            }}
          >
            {tr("Batal")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {tr("Simpan User")}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>{tr("Username")}</label>
          <input type="text" required readOnly={!!userEditId} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label>{tr("Nama Lengkap")}</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>{tr("Role")}</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="sales">{tr("Sales")}</option>
            <option value="bm">{tr("BM (Branch Manager)")}</option>
            <option value="salesadmin">{tr("Admin Sales (satu cabang)")}</option>
            <option value="rm">{tr("RM (Regional Manager)")}</option>
            <option value="gm">{tr("GM (General Manager)")}</option>
            <option value="gmops">{tr("GM Operation (Purchasing, IPC, gudang)")}</option>
            <option value="vp">{tr("VP (seluruh divisi)")}</option>
            <option value="purchasing">{tr("Purchasing")}</option>
            <option value="purchasing05">{tr("PIC Line 05 (Purchasing fabrikasi)")}</option>
            <option value="admin">{tr("Admin")}</option>
            {customRoles.length > 0 && (
              <optgroup label={tr("Role tambahan (Kelola Role)")}>
                {customRoles.map((r) => (
                  <option key={r.key} value={`custom:${r.key}`}>
                    {r.label} {tr("— tipe dasar")} {r.base}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label>{tr("Regional")}</label>
          <select value={reg} onChange={(e) => setReg(e.target.value)}>
            <option value="">{tr("- (Tidak berlaku)")}</option>
            <option value="1">{tr("Regional 1")}</option>
            <option value="2">{tr("Regional 2")}</option>
            <option value="3">{tr("Regional 3")}</option>
          </select>
        </div>
        <div>
          <label>{tr("Kode SE")}</label>
          <input type="text" value={se} onChange={(e) => setSe(e.target.value)} placeholder={tr("cth. TD (untuk role Sales)")} />
        </div>
        <div>
          <label>{tr("Cabang")}</label>
          <input list="cabangList2" value={cabang} onChange={(e) => setCabang(e.target.value)} />
          <datalist id="cabangList2">
            {cabangOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label>
            {tr("Password")} <span style={{ textTransform: 'none', fontWeight: 400 }}>{userEditId ? tr("(kosongkan jika tidak diubah)") : ''}</span>
          </label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("Minimal 4 karakter")} />
        </div>
        <div className="full">
          <label>
            {tr("Email")} <span style={{ textTransform: 'none', fontWeight: 400 }}>{tr("(untuk notifikasi — opsional)")}</span>
          </label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr("nama@perusahaan.co.id")} />
          <div className="field-note">{tr("Kosongkan bila user tidak ingin menerima email. User juga bisa mengisi email sendiri di Notifikasi › Pengaturan.")}</div>
        </div>
      </div>
      <div className="import-summary" style={{ marginTop: 14 }}>
        {tr("Cakupan data per role:")} <b>{tr("Sales")}</b> {tr("— isi Kode SE (hanya melihat prospek miliknya).")} <b>BM</b> {tr("— isi Cabang (melihat semua sales di cabangnya).")} <b>{tr("Admin Sales")}</b> {tr("— wajib isi Cabang (satu cabang): melihat data cabangnya, mengisi prospek/PO/DO, RFQ/FUP A dan customer atas nama Sales, serta menandai DO terfaktur (tanggal & no faktur); tidak mengubah target, rencana, aktivitas, perjalanan dinas, maupun user.")} <b>RM</b> {tr("— isi Regional (melihat semua cabang di regionalnya).")} <b>{tr("Purchasing")}</b> {tr("— melihat seluruh prospek dan RFQ/FUP A, serta mengelola vendor dan penawaran.")} <b>{tr("PIC Line 05")}</b> {tr("— membuka UI Purchasing, tetapi hanya melihat dan mengerjakan RFQ/FUP A yang berisi material Line 05 (fabrikasi); tidak melihat prospek.")} <b>GM</b> {tr("&")} <b>{tr("Admin")}</b> {tr("— melihat seluruh data, field lain tidak perlu diisi.")}
      </div>
    </Modal>
  );
}
