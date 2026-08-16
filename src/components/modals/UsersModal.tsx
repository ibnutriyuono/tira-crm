'use client';

import { useEffect } from 'react';
import { Modal } from '../Modal';
import { IconEdit, IconTrash } from '../icons';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

const ROLE_META: Record<string, (u: { reg: number | null; cabang: string | null; se: string | null }) => { label: string; color: string }> = {
  admin: () => ({ label: 'Admin', color: 'amber' }),
  gm: () => ({ label: 'GM', color: 'rust' }),
  rm: (u) => ({ label: `RM · Regional ${u.reg ?? '-'}`, color: 'steel' }),
  bm: (u) => ({ label: `BM · ${u.cabang || '-'}`, color: 'green' }),
  sales: (u) => ({ label: `Sales · ${u.se || '-'}`, color: 'slate' }),
};

export function UsersModal() {
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

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Kelola User"
      wide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
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
        + Tambah User
      </button>
      <table className="simple-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Nama</th>
            <th>Role</th>
            <th>Regional</th>
            <th>SE</th>
            <th>Cabang</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const meta = (ROLE_META[u.role] || (() => ({ label: u.role, color: 'slate' })))(u);
            return (
              <tr key={u.id}>
                <td className="mono">{u.username}</td>
                <td>{u.name}</td>
                <td>
                  <span className={`badge ${meta.color}`}>{meta.label}</span>
                </td>
                <td>{u.reg ? `Regional ${u.reg}` : '-'}</td>
                <td>{u.se || '-'}</td>
                <td>{u.cabang || '-'}</td>
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
                        useUiStore.setState({ deleteCtx: { mode: 'user', id: u.id, title: 'Hapus User', message: `Yakin ingin menghapus user "${u.username}" (${u.name})?` } });
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
    </Modal>
  );
}
