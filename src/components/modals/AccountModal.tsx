'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { BUILTIN_ROLE_LABEL } from '@/lib/permissions';
import { validEmail } from '@/lib/notif-prefs';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { SafeUser } from '@/lib/types';
import { SignatureSection } from '../SignatureSection';

import { useT } from '@/store/useLangStore';
/**
 * Akun Saya — tersedia untuk semua role: ganti username, password, email,
 * dan tanda tangan untuk surat penawaran (disimpan terpisah, tanpa password).
 * Nama/role/cabang diatur Admin. Setelah Admin mereset password
 * (mustChangePassword) modal ini terbuka paksa dan hanya meminta password baru.
 */
export function AccountModal() {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const forced = !!me?.mustChangePassword;
  const open = useUiStore((s) => s.modal === 'account');
  const closeModal = useUiStore((s) => s.closeModal);
  const show = open || forced;

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show || !me) return;
    setUsername(me.username);
    setEmail(me.email || '');
    setPw1('');
    setPw2('');
    setCurrent('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, me?.id]);

  if (!me) return null;

  async function onSubmit() {
    if (!me) return;
    const u = username.trim().toLowerCase();
    if (!u) return toast('Username wajib diisi', 'error');
    if (email.trim() && !validEmail(email.trim())) return toast('Format email tidak valid', 'error');
    if (forced && !pw1) return toast('Buat password baru', 'error');
    if (pw1 && pw1.length < 6) return toast('Password minimal 6 karakter', 'error');
    if (pw1 !== pw2) return toast('Ulangi password baru tidak sama', 'error');
    const onlyPassword = u === me.username && email.trim().toLowerCase() === (me.email || '');
    if (!(forced && onlyPassword) && !current) return toast('Isi password saat ini untuk menyimpan', 'error');
    setBusy(true);
    try {
      const { user } = await api.put<{ user: SafeUser }>('/api/account', { username: u, email: email.trim(), newPassword: pw1 || undefined, currentPassword: current || undefined });
      useDataStore.getState().setCurrentUser({ ...me, ...user, customRoleLabel: me.customRoleLabel });
      toast(forced ? 'Password baru disimpan' : 'Akun disimpan', 'success');
      if (open) closeModal();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan akun', 'error');
    } finally {
      setBusy(false);
    }
  }

  const roleText = [me.customRoleLabel || BUILTIN_ROLE_LABEL[me.role] || me.role, me.cabang, me.se].filter(Boolean).join(' · ');

  return (
    <Modal
      show={show}
      onClose={forced ? () => {} : closeModal}
      title={forced ? tr("Buat Password Baru") : tr("Akun Saya")}
      wide
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      footer={
        <>
          {!forced && (
            <button type="button" className="btn btn-outline" onClick={closeModal}>
              {tr("Batal")}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {forced ? tr("Simpan & lanjut") : tr("Simpan")}
          </button>
        </>
      }
    >
      {forced ? (
        <div className="import-summary if-warn" style={{ marginTop: 0 }}>
          {tr("Password Anda baru direset Admin. Buat password baru sebelum melanjutkan.")}
        </div>
      ) : (
        <div className="import-summary" style={{ marginTop: 0 }}>
          <b>{me.name}</b> · {roleText}
          <div className="field-note" style={{ margin: '2px 0 0' }}>{tr("Nama, role dan cabang diatur Admin. Perubahan di sini tercatat di Log Aktivitas Admin.")}</div>
        </div>
      )}
      <div className="form-grid">
        {!forced && (
          <>
            <div>
              <label>{tr("Username")}</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <label>{tr("Email (untuk notifikasi)")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr("nama@perusahaan.co.id")} />
            </div>
          </>
        )}
        <div>
          <label>{tr("Password baru")}</label>
          <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" placeholder={forced ? tr("Minimal 6 karakter") : tr("Kosongkan bila tidak diubah")} />
        </div>
        <div>
          <label>{tr("Ulangi password baru")}</label>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </div>
        {!forced && (
          <div className="full">
            <label>{tr("Password saat ini (wajib untuk menyimpan)")}</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
        )}
      </div>
      {!forced && <SignatureSection />}
    </Modal>
  );
}
