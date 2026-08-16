'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CABANG_LIST } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { SafeUser } from '@/lib/types';

export function UserFormModal() {
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (editing) {
      setUsername(editing.username);
      setName(editing.name);
      setRole(editing.role);
      setReg(editing.reg ? String(editing.reg) : '');
      setSe(editing.se || '');
      setCabang(editing.cabang || '');
    } else {
      setUsername('');
      setName('');
      setRole('sales');
      setReg('');
      setSe('');
      setCabang('');
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

    setBusy(true);
    const payload = { username: uname, name: nm, role, reg: reg || null, se: se.trim().toUpperCase(), cabang: cabang.trim().toUpperCase(), password: password || undefined };
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
      title={userEditId ? 'Edit User' : 'Tambah User'}
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
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Simpan User
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div>
          <label>Username</label>
          <input type="text" required readOnly={!!userEditId} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label>Nama Lengkap</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="sales">Sales</option>
            <option value="bm">BM (Branch Manager)</option>
            <option value="rm">RM (Regional Manager)</option>
            <option value="gm">GM (General Manager)</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label>Regional</label>
          <select value={reg} onChange={(e) => setReg(e.target.value)}>
            <option value="">- (Tidak berlaku)</option>
            <option value="1">Regional 1</option>
            <option value="2">Regional 2</option>
            <option value="3">Regional 3</option>
          </select>
        </div>
        <div>
          <label>Kode SE</label>
          <input type="text" value={se} onChange={(e) => setSe(e.target.value)} placeholder="cth. TD (untuk role Sales)" />
        </div>
        <div>
          <label>Cabang</label>
          <input list="cabangList2" value={cabang} onChange={(e) => setCabang(e.target.value)} />
          <datalist id="cabangList2">
            {cabangOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label>
            Password <span style={{ textTransform: 'none', fontWeight: 400 }}>{userEditId ? '(kosongkan jika tidak diubah)' : ''}</span>
          </label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 4 karakter" />
        </div>
      </div>
      <div className="import-summary" style={{ marginTop: 14 }}>
        Cakupan data per role: <b>Sales</b> — isi Kode SE (hanya melihat prospek miliknya). <b>BM</b> — isi Cabang (melihat semua sales di cabangnya). <b>RM</b> — isi Regional (melihat semua cabang di regionalnya). <b>GM</b> &amp; <b>Admin</b> — melihat seluruh data, field lain tidak perlu diisi.
      </div>
    </Modal>
  );
}
