'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconMail } from '../icons';
import { useRoster } from '../issues/shared';
import { api } from '@/lib/api-client';
import { BROADCAST_ROLE_OPTIONS, CABANG_LIST } from '@/lib/constants';
import { MAIL_ATTACH_TYPES, MAIL_MAX_ATTACH_BYTES, composeEmailHtml, type ComposeMode } from '@/lib/compose-email';
import { validEmail } from '@/lib/notif-prefs';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';

type Target = 'all' | 'roles' | 'cabang' | 'users';
interface Att {
  filename: string;
  size: number;
  content: string;
}
interface Preview {
  total: number;
  withEmail: number;
  noEmail: number;
  names: string[];
}

const JABATAN: Record<string, string> = { gm: 'General Manager', admin: 'Administrator CRM' };

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
const sizeText = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Kirim Email (Admin & GM): pengumuman ke user CRM atau email ke customer,
 * dengan kop TIRA, lampiran, dan pratinjau yang sama dengan yang diterima.
 */
export function MailComposeModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'mailCompose');
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const customers = useDataStore((s) => s.customers);
  const toast = useDataStore((s) => s.toast);
  const roster = useRoster();

  const [mode, setMode] = useState<ComposeMode>('internal');
  const [target, setTarget] = useState<Target>('all');
  const [roles, setRoles] = useState<string[]>([]);
  const [cabangs, setCabangs] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [userQ, setUserQ] = useState('');
  const [inApp, setInApp] = useState(true);
  const [custQ, setCustQ] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [ccSelf, setCcSelf] = useState(true);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [atts, setAtts] = useState<Att[]>([]);
  const [showPrev, setShowPrev] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mailServer, setMailServer] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!show) return;
    setConfirm(false);
    if (mailServer === null) api.get<{ configured: boolean }>('/api/quotations/email').then((r) => setMailServer(!!r.configured)).catch(() => setMailServer(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Hitung penerima pengumuman setiap pilihan berubah.
  useEffect(() => {
    if (!show || mode !== 'internal') return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .post<Preview>('/api/mail/compose', { mode: 'internal', preview: true, internal: { target, roles, cabangs, userIds } })
        .then((r) => alive && setPreview(r))
        .catch(() => alive && setPreview(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [show, mode, target, roles, cabangs, userIds]);

  const cabangOptions = useMemo(() => Array.from(new Set([...CABANG_LIST, ...roster.map((u) => (u.cabang || '').toUpperCase()).filter(Boolean)])).sort(), [roster]);
  const userOptions = useMemo(() => {
    const q = userQ.trim().toLowerCase();
    return roster.filter((u) => u.id !== currentUser?.id && (!q || `${u.name} ${u.cabang || ''} ${u.role}`.toLowerCase().includes(q))).slice(0, 40);
  }, [roster, userQ, currentUser]);

  const custList = useMemo(() => {
    const q = custQ.trim().toLowerCase();
    return customers
      .map((c) => {
        const pics = (c.pics?.length ? c.pics : c.email ? [{ id: 'legacy', nama: c.pic || c.name, jabatan: null, phone: c.phone, email: c.email, isPrimary: true }] : []).filter((p) => p.email && validEmail(p.email));
        return { c, pics };
      })
      .filter((x) => !q || `${x.c.name} ${x.c.cabang || ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.pics.length > 0) - Number(a.pics.length > 0) || a.c.name.localeCompare(b.c.name))
      .slice(0, 60);
  }, [customers, custQ]);
  const pickedCount = Object.values(picked).filter((v) => v.length).length;
  const pickedEmails = Object.values(picked).reduce((n, v) => n + v.length, 0);

  if (!show || !currentUser) return null;

  const signer = { nama: currentUser.name, jabatan: JABATAN[currentUser.role] || '', email: currentUser.email || '' };
  const prevHtml = showPrev
    ? composeEmailHtml({ mode, message: message || tr('(isi pesan)'), attachments: atts.map((a) => a.filename), greeting: mode === 'internal' ? 'Halo [nama penerima]' : 'Dengan hormat', signer, logoSrc: '/logo.png' })
    : '';

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  function togglePic(customerId: string, email: string) {
    setPicked((p) => ({ ...p, [customerId]: toggle(p[customerId] || [], email) }));
  }
  function toggleCustomer(customerId: string, emails: string[]) {
    setPicked((p) => ({ ...p, [customerId]: (p[customerId] || []).length ? [] : emails }));
  }

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const next = [...atts];
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      if (!MAIL_ATTACH_TYPES[ext]) {
        toast(`Jenis file tidak didukung: ${f.name}`, 'error');
        continue;
      }
      next.push({ filename: f.name, size: f.size, content: await toBase64(f) });
    }
    if (next.reduce((n, a) => n + a.size, 0) > MAIL_MAX_ATTACH_BYTES) return toast('Lampiran terlalu besar (maks. 10 MB total)', 'error');
    setAtts(next);
  }

  const recipientsText =
    mode === 'internal'
      ? preview
        ? `${preview.total} ${tr('user')}${preview.noEmail ? ` · ${preview.withEmail} ${tr('punya email')}, ${preview.noEmail} ${tr('tanpa email')}` : ''}`
        : '…'
      : `${pickedCount} ${tr('customer')} · ${pickedEmails} ${tr('alamat')}`;

  function validate(): string | null {
    if (!subject.trim()) return 'Subjek wajib diisi';
    if (!message.trim()) return 'Isi pesan wajib diisi';
    if (mode === 'internal' && !(preview?.total)) return 'Pilih penerima pengumuman';
    if (mode === 'internal' && mailServer === false && !inApp) return 'Server email belum diatur — centang "Tampilkan juga di Notifikasi CRM" untuk mengirim lewat CRM saja';
    if (mode === 'customer' && !pickedEmails) return 'Pilih minimal satu alamat email customer';
    if (mode === 'customer' && mailServer === false) return 'Server email belum diatur — email ke customer belum bisa dikirim';
    const badCc = cc.split(/[,;\s]+/).filter(Boolean).find((e) => !validEmail(e));
    if (mode === 'customer' && badCc) return `Alamat CC tidak valid: ${badCc}`;
    return null;
  }

  async function onSend() {
    const err = validate();
    if (err) return toast(err, 'error');
    if (!confirm) return setConfirm(true);
    setBusy(true);
    try {
      const attachments = atts.map((a) => ({ filename: a.filename, content: a.content }));
      if (mode === 'internal') {
        const r = await api.post<{ total: number; sent: number; failed: string[]; noEmail: number; inApp: number }>('/api/mail/compose', {
          mode, subject, message, attachments, internal: { target, roles, cabangs, userIds, inApp },
        });
        toast(`Pengumuman terkirim: ${r.sent} email${r.inApp ? ` · ${r.inApp} notifikasi CRM` : ''}${r.noEmail ? ` · ${r.noEmail} user tanpa email` : ''}${r.failed.length ? ` · gagal: ${r.failed.join(', ')}` : ''}`, r.failed.length ? 'error' : 'success');
      } else {
        const recipients = Object.entries(picked).filter(([, v]) => v.length).map(([customerId, emails]) => ({ customerId, emails }));
        const r = await api.post<{ total: number; sent: number; failed: string[]; skipped: string[] }>('/api/mail/compose', {
          mode, subject, message, attachments, customer: { recipients, cc: cc.split(/[,;\s]+/).filter(Boolean), ccSelf },
        });
        toast(`Email terkirim ke ${r.sent} customer${r.failed.length ? ` · gagal: ${r.failed.join(', ')}` : ''}${r.skipped.length ? ` · dilewati: ${r.skipped.join(', ')}` : ''}`, r.failed.length ? 'error' : 'success');
      }
      setSubject('');
      setMessage('');
      setAtts([]);
      setPicked({});
      setConfirm(false);
      closeModal();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengirim email', 'error');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `mc-chip${on ? ' on' : ''}`;

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr('Kirim Email')}
      xwide
      footer={
        <>
          <span className="mc-foot-info">{recipientsText}</span>
          <button type="button" className="btn btn-outline" onClick={() => setShowPrev((v) => !v)}>{showPrev ? tr('Tutup pratinjau') : tr('Pratinjau')}</button>
          <button type="button" className="btn btn-outline" onClick={closeModal} disabled={busy}>{tr('Batal')}</button>
          <button type="button" className="btn btn-primary" onClick={onSend} disabled={busy}>
            <IconMail /> {busy ? tr('Mengirim…') : confirm ? tr('Ya, kirim sekarang') : tr('Kirim')}
          </button>
        </>
      }
    >
      <div className="sa-pills q-tabs" role="tablist" aria-label={tr('Jenis email')} style={{ marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={mode === 'internal'} className={mode === 'internal' ? 'on' : ''} onClick={() => { setMode('internal'); setConfirm(false); }}>{tr('Pengumuman ke user CRM')}</button>
        <button type="button" role="tab" aria-selected={mode === 'customer'} className={mode === 'customer' ? 'on' : ''} onClick={() => { setMode('customer'); setConfirm(false); }}>{tr('Email ke customer')}</button>
      </div>

      {mailServer === false && (
        <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 12 }}>
          {mode === 'internal' ? tr('Server email belum diatur — pengumuman hanya bisa dikirim sebagai Notifikasi CRM.') : tr('Server email belum diatur — email ke customer belum bisa dikirim. Hubungi Admin untuk mengatur SMTP.')}
        </div>
      )}

      <div className="mc-grid">
        <div className="mc-col">
          {mode === 'internal' ? (
            <>
              <label className="mc-label">{tr('Penerima')}</label>
              <div className="mc-chips">
                {(['all', 'roles', 'cabang', 'users'] as Target[]).map((t) => (
                  <button key={t} type="button" className={chip(target === t)} aria-pressed={target === t} onClick={() => { setTarget(t); setConfirm(false); }}>
                    {t === 'all' ? tr('Semua user') : t === 'roles' ? tr('Per role') : t === 'cabang' ? tr('Per cabang') : tr('Pilih user')}
                  </button>
                ))}
              </div>
              {target === 'roles' && (
                <div className="mc-checks">
                  {BROADCAST_ROLE_OPTIONS.map((r) => (
                    <label key={r.v}><input type="checkbox" checked={roles.includes(r.v)} onChange={() => setRoles(toggle(roles, r.v))} /> {tr(r.l)}</label>
                  ))}
                </div>
              )}
              {target === 'cabang' && (
                <div className="mc-chips">
                  {cabangOptions.map((c) => (
                    <button key={c} type="button" className={chip(cabangs.includes(c))} aria-pressed={cabangs.includes(c)} onClick={() => setCabangs(toggle(cabangs, c))}>{c}</button>
                  ))}
                </div>
              )}
              {target === 'users' && (
                <>
                  <input type="text" value={userQ} onChange={(e) => setUserQ(e.target.value)} placeholder={tr('Cari nama / cabang / role…')} />
                  <div className="mc-list">
                    {userOptions.map((u) => (
                      <label key={u.id}><input type="checkbox" checked={userIds.includes(u.id)} onChange={() => setUserIds(toggle(userIds, u.id))} /> <b>{u.name}</b> <span className="mc-sub">{u.role}{u.cabang ? ` · ${u.cabang}` : ''}</span></label>
                    ))}
                  </div>
                </>
              )}
              {preview && (
                <div className="mc-note">
                  <b>{preview.total}</b> {tr('penerima')}{preview.names.length ? `: ${preview.names.join(', ')}${preview.total > preview.names.length ? '…' : ''}` : ''}
                  {preview.noEmail > 0 && <div>{preview.noEmail} {tr('user belum mengisi email — mereka tetap menerima lewat Notifikasi CRM bila dicentang.')}</div>}
                </div>
              )}
              <label className="q-ppn" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} /> {tr('Tampilkan juga di Notifikasi CRM')}
              </label>
              <div className="field-note">{tr('Setiap user menerima email sendiri — alamat penerima lain tidak terlihat.')}</div>
            </>
          ) : (
            <>
              <label className="mc-label">{tr('Customer & PIC')}</label>
              <input type="text" value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder={tr('Cari customer / cabang…')} />
              <div className="mc-list mc-cust">
                {custList.map(({ c, pics }) => {
                  const sel = picked[c.id] || [];
                  return (
                    <div key={c.id} className={`mc-cust-row${sel.length ? ' on' : ''}`}>
                      <label className="mc-cust-head">
                        <input type="checkbox" disabled={!pics.length} checked={sel.length > 0} onChange={() => toggleCustomer(c.id, pics.slice(0, 1).map((p) => p.email as string))} />
                        <b>{c.name}</b> <span className="mc-sub">{c.cabang || '-'}{!pics.length ? ` · ${tr('belum ada email PIC')}` : ''}</span>
                      </label>
                      {sel.length > 0 && pics.map((p) => (
                        <label key={p.email as string} className="mc-pic">
                          <input type="checkbox" checked={sel.includes(p.email as string)} onChange={() => togglePic(c.id, p.email as string)} /> {p.nama}{p.jabatan ? ` (${p.jabatan})` : ''} — <span className="mono">{p.email}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="field-note">{tr('Satu email per customer ke PIC yang dicentang. Balasan customer masuk ke email Anda.')}</div>
              <label className="mc-label" style={{ marginTop: 10 }}>{tr('CC tambahan')}</label>
              <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} placeholder={tr('opsional, cth. bm.dki@… , sales@…')} />
              {currentUser.email && (
                <label className="q-ppn" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={ccSelf} onChange={(e) => setCcSelf(e.target.checked)} /> {tr('Kirim salinan ke saya')} ({currentUser.email})
                </label>
              )}
            </>
          )}
        </div>

        <div className="mc-col">
          <label className="mc-label">{tr('Subjek')} <span style={{ color: 'var(--rust-500)' }}>*</span></label>
          <input type="text" value={subject} onChange={(e) => { setSubject(e.target.value); setConfirm(false); }} placeholder={mode === 'internal' ? tr('cth. Jadwal training CRM cabang Wilayah 1') : tr('cth. Informasi stok Creusabro 8000 bulan November')} />
          <label className="mc-label" style={{ marginTop: 10 }}>{tr('Pesan')} <span style={{ color: 'var(--rust-500)' }}>*</span></label>
          <textarea rows={10} value={message} onChange={(e) => { setMessage(e.target.value); setConfirm(false); }} placeholder={tr('Tulis pesan… baris kosong = paragraf baru. Sapaan dan tanda tangan ditambahkan otomatis.')} />
          <label className="mc-label" style={{ marginTop: 10 }}>{tr('Lampiran')}</label>
          <input type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.jpg,.jpeg,.png" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          {atts.length > 0 && (
            <ul className="mc-atts">
              {atts.map((a, i) => (
                <li key={i}>{a.filename} <span className="mc-sub">{sizeText(a.size)}</span> <button type="button" className="if-fix-btn danger" onClick={() => setAtts(atts.filter((_, j) => j !== i))}>{tr('Hapus')}</button></li>
              ))}
            </ul>
          )}
          <div className="field-note">PDF, Word, Excel, PowerPoint, JPG/PNG · {tr('maks. 10 MB total')}</div>
          {confirm && <div className="import-summary if-warn" style={{ marginTop: 10 }}>{tr('Kirim sekarang ke')} <b>{recipientsText}</b>? {tr('Tekan sekali lagi untuk mengirim.')}</div>}
        </div>
      </div>

      {showPrev && <iframe title={tr('Pratinjau email')} className="mc-preview" srcDoc={prevHtml} />}
    </Modal>
  );
}
