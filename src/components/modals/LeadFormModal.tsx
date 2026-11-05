'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { CABANG_LIST } from '@/lib/constants';
import { num } from '@/lib/format';
import { LEAD_SOURCES } from '@/lib/leads';
import { emptyRow, parseMaterialText, rowToMaterial, rowUraian, type SpecRow } from '@/lib/material-spec';
import { parseWithLexicon } from '@/lib/material-learn';
import { parseInquiry } from '@/lib/inquiry-parse';
import { useMaterialLexicon } from '@/hooks/useMaterialLexicon';
import type { Customer, Prospect, RosterUser } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';
import { MaterialSpecEditor } from '../MaterialSpecEditor';
import { Modal } from '../Modal';

/** Kontak utama customer + alamat dari Kelola Customer. */
function primaryPic(c: Customer): { nama: string; jabatan: string; phone: string; email: string; address: string } {
  const p = (c.pics || []).find((x) => x.isPrimary) || (c.pics || [])[0];
  const address = c.address || '';
  if (p) return { nama: p.nama || '', jabatan: p.jabatan || '', phone: p.phone || c.phone || '', email: p.email || c.email || '', address };
  return { nama: c.pic || '', jabatan: '', phone: c.phone || '', email: c.email || '', address };
}
const EMPTY_PIC = { nama: '', jabatan: '', phone: '', email: '', address: '' };

/**
 * Tambah Lead (Product & Marketing): permintaan dari Indotrading, website,
 * pameran, dst. diteruskan ke cabang tujuan sebagai prospek "Permintaan".
 * BM cabang diberi tahu dan menunjuk Sales bila SE dibiarkan kosong.
 */
