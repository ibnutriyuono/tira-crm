'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Vendor } from '@/lib/types';
import {
  AVL_META,
  INCOTERMS,
  VENDOR_DOC_JENIS,
  VENDOR_TIPE,
  avlOf,
  expiringDocs,
  tipeLabel,
  type AvlStatus,
} from '@/lib/vendor-profile';
import { VR_STATUS_META, fmtDate, type VendorRequest } from '@/lib/vendor-request';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { AttachmentList } from '../AttachmentList';
import { IconEdit, IconPlus, IconSearch, IconTrash } from '../icons';

type Stats = {
  stats: { total: number; dibalas: number; noquote: number; menunggu: number; avgDays: number | null; menang: number; ketepatan: number | null };
  recent: VendorRequest[];
  prices: { grade: string; tebal: string; hpp: number; cur: string; tgl: string; noRfq: string; prev?: number }[];
};

type Draft = Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
const emptyDraft = (): Draft => ({
  nama: '', pic: '', wa: '', email: '', kategori: '', alamat: '', catatan: '',
  tipe: '', asal: '', negara: '', mataUang: 'IDR', incoterm: '', produk: [], tebalMin: null, tebalMax: null,
  moq: '', leadTime: '', syaratBayar: '', pics: [], dokumen: [], statusAvl: 'evaluasi',
});

/**
 * Database Vendor (Purchasing · GM · Admin): profil vendor, grade yang
 * dipasok, syarat dagang, dokumen + masa berlaku, kinerja, dan Approved
 * Vendor List (Aktif / Dalam evaluasi / Diblokir — diblokir perlu GM).
 */
