'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { CABANG_LIST } from '@/lib/constants';
import { LEAD_SOURCES } from '@/lib/leads';
import type { Prospect, RosterUser } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';
import { Modal } from '../Modal';
import { IconPlus, IconTrash } from '../icons';

interface Item {
  key: number;
  uraian: string;
  qty: string;
}
let seq = 0;
const blankItem = (): Item => ({ key: seq++, uraian: '', qty: '' });

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
  const [cabang, setCabang] = useState('');
  const [se, setSe] = useState('');
  const [source, setSource] = useState('');
  const [items, setItems] = useState<Item[]>([blankItem()]);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [roster, setRoster] = useState<RosterUser[]>([]);

  useEffect(() => {
    if (!show) return;
    const pre = useUiStore.getState().leadPrefill;
    useUiStore.setState({ leadPrefill: null });
    const preCust = pre ? useDataStore.getState().customers.find((c) => c.name.trim().toUpperCase() === pre.customer.trim().toUpperCase()) : undefined;
    setCustomer(pre?.customer || '');
    setPhone(preCust?.phone || '');
    setKontak('');
    setCabang((pre?.cabang || '').toUpperCase());
    setSe('');
    setSource(pre?.source || '');
    setItems([blankItem()]);
    setCatatan('');
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
  const bmName = roster.find((u) => u.role === 'bm' && !u.paused && (u.cabang || '').toUpperCase() === cabang)?.name;

  const upd = (key: number, patch: Partial<Item>) => setItems((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function submit() {
    setError('');
    if (!customer.trim()) return setError(tr('Nama customer wajib diisi'));
    if (!cabang) return setError(tr('Pilih cabang tujuan'));
    if (!source) return setError(tr('Pilih sumber lead'));
    const list = items.filter((x) => x.uraian.trim());
    if (!list.length) return setError(tr('Isi minimal satu kebutuhan material'));
    setBusy(true);
    try {
      const r = await api.post<{ prospect: Prospect }>('/api/leads', {
        customer,
        phone,
        kontak,
        cabang,
        se,
        source,
        catatan,
        items: list.map((x) => ({ uraian: x.uraian, qty: Number(x.qty) || 0 })),
      });
      upsertProspect(r.prospect);
      toast(`Lead ${r.prospect.customer} dikirim ke cabang ${cabang}${se ? ` · SE ${se}` : ''} — BM diberi tahu`, 'success');
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
        {tr('Lead masuk ke pipeline cabang tujuan sebagai "Permintaan". BM cabang diberi tahu dan menunjuk Sales bila SE dikosongkan. Anda menerima notifikasi setiap perkembangannya; isi prospek selanjutnya dikelola cabang.')}
      </div>
      {error && <div className="auth-error show" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="form-grid lead-grid">
        <div className="full">
          <label>{tr('Customer')} *</label>
          <input type="text" list="leadCustomers" value={customer} onChange={(e) => {
            setCustomer(e.target.value);
            const c = known.get(e.target.value.trim().toUpperCase());
            if (c?.cabang && !cabang) setCabang(c.cabang.toUpperCase());
            if (c?.phone && !phone) setPhone(c.phone);
          }} placeholder={tr('Nama perusahaan')} />
          <datalist id="leadCustomers">
            {customers.slice(0, 2000).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          {match && <small className="field-note" style={{ margin: 0 }}>{tr('Customer terdaftar')} · {match.cabang || '-'}{match.segmen ? ` · ${match.segmen}` : ''}</small>}
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
          <label>{tr('Kontak (nama / jabatan)')}</label>
          <input type="text" value={kontak} onChange={(e) => setKontak(e.target.value)} placeholder={tr('cth. Budi — Purchasing')} />
        </div>
        <div>
          <label>{tr('No. telp / WhatsApp')}</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label>{tr('Cabang tujuan')} *</label>
          <select value={cabang} onChange={(e) => { setCabang(e.target.value); setSe(''); }}>
            <option value="">{tr('— pilih —')}</option>
            {CABANG_LIST.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {cabang && <small className="field-note" style={{ margin: 0 }}>{bmName ? `${tr('BM')}: ${bmName}` : tr('Cabang tanpa BM aktif — RM regional diberi tahu')}</small>}
        </div>
        <div>
          <label>{tr('Sales (opsional)')}</label>
          <select value={se} onChange={(e) => setSe(e.target.value)} disabled={!cabang}>
            <option value="">{tr('— biar BM yang menunjuk —')}</option>
            {salesOfCabang.map((u) => (
              <option key={u.id} value={(u.se || '').toUpperCase()}>{(u.se || '').toUpperCase()} · {u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}><div className="full"><label>{tr('Kebutuhan')} *</label></div></div>
      <table className="simple-table lead-items">
        <thead>
          <tr>
            <th>{tr('Material / spesifikasi')}</th>
            <th style={{ width: 110 }}>{tr('Qty (pcs)')}</th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.key}>
              <td>
                <input type="text" value={x.uraian} onChange={(e) => upd(x.key, { uraian: e.target.value })} placeholder={tr('cth. Pelat Creusabro 8000 t20 x 2000 x 6000')} />
              </td>
              <td>
                <input type="number" min={0} value={x.qty} onChange={(e) => upd(x.key, { qty: e.target.value })} />
              </td>
              <td>
                <button type="button" className="icon-btn danger" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((y) => y.key !== x.key))} aria-label={tr('Hapus baris')}>
                  <IconTrash />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => setItems((l) => [...l, blankItem()])}>
        <IconPlus /> {tr('Tambah baris')}
      </button>

      <div className="form-grid" style={{ marginTop: 12 }}><div className="full"><label>{tr('Catatan untuk cabang')}</label>
      <textarea rows={3} style={{ width: '100%' }} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={tr('cth. butuh penawaran minggu ini, aplikasi liner hopper, link inquiry Indotrading')} />
      </div></div>
    </Modal>
  );
}
