'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { DIGEST_HOURS, EMAIL_MODES, NOTIF_CATEGORIES, defaultPrefs, validEmail, type EmailMode, type NotifPrefs } from '@/lib/notif-prefs';
import { useDataStore } from '@/store/useDataStore';

import { useT } from '@/store/useLangStore';
interface MailInfo {
  configured: boolean;
  cap: number;
  from?: string;
  server?: string | null;
  appUrl?: string | null;
  sentToday?: number;
  failedToday?: number;
  lastError?: { error: string | null; at: string } | null;
}

const MODE_COLOR: Record<EmailMode, string> = { langsung: 'var(--steel-600, #2f5576)', ringkasan: 'var(--amber-500, #c47f2c)', mati: '#6b7684' };

/**
 * Pengaturan notifikasi email milik user yang login (Notifikasi › Pengaturan):
 * alamat email, mode per kategori (Langsung / Ringkasan / Tidak), jam & hari
 * ringkasan harian, email uji. Admin juga melihat status server email.
 */
export function NotifSettingsPanel() {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const isAdmin = useDataStore((s) => s.currentUser?.role === 'admin');
  const [email, setEmail] = useState('');
  const [prefs, setPrefs] = useState<NotifPrefs>(defaultPrefs());
  const [mail, setMail] = useState<MailInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ email: string; prefs: NotifPrefs; mail: MailInfo }>('/api/notifications/settings')
      .then((r) => {
        if (!alive) return;
        setEmail(r.email);
        setPrefs(r.prefs);
        setMail(r.mail);
        setLoaded(true);
      })
      .catch((err) => toast(err instanceof Error ? err.message : 'Gagal memuat pengaturan', 'error'));
    return () => {
      alive = false;
    };
  }, [toast]);

  const setMode = (key: string, m: EmailMode) => setPrefs((p) => ({ ...p, modes: { ...p.modes, [key]: m } }));

  async function save() {
    if (email.trim() && !validEmail(email.trim())) return toast('Format email tidak valid', 'error');
    setBusy(true);
    try {
      const r = await api.put<{ email: string; prefs: NotifPrefs }>('/api/notifications/settings', { email: email.trim(), prefs });
      setEmail(r.email);
      setPrefs(r.prefs);
      toast('Pengaturan notifikasi disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api.post<{ to: string }>('/api/notifications/settings', { test: true });
      toast(`Email uji dikirim ke ${r.to}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim email uji', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="field-note">{tr("Memuat pengaturan…")}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {mail && !mail.configured && (
        <div className="import-summary if-warn" style={{ margin: 0 }}>
          {tr("Server email belum diatur oleh Administrator — pengaturan bisa disimpan sekarang, email mulai terkirim setelah server email aktif.")}
        </div>
      )}
      <div className="form-grid">
        <div className="full">
          <label>{tr("Email penerima notifikasi")}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr("nama@perusahaan.co.id")} style={{ flex: 1 }} />
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || !mail?.configured} onClick={test} title={tr("Simpan dulu bila email baru diubah")}>
              {tr("Kirim email uji")}
            </button>
          </div>
          <div className="field-note">{tr("Kosongkan bila tidak ingin menerima email. Notifikasi di dalam CRM tetap muncul.")}</div>
        </div>
      </div>

      <div className="table-wrap" style={{ borderTop: 'none' }}>
        <table className="simple-table" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>{tr("Jenis notifikasi")}</th>
              <th style={{ width: 320 }}>{tr("Email")}</th>
            </tr>
          </thead>
          <tbody>
            {NOTIF_CATEGORIES.map((c) => (
              <tr key={c.key}>
                <td>
                  <b>{c.label}</b>
                  <div className="field-note" style={{ margin: 0 }}>{c.hint}</div>
                </td>
                <td>
                  <div className="sa-pills" role="group" aria-label={`Mode email ${c.label}`} style={{ flexWrap: 'nowrap' }}>
                    {EMAIL_MODES.map((m) => {
                      const on = prefs.modes[c.key] === m.key;
                      return (
                        <button key={m.key} type="button" aria-pressed={on} className={on ? 'on' : ''} style={on ? { background: MODE_COLOR[m.key], borderColor: MODE_COLOR[m.key] } : undefined} onClick={() => setMode(c.key, m.key)}>
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="form-grid">
        <div>
          <label>{tr("Jam ringkasan harian (WIB)")}</label>
          <select value={prefs.jam} onChange={(e) => setPrefs((p) => ({ ...p, jam: e.target.value }))}>
            {DIGEST_HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>{tr("Hari kirim ringkasan")}</label>
          <select value={prefs.hari} onChange={(e) => setPrefs((p) => ({ ...p, hari: e.target.value as NotifPrefs['hari'] }))}>
            <option value="kerja">{tr("Senin – Jumat")}</option>
            <option value="semua">{tr("Setiap hari")}</option>
          </select>
        </div>
      </div>
      <div className="field-note" style={{ margin: 0 }}>
        <b>{tr("Langsung")}</b> {tr("= satu email tiap kejadian (maks.")} {mail?.cap ?? 20} {tr("per hari, sisanya masuk ringkasan).")} <b>{tr("Ringkasan")}</b> {tr("= digabung dalam satu email harian berisi notifikasi yang belum dibaca.")} <b>{tr("Tidak")}</b> {tr("= hanya di CRM.")}
      </div>

      {isAdmin && mail && (
        <div className="import-summary" style={{ margin: 0 }}>
          <b>{tr("Server email (Admin):")}</b>{' '}
          {mail.configured ? (
            <>
              {tr("aktif ·")} {mail.server} {tr("· pengirim")} {mail.from} {tr("· terkirim hari ini")} {mail.sentToday ?? 0}{tr(", gagal")} {mail.failedToday ?? 0}
              {!mail.appUrl && <> · <b>{tr("APP_URL belum diisi")}</b> {tr("(tombol \"Buka di CRM\" tidak tampil di email)")}</>}
              {mail.lastError?.error && (
                <div style={{ marginTop: 4, color: 'var(--rust-600, #9a2f17)' }}>
                  {tr("Kesalahan terakhir (")}{new Date(mail.lastError.at).toLocaleString('id-ID')}): {mail.lastError.error}
                </div>
              )}
            </>
          ) : (
            <>{tr("belum diatur — isi SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM dan APP_URL di file .env server, lalu restart aplikasi.")}</>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setPrefs(defaultPrefs())}>
          {tr("Kembalikan bawaan")}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
          {tr("Simpan")}
        </button>
      </div>
    </div>
  );
}