export function VendorDirectory({ readOnly, canDelete, onImport, onExport, onTemplate }: { readOnly: boolean; canDelete: boolean; onImport: () => void; onExport?: () => void; onTemplate?: () => void }) {
  const tr = useT();
  const vendors = useDataStore((s) => s.vendors);
  const upsertVendor = useDataStore((s) => s.upsertVendor);
  const toast = useDataStore((s) => s.toast);
  const role = useDataStore((s) => s.currentUser?.role);
  const boss = role === 'gm' || role === 'admin';
  const today = new Date().toISOString().slice(0, 10);
  const [q, setQ] = useState('');
  const [tipe, setTipe] = useState('');
  const [st, setSt] = useState('');
  const [selId, setSelId] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [ptab, setPtab] = useState<'profil' | 'dokumen' | 'kinerja'>('profil');

  const counts = useMemo(() => {
    const c = { aktif: 0, evaluasi: 0, diblokir: 0, doc: 0 };
    vendors.forEach((v) => {
      c[avlOf(v)]++;
      if (expiringDocs(v, today).length) c.doc++;
    });
    return c;
  }, [vendors, today]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return vendors.filter(
      (v) =>
        (!tipe || v.tipe === tipe) &&
        (!st || avlOf(v) === st) &&
        (!ql || [v.nama, v.pic, v.kategori, v.negara, ...(v.produk || [])].some((x) => (x || '').toLowerCase().includes(ql))),
    );
  }, [vendors, q, tipe, st]);
  const sel = vendors.find((v) => v.id === selId) || null;

  async function save(d: Draft) {
    if (!d.nama.trim()) return toast('Nama vendor wajib diisi', 'error');
    try {
      const { vendor } = d.id ? await api.put<{ vendor: Vendor }>(`/api/vendors/${d.id}`, d) : await api.post<{ vendor: Vendor }>('/api/vendors', d);
      upsertVendor(vendor);
      setEdit(null);
      setSelId(vendor.id);
      toast(d.id ? 'Vendor diperbarui' : vendor.statusAvl === 'evaluasi' ? 'Vendor ditambahkan — menunggu persetujuan GM' : 'Vendor ditambahkan', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="vd">
      <div className="pi-intro">
        <b>{tr("Database Vendor")}</b>
        <span>{tr("Mill, distributor, jasa potong dan ekspedisi — grade yang dipasok, syarat dagang, dokumen dan kinerja.")} <span className="badge slate">🔒 {tr("Hanya Purchasing · GM · Admin")}</span></span>
      </div>
      <div className="pi-kpis">
        <button type="button" className={`pi-kpi ok ${st === 'aktif' ? 'on' : ''}`} onClick={() => setSt(st === 'aktif' ? '' : 'aktif')}><span className="lb">{tr("Vendor aktif")}</span><span className="n">{counts.aktif}</span><span className="sub">{tr("dari")} {vendors.length} {tr("vendor")}</span></button>
        <button type="button" className={`pi-kpi warn ${st === 'evaluasi' ? 'on' : ''}`} onClick={() => setSt(st === 'evaluasi' ? '' : 'evaluasi')}><span className="lb">{tr("Dalam evaluasi")}</span><span className="n">{counts.evaluasi}</span><span className="sub">{tr("menunggu persetujuan GM")}</span></button>
        <div className="pi-kpi none"><span className="lb">{tr("Dokumen segera habis")}</span><span className="n">{counts.doc}</span><span className="sub">{tr("price list / sertifikat ≤ 30 hari")}</span></div>
        <button type="button" className={`pi-kpi bad ${st === 'diblokir' ? 'on' : ''}`} onClick={() => setSt(st === 'diblokir' ? '' : 'diblokir')}><span className="lb">{tr("Diblokir")}</span><span className="n">{counts.diblokir}</span><span className="sub">{tr("tidak muncul di saran vendor")}</span></button>
      </div>

      <div className="toolbar-row">
        <span className="pi-search"><IconSearch /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Cari vendor / grade / produk")} /></span>
        <select value={tipe} onChange={(e) => setTipe(e.target.value)} style={{ maxWidth: 230 }} aria-label={tr("Tipe")}>
          <option value="">{tr("Semua tipe")}</option>
          {VENDOR_TIPE.map((t) => <option key={t.v} value={t.v}>{tr(t.l)}</option>)}
        </select>
        <select value={st} onChange={(e) => setSt(e.target.value)} style={{ maxWidth: 170 }} aria-label={tr("Status")}>
          <option value="">{tr("Semua status")}</option>
          {(Object.keys(AVL_META) as AvlStatus[]).map((k) => <option key={k} value={k}>{tr(AVL_META[k].label)}</option>)}
        </select>
        {!readOnly && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setEdit(emptyDraft()); setSelId(''); }}><IconPlus /> {tr("Tambah Vendor")}</button>}
        {!readOnly && <button type="button" className="btn btn-outline btn-sm" onClick={onImport}>{tr("Import Excel")}</button>}
        {onExport && <button type="button" className="btn btn-outline btn-sm" onClick={onExport}>{tr("Export Excel")}</button>}
        {onTemplate && <button type="button" className="btn btn-outline btn-sm" onClick={onTemplate}>{tr("Unduh Template")}</button>}
        <span className="hint">{shown.length} {tr("dari")} {vendors.length} {tr("vendor")}</span>
      </div>

      <div className={`vd-split ${sel || edit ? 'has' : ''}`}>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          {vendors.length === 0 ? (
            <div className="empty-state" style={{ padding: '34px 10px' }}><h3>{tr("Belum ada vendor")}</h3></div>
          ) : (
            <table className="simple-table vd-table">
              <thead><tr><th>{tr("Vendor")}</th><th>{tr("Tipe · asal")}</th><th>{tr("Grade dipasok")}</th><th>{tr("Lead time")}</th><th>{tr("Status")}</th></tr></thead>
              <tbody>
                {shown.map((v) => {
                  const exp = expiringDocs(v, today);
                  const s = avlOf(v);
                  return (
                    <tr key={v.id} className={`if-row ${selId === v.id ? 'sel' : ''}`} onClick={() => { setSelId(v.id); setEdit(null); setPtab('profil'); }}>
                      <td>
                        <b>{v.nama}</b>
                        <div className="muted">{[v.negara, v.pic].filter(Boolean).join(' · ') || v.kategori || ''}</div>
                        {exp.length > 0 && <div className="vd-warn">⚠ {exp[0].jenis} {exp[0].lewat ? tr('kedaluwarsa') : tr('habis')} {fmtDate(exp[0].berlaku)}</div>}
                      </td>
                      <td>{tr(tipeLabel(v.tipe)) || '-'}{v.asal ? <div className="muted">{v.asal === 'impor' ? tr('Impor') : tr('Lokal')}{v.mataUang ? ` · ${v.mataUang}` : ''}</div> : null}</td>
                      <td>{(v.produk || []).slice(0, 4).map((t) => <span key={t} className="vd-tag">{t}</span>)}{(v.produk || []).length > 4 && <span className="muted"> +{(v.produk || []).length - 4}</span>}</td>
                      <td>{v.leadTime || '-'}</td>
                      <td><span className={`badge ${AVL_META[s].color}`}>{tr(AVL_META[s].label)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {edit && <VendorEditor draft={edit} onCancel={() => setEdit(null)} onSave={save} />}
        {!edit && sel && (
          <VendorDetail
            v={sel}
            ptab={ptab}
            setPtab={setPtab}
            readOnly={readOnly}
            boss={boss}
            canDelete={canDelete}
            onEdit={() => setEdit({ ...emptyDraft(), ...sel })}
            onClose={() => setSelId('')}
          />
        )}
      </div>
    </div>
  );
}

function VendorDetail({ v, ptab, setPtab, readOnly, boss, canDelete, onEdit, onClose }: { v: Vendor; ptab: 'profil' | 'dokumen' | 'kinerja'; setPtab: (t: 'profil' | 'dokumen' | 'kinerja') => void; readOnly: boolean; boss: boolean; canDelete: boolean; onEdit: () => void; onClose: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const upsertVendor = useDataStore((s) => s.upsertVendor);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alasan, setAlasan] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const s = avlOf(v);
  useEffect(() => {
    setStats(null);
    api.get<Stats>(`/api/vendors/${v.id}/stats`).then(setStats).catch(() => {});
  }, [v.id]);

  async function avl(status: AvlStatus) {
    try {
      const r = await api.patch<{ vendor: Vendor }>(`/api/vendors/${v.id}`, { action: 'avl', status, alasan });
      upsertVendor(r.vendor);
      setAlasan('');
      toast(boss ? `Status: ${AVL_META[avlOf(r.vendor)].label}` : 'Usulan dikirim ke GM', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const fact = (l: string, val: React.ReactNode) => (
    <div className="vd-fact"><span>{tr(l)}</span><b>{val || '-'}</b></div>
  );
  return (
    <div className="vd-side">
      <div className="vd-head">
        <div>
          <div className="kam-title" style={{ fontSize: 20 }}>{v.nama}</div>
          <div className="muted">{[tr(tipeLabel(v.tipe)), v.asal === 'impor' ? tr('Impor') : v.asal ? tr('Lokal') : '', v.negara].filter(Boolean).join(' · ')}</div>
        </div>
        <span className={`badge ${AVL_META[s].color}`}>{tr(AVL_META[s].label)}</span>
      </div>
      <div className="sa-pills" style={{ margin: '8px 0' }}>
        {(['profil', 'dokumen', 'kinerja'] as const).map((k) => (
          <button key={k} type="button" className={ptab === k ? 'on' : ''} onClick={() => setPtab(k)}>{k === 'profil' ? tr('Profil') : k === 'dokumen' ? `${tr('Dokumen')} (${(v.dokumen || []).length})` : tr('Kinerja')}</button>
        ))}
      </div>
      {ptab === 'profil' && (
        <div className="vd-facts">
          {fact('Mata uang · Incoterm', [v.mataUang, v.incoterm].filter(Boolean).join(' · '))}
          {fact('Syarat bayar', v.syaratBayar)}
          {fact('MOQ', v.moq)}
          {fact('Lead time standar', v.leadTime)}
          {fact('Grade / produk', (v.produk || []).join(', '))}
          {fact('Rentang tebal (mm)', v.tebalMin != null || v.tebalMax != null ? `${v.tebalMin ?? '…'} – ${v.tebalMax ?? '…'}` : '')}
          {fact('PIC utama', [v.pic, v.wa, v.email].filter(Boolean).join(' · '))}
          {(v.pics || []).map((p, i) => <div key={i}>{fact(`PIC ${i + 2}`, [p.nama, p.jabatan, p.wa, p.email].filter(Boolean).join(' · '))}</div>)}
          {fact('Alamat', v.alamat)}
          {fact('Catatan', v.catatan)}
        </div>
      )}
      {ptab === 'dokumen' && (
        <div>
          <table className="simple-table" style={{ minWidth: 0 }}>
            <thead><tr><th>{tr("Dokumen")}</th><th>{tr("Berlaku s.d.")}</th><th>{tr("Status")}</th></tr></thead>
            <tbody>
              {(v.dokumen || []).length === 0 && <tr><td colSpan={3} className="field-note">{tr("Belum ada dokumen — tambahkan lewat Edit vendor.")}</td></tr>}
              {(v.dokumen || []).map((d) => {
                const lewat = d.berlaku && d.berlaku < today;
                const soon = !lewat && d.berlaku && expiringDocs({ dokumen: [d] }, today).length > 0;
                return (
                  <tr key={d.id}>
                    <td><b>{d.jenis}</b>{d.nomor ? ` · ${d.nomor}` : ''}{d.catatan ? <div className="muted">{d.catatan}</div> : null}</td>
                    <td>{fmtDate(d.berlaku) || '-'}</td>
                    <td><span className={`badge ${lewat ? 'rust' : soon ? 'amber' : 'green'}`}>{lewat ? tr('Kedaluwarsa') : soon ? tr('Segera habis') : d.berlaku ? tr('Berlaku') : tr('Tanpa masa berlaku')}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rq-title">{tr("File (MTC, ISO, NPWP, kontrak, price list)")}</div>
          <AttachmentList vendorId={v.id} readOnly={readOnly} />
        </div>
      )}
      {ptab === 'kinerja' && (
        <div>
          {!stats ? <div className="field-note">{tr("Memuat…")}</div> : (
            <>
              <div className="vd-kpis">
                <div><span>{tr("Diminta harga")}</span><b>{stats.stats.total}</b></div>
                <div><span>{tr("Dibalas")}</span><b>{stats.stats.total ? `${Math.round((stats.stats.dibalas / stats.stats.total) * 100)}%` : '–'}</b></div>
                <div><span>{tr("Rata² balas")}</span><b>{stats.stats.avgDays == null ? '–' : `${stats.stats.avgDays.toFixed(1).replace('.', ',')} hr`}</b></div>
                <div><span>{tr("Dipilih (HPP)")}</span><b>{stats.stats.menang}</b></div>
              </div>
              <div className="rq-title">{tr("Harga beli terakhir per grade (HPP)")}</div>
              {stats.prices.length === 0 ? <div className="field-note">{tr("Belum ada HPP dari vendor ini di jawaban RFQ.")}</div> : (
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <thead><tr><th>{tr("Grade · tebal")}</th><th className="r">{tr("Terakhir")}</th><th>{tr("vs sebelumnya")}</th></tr></thead>
                  <tbody>
                    {stats.prices.map((p, i) => (
                      <tr key={i}>
                        <td>{p.grade}{p.tebal ? ` · ${p.tebal} mm` : ''}<div className="muted">{p.noRfq} · {fmtDate(p.tgl)}</div></td>
                        <td className="r mono">{p.cur} {p.hpp.toLocaleString('id-ID')}</td>
                        <td>{p.prev ? <span className={p.hpp > p.prev ? 'vd-up' : 'vd-down'}>{p.hpp > p.prev ? '▲' : '▼'} {Math.abs(((p.hpp - p.prev) / p.prev) * 100).toFixed(1).replace('.', ',')}%</span> : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="rq-title">{tr("Permintaan harga terakhir")}</div>
              {stats.recent.length === 0 ? <div className="field-note">{tr("Belum pernah dimintai harga.")}</div> : (
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <tbody>{stats.recent.map((r) => <tr key={r.id}><td>{fmtDate(r.tglDiminta)}</td><td><span className={`badge ${VR_STATUS_META[r.status].color}`}>{tr(VR_STATUS_META[r.status].label)}</span></td><td className="muted">{r.balasAt ? `${tr('dibalas')} ${fmtDate(r.balasAt.slice(0, 10))}` : ''}</td></tr>)}</tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      <div className="vd-avl">
        <b>{tr("Approved Vendor List:")}</b> <span className={`badge ${AVL_META[s].color}`}>{tr(AVL_META[s].label)}</span>
        {v.statusAlasan && <div className="muted">{v.statusAlasan}{v.statusOleh ? ` — ${v.statusOleh}` : ''}{v.statusAt ? `, ${fmtDate(v.statusAt.slice(0, 10))}` : ''}</div>}
        {!readOnly && (
          <div className="vd-avl-act">
            <input type="text" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder={boss ? tr('Alasan (wajib untuk blokir)') : tr('Catatan untuk GM')} />
            {boss ? (
              <>
                {s !== 'aktif' && <button type="button" className="btn btn-primary btn-sm" onClick={() => avl('aktif')}>{tr("Setujui (Aktif)")}</button>}
                {s !== 'evaluasi' && <button type="button" className="btn btn-outline btn-sm" onClick={() => avl('evaluasi')}>{tr("Evaluasi")}</button>}
                {s !== 'diblokir' && <button type="button" className="btn btn-outline btn-sm btn-flag" onClick={() => avl('diblokir')}>{tr("Blokir")}</button>}
              </>
            ) : (
              <>
                {s !== 'aktif' && <button type="button" className="btn btn-outline btn-sm" onClick={() => avl('aktif')}>{tr("Ajukan Aktif ke GM")}</button>}
                {s !== 'diblokir' && <button type="button" className="btn btn-outline btn-sm btn-flag" onClick={() => avl('diblokir')}>{tr("Usulkan blokir")}</button>}
              </>
            )}
          </div>
        )}
      </div>
      <div className="toolbar-row" style={{ marginTop: 10, marginBottom: 0 }}>
        {!readOnly && <button type="button" className="btn btn-outline btn-sm" onClick={onEdit}><IconEdit /> {tr("Edit vendor")}</button>}
        {!readOnly && canDelete && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              useUiStore.setState({ deleteCtx: { mode: 'vendor', id: v.id, title: 'Hapus Vendor', message: `Yakin ingin menghapus vendor "${v.nama}"?` } });
              useUiStore.getState().openModal('delete');
            }}
          >
            <IconTrash /> {tr("Hapus")}
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>{tr("Tutup panel")}</button>
      </div>
    </div>
  );
}

function VendorEditor({ draft, onCancel, onSave }: { draft: Draft; onCancel: () => void; onSave: (d: Draft) => void }) {
  const tr = useT();
  const [d, setD] = useState<Draft>(draft);
  const [tags, setTags] = useState((draft.produk || []).join(', '));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const pics = d.pics || [];
  const docs = d.dokumen || [];
  return (
    <div className="vd-side vd-edit">
      <div className="vd-head"><b>{d.id ? tr('Edit vendor') : tr('Tambah vendor')}</b></div>
      <div className="vd-form">
        <label className="full">{tr("Nama vendor *")}<input type="text" value={d.nama} onChange={(e) => set({ nama: e.target.value })} /></label>
        <label>{tr("Tipe")}<select value={d.tipe || ''} onChange={(e) => set({ tipe: e.target.value })}><option value="">-</option>{VENDOR_TIPE.map((t) => <option key={t.v} value={t.v}>{tr(t.l)}</option>)}</select></label>
        <label>{tr("Lokal / impor")}<select value={d.asal || ''} onChange={(e) => set({ asal: e.target.value })}><option value="">-</option><option value="lokal">{tr("Lokal")}</option><option value="impor">{tr("Impor")}</option></select></label>
        <label>{tr("Negara")}<input type="text" value={d.negara || ''} onChange={(e) => set({ negara: e.target.value })} /></label>
        <label>{tr("Mata uang")}<select value={d.mataUang || 'IDR'} onChange={(e) => set({ mataUang: e.target.value })}>{['IDR', 'USD', 'EUR', 'SGD', 'CNY', 'JPY'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>{tr("Incoterm")}<input type="text" list="vd-inco" value={d.incoterm || ''} onChange={(e) => set({ incoterm: e.target.value })} placeholder="CIF Tj. Priok" /></label>
        <datalist id="vd-inco">{INCOTERMS.map((x) => <option key={x} value={x} />)}</datalist>
        <label className="full">{tr("Grade / produk yang dipasok (pisahkan koma)")}<input type="text" value={tags} onChange={(e) => { setTags(e.target.value); set({ produk: e.target.value.split(/[,;]+/).map((x) => x.trim()).filter(Boolean) }); }} placeholder="Creusabro 8000, SS 316L, HQ 705" /></label>
        <label>{tr("Tebal min (mm)")}<input type="number" step="any" value={d.tebalMin ?? ''} onChange={(e) => set({ tebalMin: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>{tr("Tebal maks (mm)")}<input type="number" step="any" value={d.tebalMax ?? ''} onChange={(e) => set({ tebalMax: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>{tr("MOQ")}<input type="text" value={d.moq || ''} onChange={(e) => set({ moq: e.target.value })} placeholder={tr("cth. 20 ton / order")} /></label>
        <label>{tr("Lead time standar")}<input type="text" value={d.leadTime || ''} onChange={(e) => set({ leadTime: e.target.value })} placeholder={tr("cth. 10–12 mgg")} /></label>
        <label className="full">{tr("Syarat bayar")}<input type="text" value={d.syaratBayar || ''} onChange={(e) => set({ syaratBayar: e.target.value })} placeholder={tr("cth. L/C 60 hari")} /></label>
        <label>{tr("PIC utama")}<input type="text" value={d.pic || ''} onChange={(e) => set({ pic: e.target.value })} /></label>
        <label>{tr("Kategori (lama)")}<input type="text" value={d.kategori || ''} onChange={(e) => set({ kategori: e.target.value })} /></label>
        <label>{tr("WhatsApp")}<input type="text" value={d.wa || ''} onChange={(e) => set({ wa: e.target.value })} /></label>
        <label>{tr("Email")}<input type="text" value={d.email || ''} onChange={(e) => set({ email: e.target.value })} /></label>
        <div className="full vd-sub">
          <b>{tr("PIC lain")}</b>
          {pics.map((p, i) => (
            <div key={i} className="vd-row">
              <input type="text" value={p.nama} placeholder={tr("Nama")} onChange={(e) => set({ pics: pics.map((x, j) => (j === i ? { ...x, nama: e.target.value } : x)) })} />
              <input type="text" value={p.jabatan || ''} placeholder={tr("Jabatan")} onChange={(e) => set({ pics: pics.map((x, j) => (j === i ? { ...x, jabatan: e.target.value } : x)) })} />
              <input type="text" value={p.wa || ''} placeholder="WA" onChange={(e) => set({ pics: pics.map((x, j) => (j === i ? { ...x, wa: e.target.value } : x)) })} />
              <input type="text" value={p.email || ''} placeholder="Email" onChange={(e) => set({ pics: pics.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} />
              <button type="button" className="icon-btn danger" onClick={() => set({ pics: pics.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => set({ pics: [...pics, { nama: '' }] })}>+ {tr("PIC")}</button>
        </div>
        <div className="full vd-sub">
          <b>{tr("Dokumen & masa berlaku")}</b>
          {docs.map((x, i) => (
            <div key={x.id} className="vd-row">
              <select value={x.jenis} onChange={(e) => set({ dokumen: docs.map((y, j) => (j === i ? { ...y, jenis: e.target.value } : y)) })}>{VENDOR_DOC_JENIS.map((j) => <option key={j}>{j}</option>)}</select>
              <input type="text" value={x.nomor || ''} placeholder={tr("Nomor")} onChange={(e) => set({ dokumen: docs.map((y, j) => (j === i ? { ...y, nomor: e.target.value } : y)) })} />
              <input type="date" value={x.berlaku || ''} onChange={(e) => set({ dokumen: docs.map((y, j) => (j === i ? { ...y, berlaku: e.target.value } : y)) })} aria-label={tr("Berlaku s.d.")} />
              <input type="text" value={x.catatan || ''} placeholder={tr("Catatan")} onChange={(e) => set({ dokumen: docs.map((y, j) => (j === i ? { ...y, catatan: e.target.value } : y)) })} />
              <button type="button" className="icon-btn danger" onClick={() => set({ dokumen: docs.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => set({ dokumen: [...docs, { id: `d${Date.now().toString(36)}`, jenis: 'Price list' }] })}>+ {tr("Dokumen")}</button>
          <div className="field-note" style={{ margin: 0 }}>{tr("File dokumen diunggah di tab Dokumen setelah vendor disimpan.")}</div>
        </div>
        <label className="full">{tr("Alamat")}<input type="text" value={d.alamat || ''} onChange={(e) => set({ alamat: e.target.value })} /></label>
        <label className="full">{tr("Catatan")}<textarea rows={2} value={d.catatan || ''} onChange={(e) => set({ catatan: e.target.value })} /></label>
      </div>
      {!d.id && <div className="field-note">{tr("Vendor baru berstatus Dalam evaluasi sampai disetujui GM.")}</div>}
      <div className="toolbar-row" style={{ marginTop: 8, marginBottom: 0 }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>{tr("Batal")}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(d)}>{tr("Simpan")}</button>
      </div>
    </div>
  );
}
