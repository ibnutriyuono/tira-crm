'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { Modal } from '../Modal';
import { IconEdit, IconTrash } from '../icons';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

import { useT } from '@/store/useLangStore';
import { AUDIT_META, ORIGIN_LABEL, auditUsers, loginBucket, originOf, type AuditKey, type GroupBy, type UserAuditInfo } from '@/lib/user-audit';
import { cabangKey } from '@/lib/constants';
import { formatDateID } from '@/lib/format';

const ROLE_NAME: Record<string, string> = { admin: 'Admin', vp: 'VP', gm: 'GM', gmops: 'GM Operation', marketing: 'Product & Marketing', rm: 'RM', bm: 'BM', salesadmin: 'Admin Sales', sales: 'Sales', purchasing: 'Purchasing', purchasing05: 'PIC Line 05' };
const ROLE_ORDER = ['admin', 'vp', 'gmops', 'gm', 'rm', 'bm', 'salesadmin', 'sales', 'marketing', 'purchasing', 'purchasing05'];
const LEVEL_BADGE = { merah: 'rust', kuning: 'amber', info: 'slate' } as const;
function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'hari ini' : d === 1 ? 'kemarin' : d < 60 ? `${d} hari lalu` : formatDateID(iso.slice(0, 10));
}
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
  purchasing: () => ({ label: 'Purchasing', color: 'steel' }),
  purchasing05: () => ({ label: 'PIC Line 05', color: 'steel' }),
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
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('');
  const [issue, setIssue] = useState<AuditKey | ''>('');
  const [showAudit, setShowAudit] = useState(false);
  const [auditInfo, setAuditInfo] = useState<Map<string, UserAuditInfo>>(new Map());
  const loadAudit = useCallback(() => {
    api
      .get<{ audit: UserAuditInfo[] }>('/api/users/audit')
      .then((r) => setAuditInfo(new Map(r.audit.map((a) => [a.id, a]))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (show) loadAudit();
  }, [show, users, loadAudit]);
  const flags = useMemo(() => auditUsers(users, auditInfo), [users, auditInfo]);
  const issueCount = useMemo(() => {
    const m = new Map<AuditKey, number>();
    flags.forEach((fs) => fs.forEach((f) => m.set(f, (m.get(f) || 0) + 1)));
    return m;
  }, [flags]);
  const needCheck = users.filter((u) => (flags.get(u.id) || []).some((f) => AUDIT_META[f].level !== 'info')).length;
  const shown = users.filter((u) => {
    if (statusFilter === 'dijeda' ? !u.pausedAt : statusFilter === 'aktif' ? !!u.pausedAt : false) return false;
    if (issue && !(flags.get(u.id) || []).includes(issue)) return false;
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return [u.username, u.name, u.email, u.se, u.cabang, ROLE_NAME[u.role], u.customRole ? roleLabels[u.customRole] : '', u.reg ? `regional ${u.reg}` : '']
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(k));
  });
  const groupOf = (u: (typeof users)[number]): { key: string; label: string } => {
    switch (groupBy) {
      case 'role': {
        const r = u.customRole ? `~${u.customRole}` : u.role;
        const i = ROLE_ORDER.indexOf(u.role);
        return { key: `${u.customRole ? 99 : i < 0 ? 98 : i}`.padStart(2, '0') + r, label: u.customRole ? `${roleLabels[u.customRole] || u.customRole} (role tambahan)` : ROLE_NAME[u.role] || u.role };
      }
      case 'cabang': {
        const c = cabangKey(u.cabang);
        return { key: c || '~', label: c || tr('Tanpa cabang (pusat / regional)') };
      }
      case 'reg':
        return { key: u.reg == null ? '~' : String(u.reg), label: u.reg == null ? tr('Tanpa regional') : `Regional ${u.reg}` };
      case 'asal': {
        const o = originOf(auditInfo.get(u.id));
        return { key: o === 'tidak' ? '0' : o === 'lain' ? '1' : '2', label: tr(ORIGIN_LABEL[o]) };
      }
      case 'login': {
        const b = loginBucket(auditInfo.get(u.id));
        return { key: b, label: tr(b.replace(/^\d · /, '')) };
      }
      default:
        return { key: '', label: '' };
    }
  };
  const grouped = useMemo(() => {
    if (!groupBy) return [{ key: '', label: '', list: shown }];
    const m = new Map<string, { key: string; label: string; list: typeof shown }>();
    shown.forEach((u) => {
      const g = groupOf(u);
      const cur = m.get(g.key) || { ...g, list: [] };
      cur.list.push(u);
      m.set(g.key, cur);
    });
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, groupBy, auditInfo, roleLabels]);

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const rows = users.map((u) => {
      const a = auditInfo.get(u.id);
      return [
        u.username, u.name, u.email || '', u.customRole ? roleLabels[u.customRole] || u.customRole : ROLE_NAME[u.role] || u.role, u.reg ?? '', u.se || '', u.cabang || '',
        u.pausedAt ? 'Dijeda' : 'Aktif', a ? ORIGIN_LABEL[originOf(a)] : '', a?.createdBy || '', a?.createdAt ? a.createdAt.slice(0, 10) : '',
        a?.lastLoginAt ? a.lastLoginAt.slice(0, 10) : 'belum pernah', a?.logins30 ?? '', a?.failed30 ?? '', a?.prospects ?? '',
        (flags.get(u.id) || []).map((f) => AUDIT_META[f].label).join('; '),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([['USERNAME', 'NAMA', 'EMAIL', 'ROLE', 'REGIONAL', 'SE', 'CABANG', 'STATUS', 'ASAL AKUN', 'DIBUAT OLEH', 'DIBUAT', 'LOGIN TERAKHIR', 'LOGIN 30 HARI', 'LOGIN GAGAL 30 HARI', 'PROSPEK BERJALAN', 'TEMUAN AUDIT'], ...rows]);
    ws['!cols'] = [14, 24, 30, 18, 9, 7, 8, 8, 30, 18, 11, 13, 8, 8, 9, 60].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit User');
    XLSX.writeFile(wb, `Audit_User_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

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
        <button type="button" className={`btn btn-sm ${showAudit ? 'btn-primary' : 'btn-outline'} btn-audit`} onClick={() => setShowAudit(!showAudit)} title={tr('Ringkasan temuan audit akun')}>
          ⚠ {tr('Audit user')}{needCheck ? ` · ${needCheck} ${tr('perlu dicek')}` : ''}
        </button>
      </span>
      <div className="toolbar-row users-tools">
        <input type="search" className="search-grow" placeholder={tr('Cari username, nama, email, SE, cabang, role…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label={tr('Kelompokkan')}>
          <option value="">{tr('Tanpa pengelompokan')}</option>
          <option value="role">{tr('Kelompokkan: Role')}</option>
          <option value="cabang">{tr('Kelompokkan: Cabang')}</option>
          <option value="reg">{tr('Kelompokkan: Regional')}</option>
          <option value="asal">{tr('Kelompokkan: Asal akun (dibuat Admin / bukan)')}</option>
          <option value="login">{tr('Kelompokkan: Login terakhir')}</option>
        </select>
        {issue && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setIssue('')}>
            {tr('Temuan')}: {tr(AUDIT_META[issue].label)} ✕
          </button>
        )}
        <span className="muted">{shown.length} {tr('user')}</span>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => void exportExcel()}>{tr('Export Excel')}</button>
      </div>
      {showAudit && (
        <div className="users-audit">
          <div className="field-note" style={{ margin: '0 0 6px' }}>{tr('Klik temuan untuk menyaring daftar. Merah = perlu tindakan, kuning = perlu dicek, abu = info.')}</div>
          <div className="users-audit-chips">
            {(Object.keys(AUDIT_META) as AuditKey[]).map((k) => {
              const n = issueCount.get(k) || 0;
              return (
                <button key={k} type="button" disabled={!n} className={`ua-chip ${AUDIT_META[k].level}${issue === k ? ' on' : ''}`} title={tr(AUDIT_META[k].hint)} onClick={() => setIssue(issue === k ? '' : k)}>
                  <b>{n}</b> {tr(AUDIT_META[k].label)}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
            <th>{tr("Login & asal akun")}</th>
            <th>{tr("Aksi")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={9} className="field-note">{tr("Tidak ada user.")}</td>
            </tr>
          )}
          {grouped.map((g) => (
            <Fragment key={g.key || 'all'}>
              {groupBy && (
                <tr className="users-grp">
                  <td colSpan={9}>
                    {g.label} <span className="muted">· {g.list.length}</span>
                  </td>
                </tr>
              )}
          {g.list.map((u) => {
            const a = auditInfo.get(u.id);
            const fs = flags.get(u.id) || [];
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
                <td className="users-audit-cell">
                  <div>{a?.lastLoginAt ? `${tr('Login')} ${tr(ago(a.lastLoginAt))}` : <span className="muted">{tr('Belum pernah login')}</span>}{a && a.logins30 > 0 ? <span className="muted"> · {a.logins30}× / 30 hr</span> : null}</div>
                  <div className="muted">{a?.createdBy ? `${tr('Dibuat')} ${a.createdBy}${a.createdByRole && a.createdByRole !== 'admin' ? ` (${ROLE_NAME[a.createdByRole] || a.createdByRole})` : ''}` : tr('Tidak tercatat dibuat Admin')}{a?.createdAt ? ` · ${formatDateID(a.createdAt.slice(0, 10))}` : ''}</div>
                  {fs.length > 0 && (
                    <div className="users-flags">
                      {fs.map((f) => (
                        <span key={f} className={`badge ${LEVEL_BADGE[AUDIT_META[f].level]}`} title={tr(AUDIT_META[f].hint)}>{tr(AUDIT_META[f].label)}</span>
                      ))}
                    </div>
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
            </Fragment>
          ))}
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
