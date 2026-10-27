'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { getPrimaryPic } from '@/lib/format';
import { normalizeCustomerName } from '@/lib/kam';
import { normalizePhone } from '@/lib/activity-contact';
import { followUpDateProblem } from '@/lib/followup-rule';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import type { Prospect, SalesActivity } from '@/lib/types';

const HASIL = ['Bertemu PIC', 'Minta penawaran', 'Negosiasi harga', 'Survei lokasi / ukur', 'Serah dokumen / sampel', 'Keluhan / masalah', 'PIC tidak di tempat'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Lokasi hanya bisa diambil di alamat HTTPS (aturan browser). */
function getLocation(): Promise<{ lat: number; lng: number; akurasi: number } | 'insecure' | null> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && !window.isSecureContext) return resolve('insecure');
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, akurasi: Math.round(pos.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/**
 * Catat kunjungan cepat (HP): customer, PIC yang ditemui, hasil (pilih), catatan,
 * langkah berikutnya, jadwal follow-up prospek. Lokasi diambil saat menekan
 * Simpan; tanpa lokasi tetap tersimpan dengan tanda "tanpa verifikasi".
 * Kunjungan ini otomatis menyelesaikan Tugas Kunjungan untuk customer yang sama.
 */
export function QuickVisitSheet({ initialCustomer, prospectId, onClose }: { initialCustomer?: string; prospectId?: string; onClose: () => void }) {
  const tr = useT();
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);
  const [today] = useState(() => ymd(new Date()));
  const [customer, setCustomer] = useState(initialCustomer || '');
  const [picSel, setPicSel] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState({ nama: '', jabatan: '', phone: '' });
  const [hasil, setHasil] = useState<string[]>([]);
  const [catatan, setCatatan] = useState('');
  const [langkah, setLangkah] = useState('');
  const [pid, setPid] = useState(prospectId || '');
  const [fu, setFu] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ loc: string; tasks: number } | null>(null);

  const key = normalizeCustomerName(customer);
  const cust = customers.find((c) => normalizeCustomerName(c.name) === key) || null;
  const knownPics = useMemo(() => {
    if (!cust) return [];
    if (cust.pics?.length) return cust.pics;
    const p = getPrimaryPic(cust);
    return p ? [p] : [];
  }, [cust]);
  const custProspects: Prospect[] = prospects.filter((p) => normalizeCustomerName(p.customer) === key && Number(p.status) >= 1 && Number(p.status) <= 3);
  const names = useMemo(() => Array.from(new Set([...customers.map((c) => c.name), ...prospects.map((p) => p.customer)])).sort(), [customers, prospects]);

  async function save() {
    if (!customer.trim()) return toast(tr('Pilih customer dulu'), 'error');
    const pics = [
      ...knownPics.filter((p) => picSel[p.id || p.nama]).map((p) => ({ nama: p.nama, jabatan: p.jabatan || '', phone: p.phone ? normalizePhone(p.phone) : '', email: p.email || '', dihubungi: true })),
      ...(manual.nama.trim() ? [{ nama: manual.nama.trim(), jabatan: manual.jabatan.trim(), phone: manual.phone ? normalizePhone(manual.phone) : '', email: '', dihubungi: true }] : []),
    ];
    if (!pics.length) return toast(tr('Pilih atau isi PIC yang ditemui'), 'error');
    if (pics.some((p) => !p.jabatan)) return toast(tr('Isi jabatan PIC'), 'error');
    if (pid && fu) {
      const err = followUpDateProblem(fu, today);
      if (err) return toast(tr(err), 'error');
    }
    setBusy(true);
    try {
      const loc = await getLocation();
      const keterangan = [hasil.join(', '), catatan.trim()].filter(Boolean).join(' — ');
      const r = await api.post<{ activity: SalesActivity; tasksDone?: number }>('/api/sales-activities', {
        tanggal: today,
        tipe: 'kunjungan',
        customer: customer.trim(),
        keterangan,
        pics,
        kanal: null,
        hasil: null,
        followUp: null,
        langkah: langkah.trim(),
        ...(loc && loc !== 'insecure' ? loc : {}),
      });
      if (pid && fu) {
        const p = await api.patch<{ prospect: Prospect }>(`/api/prospects/${pid}`, { followUpAt: fu, followUpNote: langkah.trim() || hasil.join(', ') });
        upsertProspect(p.prospect);
      }
      setDone({
        loc: loc === 'insecure' ? tr('tanpa verifikasi lokasi (alamat CRM belum HTTPS)') : loc ? `${tr('lokasi tercatat')} ±${loc.akurasi} m` : tr('tanpa verifikasi lokasi (izin lokasi ditolak / GPS mati)'),
        tasks: r.tasksDone || 0,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan kunjungan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-sheet-bg" onClick={() => !busy && onClose()}>
      <div className="mb-sheet mb-visit" role="dialog" aria-label={tr('Catat kunjungan')} onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <b className="mb-sheet-t">✓ {tr('Kunjungan tersimpan')}</b>
            <span>{customer} · {done.loc}</span>
            {done.tasks > 0 && <span className="ok">{tr('Tugas kunjungan untuk customer ini otomatis dilaporkan ke penugas.')}</span>}
            <span className="muted">{tr('Tercatat di Aktivitas Harian dan KPI Aktivitas.')}</span>
            <div className="mb-sheet-a"><button type="button" className="mb-btn pri" onClick={onClose}>{tr('Selesai')}</button></div>
          </>
        ) : (
          <>
            <b className="mb-sheet-t">{tr('Catat kunjungan')}</b>
            <label>{tr('Customer')} *</label>
            <input type="text" list="mb-cust" value={customer} onChange={(e) => { setCustomer(e.target.value); setPicSel({}); setPid(''); }} placeholder={tr('Ketik nama customer')} />
            <datalist id="mb-cust">{names.map((n) => <option key={n} value={n} />)}</datalist>

            <label>{tr('PIC yang ditemui')} *</label>
            {knownPics.length > 0 && (
              <div className="mb-pills">
                {knownPics.map((p) => {
                  const k = p.id || p.nama;
                  return (
                    <button key={k} type="button" className={picSel[k] ? 'on' : ''} onClick={() => setPicSel({ ...picSel, [k]: !picSel[k] })}>
                      {p.nama}{p.jabatan ? ` · ${p.jabatan}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mb-two">
              <input type="text" value={manual.nama} onChange={(e) => setManual({ ...manual, nama: e.target.value })} placeholder={knownPics.length ? tr('PIC lain: nama') : tr('Nama PIC')} />
              <input type="text" value={manual.jabatan} onChange={(e) => setManual({ ...manual, jabatan: e.target.value })} placeholder={tr('Jabatan')} />
            </div>

            <label>{tr('Hasil (boleh lebih dari satu)')}</label>
            <div className="mb-pills">
              {HASIL.map((h) => (
                <button key={h} type="button" className={hasil.includes(h) ? 'on' : ''} onClick={() => setHasil(hasil.includes(h) ? hasil.filter((x) => x !== h) : [...hasil, h])}>
                  {tr(h)}
                </button>
              ))}
            </div>
            <label>{tr('Catatan')}</label>
            <textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={tr('cth. minta revisi harga 3%, keputusan minggu depan')} />
            <label>{tr('Langkah berikutnya')}</label>
            <input type="text" value={langkah} onChange={(e) => setLangkah(e.target.value)} placeholder={tr('cth. kirim revisi penawaran')} />

            {custProspects.length > 0 && (
              <>
                <label>{tr('Jadwalkan follow-up prospek')}</label>
                <div className="mb-two">
                  <select value={pid} onChange={(e) => setPid(e.target.value)}>
                    <option value="">{tr('— tidak —')}</option>
                    {custProspects.map((p) => <option key={p.id} value={p.id}>{(p.uraian || p.customer).slice(0, 40)}</option>)}
                  </select>
                  <input type="date" min={today} value={fu} disabled={!pid} onChange={(e) => setFu(e.target.value)} />
                </div>
              </>
            )}
            <small className="muted">{tr('Lokasi diambil saat menekan Simpan. Tanpa lokasi tetap tersimpan, ditandai "tanpa verifikasi".')}</small>
            <div className="mb-sheet-a">
              <button type="button" className="mb-btn" disabled={busy} onClick={onClose}>{tr('Batal')}</button>
              <button type="button" className="mb-btn pri" disabled={busy} onClick={save}>{busy ? tr('Menyimpan…') : tr('Simpan kunjungan')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