export function LeadFormModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'leadForm');
  const closeModal = useUiStore((s) => s.closeModal);
  const customers = useDataStore((s) => s.customers);
  const toast = useDataStore((s) => s.toast);
  const upsertProspect = useDataStore((s) => s.upsertProspect);

  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [kontak, setKontak] = useState('');
  const [jabatan, setJabatan] = useState('');
  const [email, setEmail] = useState('');
  const [alamat, setAlamat] = useState('');
  const [cabang, setCabang] = useState('');
  const [se, setSe] = useState('');
  const [source, setSource] = useState('');
  const [rows, setRows] = useState<SpecRow[]>([emptyRow()]);
  // Kolom yang diisi otomatis dari data customer (ditandai, dan boleh diubah).
  const [auto, setAuto] = useState<Record<string, boolean>>({});
  const [catatan, setCatatan] = useState('');
  // Tempel inquiry (Indotrading / email / WA) -> isi form otomatis.
  const [inqOpen, setInqOpen] = useState(false);
  const [inqText, setInqText] = useState('');
  const [inqNote, setInqNote] = useState('');
  const lex = useMaterialLexicon();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [roster, setRoster] = useState<RosterUser[]>([]);

  useEffect(() => {
    if (!show) return;
    const pre = useUiStore.getState().leadPrefill;
    useUiStore.setState({ leadPrefill: null });
    const preCust = pre ? useDataStore.getState().customers.find((c) => c.name.trim().toUpperCase() === pre.customer.trim().toUpperCase()) : undefined;
    const prePic = preCust ? primaryPic(preCust) : EMPTY_PIC;
    const preCab = (pre?.cabang || preCust?.cabang || '').toUpperCase();
    setCustomer(pre?.customer || '');
    setPhone(prePic.phone);
    setKontak(prePic.nama);
    setJabatan(prePic.jabatan);
    setEmail(prePic.email);
    setAlamat(prePic.address);
    setCabang(preCab);
    setSe('');
    setSource(pre?.source || '');
    setRows([emptyRow()]);
    setAuto({ phone: !!prePic.phone, kontak: !!prePic.nama, jabatan: !!prePic.jabatan, email: !!prePic.email, alamat: !!prePic.address, cabang: !!preCab && !pre?.cabang });
    setCatatan('');
    setInqOpen(false);
    setInqText('');
    setInqNote('');
    setError('');
    let alive = true;
    api
      .get<{ roster: RosterUser[] }>('/api/users/roster')
      .then((r) => alive && setRoster(r.roster))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);

  // Customer yang sudah ada: cabangnya diusulkan sebagai tujuan.
  const known = useMemo(() => new Map(customers.map((c) => [c.name.trim().toUpperCase(), c])), [customers]);
  const match = known.get(customer.trim().toUpperCase());
  const salesOfCabang = useMemo(
    () => roster.filter((u) => u.role === 'sales' && !u.paused && (u.se || '').trim() && (u.cabang || '').toUpperCase() === cabang).sort((a, b) => (a.se || '').localeCompare(b.se || '')),
    [roster, cabang],
  );
  const prospects = useDataStore((s) => s.prospects);
  /** Prospek customer ini: SE yang terakhir menangani per cabang + yang masih aktif (status 1–3). */
  const history = useMemo(() => {
    const key = customer.trim().toUpperCase();
    if (!key) return { lastSe: {} as Record<string, string>, open: [] as Prospect[] };
    const mine = prospects.filter((p) => p.customer.trim().toUpperCase() === key).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const lastSe: Record<string, string> = {};
    mine.forEach((p) => {
      const c = (p.cabang || '').toUpperCase();
      if (c && p.se && !lastSe[c]) lastSe[c] = p.se.toUpperCase();
    });
    return { lastSe, open: mine.filter((p) => num(p.status) >= 1 && num(p.status) <= 3) };
  }, [prospects, customer]);

  /** Customer dipilih dari daftar: isi cabang, kontak, telepon dan Sales yang biasa menangani. */
  function fillFromCustomer(name: string) {
    const c = known.get(name.trim().toUpperCase());
    if (!c) return;
    const pic = primaryPic(c);
    const next: Record<string, boolean> = {};
    const cab = (c.cabang || '').toUpperCase();
    if (cab && !cabang) {
      setCabang(cab);
      next.cabang = true;
    }
    // Kontak diisi sebagai satu paket (nama, jabatan, telp, email) bila nama kontak masih kosong.
    if (pic.nama && !kontak) {
      setKontak(pic.nama);
      next.kontak = true;
      if (pic.jabatan && !jabatan) (setJabatan(pic.jabatan), (next.jabatan = true));
      if (pic.email && !email) (setEmail(pic.email), (next.email = true));
    }
    if (pic.phone && !phone) {
      setPhone(pic.phone);
      next.phone = true;
    }
    if (pic.address && !alamat) {
      setAlamat(pic.address);
      next.alamat = true;
    }
    setAuto((a) => ({ ...a, ...next }));
  }
  // Sales yang terakhir menangani customer ini di cabang tujuan — diusulkan bila SE masih kosong.
  const suggestSe = cabang ? history.lastSe[cabang] || '' : '';
  const suggestOk = !!suggestSe && salesOfCabang.some((u) => (u.se || '').toUpperCase() === suggestSe);
  useEffect(() => {
    if (suggestOk && !se) {
      setSe(suggestSe);
      setAuto((a) => ({ ...a, se: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestOk, suggestSe]);

  const bmName = roster.find((u) => u.role === 'bm' && !u.paused && (u.cabang || '').toUpperCase() === cabang)?.name;

  const autoMark = (k: string) => (auto[k] ? <span className="lead-auto" title={tr('Diisi otomatis dari data customer — boleh diubah')}>{tr('otomatis')}</span> : null);
  const unAuto = (k: string) => auto[k] && setAuto((a) => ({ ...a, [k]: false }));
  /** Nama kontak otomatis diganti orang lain: jabatan / telp / email milik kontak lama ikut dikosongkan. */
  function changeKontak(v: string) {
    if (auto.kontak) {
      if (auto.jabatan) setJabatan('');
      if (auto.phone) setPhone('');
      if (auto.email) setEmail('');
      setAuto((a) => ({ ...a, kontak: false, jabatan: false, phone: false, email: false }));
    }
    setKontak(v);
  }

  /** Isi kolom yang masih kosong dari teks inquiry; kebutuhan material ditambahkan. */
  function applyInquiry() {
    const x = parseInquiry(inqText);
    const filled: string[] = [];
    const next: Record<string, boolean> = {};
    const fill = (cur: string, val: string, setter: (v: string) => void, label: string) => {
      if (!cur.trim() && val) {
        setter(val);
        filled.push(label);
        return true;
      }
      return false;
    };
    if (fill(customer, x.customer, setCustomer, tr('customer'))) {
      // Kontak dari inquiry lebih baru — dari data customer cukup cabang (& alamat bila inquiry tanpa alamat).
      const c = known.get(x.customer.trim().toUpperCase());
      if (!x.kontakNama) fillFromCustomer(x.customer);
      else if (c?.cabang && !cabang) {
        setCabang(c.cabang.toUpperCase());
        next.cabang = true;
      }
    }
    if (fill(kontak, x.kontakNama, setKontak, tr('kontak'))) next.kontak = false;
    fill(jabatan, x.kontakJabatan, setJabatan, tr('jabatan'));
    fill(phone, x.phone, setPhone, tr('telepon'));
    fill(email, x.email, setEmail, 'email');
    fill(alamat, x.alamat, setAlamat, tr('alamat'));
    fill(source, x.source, setSource, tr('sumber'));
    if (x.catatan) setCatatan((c) => (c.trim() ? `${c.trim()}\n${x.catatan}` : x.catatan));
    if (x.items.length) {
      const added = x.items.map((s) => {
        const p = parseWithLexicon(s, lex, parseMaterialText);
        return emptyRow({ line: p.line, bentuk: p.bentuk, grade: p.grade, dim: p.dim, pcs: p.pcs || '1', uraianManual: p.bentuk === 'Lainnya' ? s : '' });
      });
      setRows((r) => [...r.filter((row) => rowUraian(row).trim()), ...added]);
      filled.push(`${x.items.length} ${tr('kebutuhan')}`);
    }
    setAuto((a) => ({ ...a, ...next }));
    setInqNote(filled.length ? `${tr('Terisi')}: ${filled.join(', ')}. ${tr('Periksa lagi sebelum dikirim.')}` : tr('Tidak ada data yang terbaca — isi manual.'));
    if (filled.length) setInqOpen(false);
  }

  async function submit() {
    setError('');
    if (!customer.trim()) return setError(tr('Nama customer wajib diisi'));
    if (!cabang) return setError(tr('Pilih cabang tujuan'));
    if (!source) return setError(tr('Pilih sumber lead'));
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(tr('Format email tidak valid'));
    const list = rows.filter((r) => rowUraian(r).trim());
    if (!list.length) return setError(tr('Isi minimal satu kebutuhan material'));
    setBusy(true);
    try {
      const r = await api.post<{ prospect: Prospect; notified?: { bm: number; adminSales: number; rm: number; sales: number } }>('/api/leads', {
        customer,
        phone,
        kontakNama: kontak,
        kontakJabatan: jabatan,
        email,
        address: alamat,
        cabang,
        se,
        source,
        catatan,
        materials: list.map(rowToMaterial),
      });
      upsertProspect(r.prospect);
      const n = r.notified;
      const who = n ? [n.bm && `BM (${n.bm})`, n.adminSales && `Admin Sales (${n.adminSales})`, n.rm && `RM (${n.rm})`, n.sales && `Sales (${n.sales})`].filter(Boolean).join(', ') : 'BM';
      if (n && !n.bm && !n.adminSales && !n.sales) toast(`Lead ${r.prospect.customer} tersimpan, tetapi cabang ${cabang} tidak punya akun BM / Admin Sales aktif${n.rm ? ' — hanya RM yang diberi tahu' : ''}. Cek Kelola User.`, 'error');
      else toast(`Lead ${r.prospect.customer} dikirim ke cabang ${cabang}${se ? ` · SE ${se}` : ''} — diberi tahu: ${who}`, 'success');
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim lead');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr('Tambah Lead')}
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            {tr('Batal')}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? tr('Mengirim…') : tr('Kirim ke cabang')}
          </button>
        </>
      }
    >
      <div className="field-note" style={{ marginTop: 0 }}>
        {tr('Lead masuk ke pipeline cabang tujuan sebagai "Permintaan". BM cabang diberi tahu dan menunjuk Sales bila SE dikosongkan. Anda menerima notifikasi setiap perkembangannya; isi prospek selanjutnya dikelola cabang.')}{' '}
        {tr('Data kontak & alamat juga dicatat ke Kelola Customer: customer baru dibuat lengkap; customer lama hanya dilengkapi kolom yang masih kosong dan kontak baru ditambahkan — data yang sudah ada tidak ditimpa.')}
      </div>
      {error && <div className="auth-error show" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="lead-inq">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setInqOpen((v) => !v)}>
          {inqOpen ? tr('Tutup') : tr('Tempel inquiry (Indotrading / email / WA)')}
        </button>
        {inqNote && <span className="field-note" style={{ margin: 0 }}>{inqNote}</span>}
        {inqOpen && (
          <div className="lead-inq-box">
            <textarea rows={7} value={inqText} onChange={(e) => setInqText(e.target.value)} placeholder={tr('Tempel seluruh isi email / notifikasi inquiry di sini — nama perusahaan, kontak, telepon, email, alamat dan kebutuhan material dibaca otomatis.')} />
            <button type="button" className="btn btn-primary btn-sm" disabled={!inqText.trim()} onClick={applyInquiry}>{tr('Isi otomatis')}</button>
          </div>
        )}
      </div>
      <div className="form-grid lead-grid">
        <div className="full">
          <label>{tr('Customer')} *</label>
          <input type="text" list="leadCustomers" value={customer} onChange={(e) => {
            setCustomer(e.target.value);
            fillFromCustomer(e.target.value);
          }} onBlur={() => fillFromCustomer(customer)} placeholder={tr('Nama perusahaan — pilih dari daftar untuk isi otomatis')} />
          <datalist id="leadCustomers">
            {customers.slice(0, 2000).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          {match && <small className="field-note" style={{ margin: 0 }}>{tr('Customer terdaftar')} · {match.cabang || '-'}{match.segmen ? ` · ${match.segmen}` : ''}</small>}
          {history.open.length > 0 && (
            <div className="lead-open">
              <b>{tr('Sudah ada prospek aktif untuk customer ini')}</b> — {tr('pastikan ini permintaan baru, bukan permintaan yang sama.')}
              <ul>
                {history.open.slice(0, 3).map((p) => (
                  <li key={p.id}>
                    <b>{p.cabang || '-'}</b> · {p.se ? `SE ${p.se}` : tr('SE belum ditunjuk')} · {(p.uraian || '').split(' + ')[0].slice(0, 60)}
                    {(p.uraian || '').includes(' + ') ? ` ${tr('dan item lain')}` : ''}
                  </li>
                ))}
                {history.open.length > 3 && <li>+{history.open.length - 3} {tr('prospek lain')}</li>}
              </ul>
            </div>
          )}
        </div>
        <div>
          <label>{tr('Nama kontak')} {autoMark('kontak')}</label>
          <input type="text" value={kontak} onChange={(e) => changeKontak(e.target.value)} placeholder={tr('cth. Budi Santoso')} />
        </div>
        <div>
          <label>{tr('Jabatan')} {autoMark('jabatan')}</label>
          <input type="text" value={jabatan} onChange={(e) => { setJabatan(e.target.value); unAuto('jabatan'); }} placeholder={tr('cth. Purchasing')} />
        </div>
        <div>
          <label>{tr('No. telp / WhatsApp')} {autoMark('phone')}</label>
          <input type="text" value={phone} onChange={(e) => { setPhone(e.target.value); unAuto('phone'); }} />
        </div>
        <div>
          <label>{tr('Email')} {autoMark('email')}</label>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); unAuto('email'); }} placeholder={tr('cth. purchasing@perusahaan.co.id')} />
        </div>
        <div className="full">
          <label>{tr('Alamat')} {autoMark('alamat')}</label>
          <textarea rows={2} style={{ width: '100%' }} value={alamat} onChange={(e) => { setAlamat(e.target.value); unAuto('alamat'); }} placeholder={tr('Alamat perusahaan / lokasi proyek')} />
        </div>
        <div>
          <label>{tr('Sumber lead')} *</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{tr('— pilih —')}</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s.key} value={s.key}>{tr(s.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{tr('Cabang tujuan')} * {autoMark('cabang')}</label>
          <select value={cabang} onChange={(e) => { setCabang(e.target.value); setSe(''); setAuto((a) => ({ ...a, cabang: false, se: false })); }}>
            <option value="">{tr('— pilih —')}</option>
            {CABANG_LIST.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {cabang && <small className="field-note" style={{ margin: 0 }}>{bmName ? `${tr('BM')}: ${bmName}` : tr('Cabang tanpa BM aktif — RM regional diberi tahu')}</small>}
        </div>
        <div>
          <label>{tr('Sales (opsional)')} {auto.se && se === suggestSe ? <span className="lead-auto" title={tr('Sales yang terakhir menangani customer ini di cabang tujuan')}>{tr('terakhir menangani')}</span> : null}</label>
          <select value={se} onChange={(e) => { setSe(e.target.value); unAuto('se'); }} disabled={!cabang}>
            <option value="">{tr('— biar BM yang menunjuk —')}</option>
            {salesOfCabang.map((u) => (
              <option key={u.id} value={(u.se || '').toUpperCase()}>{(u.se || '').toUpperCase()} · {u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}><div className="full"><label>{tr('Kebutuhan')} *</label></div></div>
      <MaterialSpecEditor variant="lead" rows={rows} onChange={setRows} />

      <div className="form-grid" style={{ marginTop: 12 }}><div className="full"><label>{tr('Catatan untuk cabang')}</label>
      <textarea rows={3} style={{ width: '100%' }} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={tr('cth. butuh penawaran minggu ini, aplikasi liner hopper, link inquiry Indotrading')} />
      </div></div>
    </Modal>
  );
}
