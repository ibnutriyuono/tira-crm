'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
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
        setError(data.error || 'Username atau password salah.');
        setBusy(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Gagal terhubung ke server. Coba lagi.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/logo.png" alt="Logo PT Tira Austenite" />
          <h1>CRM TIRA</h1>
        </div>
        <div className="auth-sub">Steel Division · PT Tira Austenite &mdash; Masuk untuk melanjutkan</div>
        <div className={`auth-error${error ? ' show' : ''}`}>{error}</div>
        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label>Username</label>
            <input type="text" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
        <div className="auth-hint">
          Akun demo &mdash; Admin: <b>admin</b> / <b>admin123</b>
          <br />
          Akun demo &mdash; GM: <b>gm</b> / <b>gm123</b> (lihat semua)
          <br />
          Akun demo &mdash; RM: <b>rm</b> / <b>rm123</b> (Regional 2)
          <br />
          Akun demo &mdash; BM: <b>bm</b> / <b>bm123</b> (Cabang DKI)
          <br />
          Akun demo &mdash; Sales: <b>sales</b> / <b>sales123</b>
          <br />
          Admin dapat menambah/menghapus akun melalui menu <b>Kelola User</b>.
        </div>
      </div>
    </div>
  );
}
