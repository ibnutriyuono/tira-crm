'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useT } from '@/store/useLangStore';
import { LangSwitch } from '@/components/LangSwitch';
export default function LoginPage() {
  const tr = useT();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ? tr(data.error) : tr('Username atau password salah.'));
        setBusy(false);
        return;
      }
      // Dari link email "Buka di CRM" (/login?n=<id>): lanjut ke notifikasinya.
      const n = new URLSearchParams(window.location.search).get('n');
      // GM Operation bekerja di ruang Purchasing; tetap bisa kembali ke CRM (hanya baca).
      router.replace(n ? `/?n=${encodeURIComponent(n)}` : data.user?.role === 'gmops' ? '/purchasing' : '/');
      router.refresh();
    } catch {
      setError(tr('Gagal terhubung ke server. Coba lagi.'));
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/logo.png" alt={tr("Logo PT. TIRA AUSTENITE, Tbk")} />
          <h1>{tr("CRM TIRA")}</h1>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -6 }}>
          <LangSwitch />
        </div>
        <div className="auth-sub">{tr("Steel Division · PT. TIRA AUSTENITE, Tbk — Masuk untuk melanjutkan")}</div>
        <div className={`auth-error${error ? ' show' : ''}`}>{error}</div>
        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label>{tr("Username")}</label>
            <input type="text" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="auth-field">
            <label>{tr("Password")}</label>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? tr('Memproses...') : tr('Masuk')}
          </button>
        </form>
      </div>
    </div>
  );
}
