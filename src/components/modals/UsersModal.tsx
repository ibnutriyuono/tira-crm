'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { Modal } from '../Modal';
import { IconEdit, IconTrash } from '../icons';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

import { useT } from '@/store/useLangStore';
const ROLE_META: Record<string, (u: { reg: number | null; cabang: string | null; se: string | null }) => { label: string; color: string }> = {
  admin: () => ({ label: 'Admin', color: 'amber' }),
  vp: () => ({ label: 'VP', color: 'rust' }),
  gm: () => ({ label: 'GM', color: 'rust' }),
  gmops: () => ({ label: 'GM Operation', color: 'rust' }),
  marketing: () => ({ label: 'Product & Marketing', color: 'violet' }),
  rm: (u) => ({ label: `RM · Regional ${u.reg ?? '-'}`, color: 'steel' }),
  bm: (u) => ({ label: `BM · ${u.cabang || '-'}`, color: 'green' }),
  salesadmin: (u) => ({ label: `Admin Sales · ${u.cabang || '-'}`, color: 'violet' }),
  sales: (u) => ({ label: `Sales · ${u.se || '-'}`, color: 'slate' }),
};

export function UsersModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'users';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const users = useDataStore((s) => s.users);
  const currentUser = useDataStore((s) => s.currentUser);
  const loadUsers = useDataStore((s) => s.loadUsers);

  useEffect(() => {
    if (show) loadUsers();
  }, [show, loadUsers]);
  // Nama role tambahan (Kelola Role) untuk badge.
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!show) return;
    let alive = true;
    api
      .get<{ roles?: { key: string; label: string }[] }>('/api/roles')
      .then((r) => alive && setRoleLabels(Object.fromEntries((r.roles || []).map((x) => [x.key, x.label]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);

  // Reset password: password sementara tampil sekali di sini.
  const [resetInfo, setResetInfo] = useState<{ name: string; username: string; password: string } | null>(null);
  const [busyReset, setBusyReset] = useState('');
  // Riwayat perubahan akun (Log Aktivitas entitas User).
  const [history, setHistory] = useState<{ id: string; createdAt: string; actorName: string; summary: string }[]>([]);
  const loadHistory = () =>
    api
      .get<{ logs?: { id: string; createdAt: string; actorName: string; summary: string }[] }>('/api/activity?entity=user&pageSize=15')
      .then((r) => setHistory(r.logs || []))
      .catch(() => {});
  useEffect(() => {
    if (show) loadHistory();
    else setResetInfo(null);
  }, [show]);

  // Jeda akun: tidak bisa login, akun & data tetap.
  const [busyPause, setBusyPause] = useState('');
  const [statusFilter, setStatusFilter] = useState<'semua' | 'aktif' | 'dijeda'>('semua');
  const pausedCount = users.filter((u) => u.pausedAt).length;
  const shown = users.filter((u) => (statusFilter === 'semua' ? true : statusFilter === 'dijeda' ? !!u.pausedAt : !u.pausedAt));

  async function togglePause(u: { id: string; name: string; username: string; role: string; pausedAt?: string | null }) {
    const pause = !u.pausedAt;
    let reason = '';
    if (pause) {
      if (currentUser && u.id === currentUser.id) {
        useDataStore.getState().toast('Tidak dapat menjeda akun yang sedang login.', 'error');
        return;
      }
      const r = window.prompt(
        `Jeda akun ${u.name} (${u.username})?\n\nUser tidak bisa login dan sesi yang sedang terbuka langsung keluar. Akun, prospek, customer dan riwayatnya tetap ada — bisa diaktifkan lagi kapan saja.\n\nAlasan (opsional, hanya terlihat Admin):`,
        '',
      );
      if (r === null) return;
      reason = r;
    } else if (!window.confirm(`Aktifkan kembali akun ${u.name} (${u.username})? User bisa login lagi dengan password yang sama.`)) {
      return;
    }
    setBusyPause(u.id);
    try {
      const res = await api.post<{ user: (typeof users)[number] }>(`/api/users/${u.id}/pause`, { paused: pause, reason });
      useDataStore.getState().upsertUser(res.user);
      useDataStore.getState().toast(pause ? `Akun ${u.name} dijeda` : `Akun ${u.name} aktif kembali`, 'success');
      loadHistory();
    } catch (err) {
      useDataStore.getState().toast(err instanceof Error ? err.message : 'Gagal mengubah status akun', 'error');
    } finally {
      setBusyPause('');
    }
  }

  async function resetPassword(u: { id: string; name: string; username: string }) {
    if (!window.confirm(`Reset password ${u.name} (${u.username})? Password lama tidak berlaku lagi.`)) return;
    setBusyReset(u.id);
    try {
      const r = await api.post<{ password: string; username: string; name: string }>(`/api/users/${u.id}/reset-password`, {});
      setResetInfo(r);
      loadHistory();
    } catch (err) {
      useDataStore.getState().toast(err instanceof Error ? err.message : 'Gagal reset password', 'error');
    } finally {
      setBusyReset('');
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr("Kelola User")}
      xwide stickyHead
      footer={
        <>
        <button type="button" className="btn btn-outline" style={{ marginRight: 'auto' }} onClick={() => openModal('roles')}>
          {tr("Kelola Role")}
        </button>
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          {tr("Tutup")}
        </button>
        </>
      }
    >
      <button
        className="btn btn-primary btn-sm"
        style={{ marginBottom: 14 }}
        onClick={() => {
          useUiStore.setState({ userEditId: null });
          openModal('userForm');
        }}
      >
        {tr("+ Tambah User")}
      </button>
      <span className="users-status-filter">
        {(['semua', 'aktif', 'dijeda'] as const).map((k) => (
          <button key={k} type="button" className={`btn btn-sm ${statusFilter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatusFilter(k)}>
            {k === 'semua' ? `${tr('Semua')} (${users.length})` : k === 'aktif' ? `${tr('Aktif')} (${users.length - pausedCount})` : `${tr('Dijeda')} (${pausedCount})`}
          </button>
        ))}
      </span>
      {resetInfo && (
        <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 14 }}>
          <b>{tr("Password sementara untuk")} {resetInfo.name} ({resetInfo.username}):</b>{' '}
          <span className="mono" style={{ fontSize: 16, letterSpacing: 1.5, padding: '2px 10px', border: '1px dashed currentColor', borderRadius: 5, marginLeft: 6 }}>{resetInfo.password}</span>{' '}
          <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 6 }} onClick={() => navigator.clipboard?.writeText(resetInfo.password).then(() => useDataStore.getState().toast('Password disalin', 'success'))}>
            {tr("Salin")}
          </button>{' '}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setResetInfo(null)}>
            {tr("Tutup")}
          </button>
          <div className="field-note" style={{ margin: '4px 0 0' }}>{tr("Hanya tampil sekali. Sampaikan ke user — saat login user wajib membuat password baru. Password user tidak bisa dilihat siapa pun, termasuk Admin.")}</div>
        </div>
      )}
      <table className="simple-table">
        <thead>
          <tr>
            <th>{tr("Username")}</th>
            <th>{tr("Nama")}</th>
            <th>{tr("Role")}</th>
            <th>{tr("Regional")}</th>
            <th>SE</th>
            <th>{tr("Cabang")}</th>
            <th>{tr("Status")}</th>
            <th>{tr("Aksi")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={8} className="field-note">{tr("Tidak ada user.")}</td>
            </tr>
          )}
          {shown.map((u) => {
            const baseMeta = (ROLE_META[u.role] || (() => ({ label: u.role, color: 'slate' })))(u);
            const meta = u.customRole ? { label: `${roleLabels[u.customRole] || u.customRole}${u.cabang ? ` · ${u.cabang}` : ''}`, color: 'pink' } : baseMeta;
            return (
              <tr key={u.id} className={u.pausedAt ? 'user-paused' : undefined}>
                <td className="mono">{u.username}</td>
                <td>
                  {u.name}
                  {u.email && <div className="field-note" style={{ margin: 0 }}>{u.email}</div>}
                </td>
                <td>
                  <span className={`badge ${meta.color}`}>{meta.label}</span>
                </td>
                <td>{u.reg ? `Regional ${u.reg}` : '-'}</td>
                <td>{u.se || '-'}</td>
                <td>{u.cabang || '-'}</td>
                <td>
                  {u.pausedAt ? (
                    <>
                      <span className="badge amber">{tr("Dijeda")}</span>
                      <div className="field-note" style={{ margin: '2px 0 0' }}>
                        {new Date(u.pausedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {u.pausedBy ? ` · ${u.pausedBy}` : ''}
                        {u.pausedReason ? <><br />{u.pausedReason}</> : null}
                      </div>
                    </>
                  ) : (
                    <span className="badge green">{tr("Aktif")}</span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-btn"
                      onClick={() => {
                        useUiStore.setState({ userEditId: u.id });
                        openModal('userForm');
                      }}
                    >
                      <IconEdit />
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" disabled={busyReset === u.id} onClick={() => resetPassword(u)} title={tr("Buat password sementara untuk user ini")}>
                      {tr("Reset password")}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${u.pausedAt ? 'btn-primary' : 'btn-outline'}`}
                      disabled={busyPause === u.id || (!u.pausedAt && currentUser?.id === u.id)}
                      onClick={() => togglePause(u)}
                      title={u.pausedAt ? tr('Izinkan user ini login kembali') : tr('User tidak bisa login, akun & data tetap ada')}
                    >
                      {u.pausedAt ? tr('Aktifkan') : tr('Jeda')}
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => {
                        if (currentUser && u.id === currentUser.id) {
                          useDataStore.getState().toast('Tidak dapat menghapus akun yang sedang login.', 'error');
                          return;
                        }
                        if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1) {
                          useDataStore.getState().toast('Tidak dapat menghapus admin terakhir.', 'error');
                          return;
                        }
                        useUiStore.setState({ deleteCtx: { mode: 'user', id: u.id, title: 'Hapus User', message: `Yakin ingin menghapus user "${u.username}" (${u.name})? Bila hanya ingin menutup aksesnya (mis. cuti panjang / keluar), pakai Jeda — akun & riwayatnya tetap ada.` } });
                        openModal('delete');
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4 style={{ margin: '18px 0 6px' }}>{tr("Riwayat perubahan akun & user")}</h4>
      <div className="field-note" style={{ marginTop: 0 }}>{tr("Termasuk perubahan username/password/email yang dilakukan user sendiri lewat Akun Saya. Riwayat lengkap di Log Aktivitas.")}</div>
      <table className="simple-table">
        <thead>
          <tr>
            <th style={{ width: 160 }}>{tr("Waktu")}</th>
            <th style={{ width: 200 }}>{tr("Oleh")}</th>
            <th>{tr("Perubahan")}</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 && (
            <tr>
              <td colSpan={3} className="field-note">{tr("Belum ada riwayat.")}</td>
            </tr>
          )}
          {history.map((h) => (
            <tr key={h.id}>
              <td className="mono">{new Date(h.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{h.actorName}</td>
              <td>{h.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
