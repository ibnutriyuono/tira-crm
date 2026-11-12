'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { CABANG_LIST } from '@/lib/constants';
import { getProspectMaterials, materialUnitPrice, num, todayStr } from '@/lib/format';
import { GRADE_SUGGESTIONS } from '@/lib/material-spec';
import { requiredLevel } from '@/lib/margin-tier';
import { sameCompany } from '@/lib/customer-names';
import {
  CAKUPAN_LABEL, guessGrade, matDims, JENIS_HINT, JENIS_LABEL, SATUAN_SPEK, SKEMA_HINT, SKEMA_LABEL, defaultAkhir, dimLabel, itemDiscLines, kontrakMaxDisc,
  type Kontrak, type KontrakCakupan, type KontrakItem, type KontrakJenis, type KontrakSkema,
} from '@/lib/kontrak';
import type { CustomerGroup, Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { levelLabel, pct, rp } from './shared';

interface DimDraft { id: string; tebal: string; lebar: string; panjang: string; harga: string; acuan: string; acuanSrc: string }
interface AcuanDraft { label: string; tebal: string; acuan: string; src: string }
interface ItemDraft {
  key: string;
  cakupan: KontrakCakupan;
  grade: string;
  bentuk: string;
  tebalMin: string;
  tebalMax: string;
  dims: DimDraft[];
  nama: string;
  spesifikasi: string;
  partNo: string;
  kategori: string;
  satuan: string;
  harga: string;
  acuan: AcuanDraft[];
  /** Ton untuk baja, satuan untuk non-katalog. */
  qty: string;
  materialBaru: boolean;
  vendorBerlaku: string;
  keep?: Partial<KontrakItem>;
}
interface Draft {
  jenis: KontrakJenis;
  skemaHarga: KontrakSkema;
  skemaCatatan: string;
  groupId: string;
  grupNama: string;
  entitas: string[];
  cabangs: string[];
  tglMulai: string;
  tglAkhir: string;
  noCustomer: string;
  top: string;
  franco: string;
  catatan: string;
  prevId: string | null;
  prospectId: string | null;
  items: ItemDraft[];
}

let seq = 0;
const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: string) => {
  const x = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};
/** Angka harga diketik dengan titik ribuan; dimensi dengan koma desimal. */
const nd = (v: string) => {
  const x = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};
const fmtN = (v: number | null | undefined) => (v == null ? '' : Math.round(v).toLocaleString('id-ID'));

function emptyItem(over: Partial<ItemDraft> = {}): ItemDraft {
  return { key: key(), cakupan: 'grade', grade: '', bentuk: 'Plate', tebalMin: '', tebalMax: '', dims: [], nama: '', spesifikasi: '', partNo: '', kategori: '', satuan: 'pcs', harga: '', acuan: [], qty: '', materialBaru: false, vendorBerlaku: '', ...over };
}
const emptyDim = (over: Partial<DimDraft> = {}): DimDraft => ({ id: key(), tebal: '', lebar: '', panjang: '', harga: '', acuan: '', acuanSrc: '', ...over });

function fromKontrak(k: Kontrak): Draft {
  return {
    jenis: k.jenis, skemaHarga: k.skemaHarga, skemaCatatan: s(k.skemaCatatan), groupId: s(k.groupId), grupNama: k.grupNama, entitas: [...k.entitas], cabangs: [...k.cabangs], tglMulai: k.tglMulai, tglAkhir: k.tglAkhir,
    noCustomer: s(k.noCustomer), top: s(k.top), franco: s(k.franco), catatan: s(k.catatan), prevId: k.prevId, prospectId: k.prospectId,
    items: k.items.map((it) => ({
      key: it.id, cakupan: it.cakupan, grade: s(it.grade), bentuk: s(it.bentuk) || 'Plate', tebalMin: s(it.tebalMin), tebalMax: s(it.tebalMax),
      dims: it.dims.map((d) => ({ id: d.id, tebal: s(d.tebal), lebar: s(d.lebar), panjang: s(d.panjang), harga: fmtN(d.harga), acuan: fmtN(d.acuan), acuanSrc: s(d.acuanSrc) })),
      nama: s(it.nama), spesifikasi: s(it.spesifikasi), partNo: s(it.partNo), kategori: s(it.kategori), satuan: it.satuan === 'kg' ? 'pcs' : it.satuan, harga: fmtN(it.harga),
      acuan: it.acuan.map((a) => ({ label: a.label, tebal: s(a.tebal), acuan: fmtN(a.acuan), src: s(a.src) })),
      qty: it.qtyKomitmen == null ? '' : String(it.satuan === 'kg' ? Math.round((it.qtyKomitmen / 1000) * 100) / 100 : it.qtyKomitmen).replace('.', ','),
      materialBaru: it.materialBaru, vendorBerlaku: s(it.vendorBerlaku),
      keep: { saldoQty: it.saldoQty, saldoNilai: it.saldoNilai, saldoTgl: it.saldoTgl, saldoKet: it.saldoKet },
    })),
  };
}

function groupOf(groups: CustomerGroup[], name: string): CustomerGroup | undefined {
  return groups.find((g) => [g.name, ...(g.entities || [])].some((e) => e && sameCompany(e, name)));
}

/** Item kontrak dari material prospek: baja dikelompokkan per grade (dimensi tertentu), lainnya non-katalog. */
function itemsFromProspect(p: Prospect): ItemDraft[] {
  type M = ReturnType<typeof getProspectMaterials>[number] & { grade?: string; bentuk?: string; dim?: Record<string, unknown>; satuan?: string; fabNama?: string };
  const mats = getProspectMaterials(p) as M[];
  const byGrade = new Map<string, ItemDraft>();
  const out: ItemDraft[] = [];
  mats.forEach((m) => {
    const dm = matDims(m as never);
    const d = { tebal: dm.tebal ?? '', lebar: dm.lebar ?? '', panjang: dm.panjang ?? '' };
    const gr = String(m.grade || '').trim() || guessGrade(m.uraian);
    if (gr && dm.tebal != null) {
      const g = gr;
      let it = byGrade.get(g.toUpperCase());
      if (!it) {
        it = emptyItem({ cakupan: 'dimensi', grade: g, bentuk: m.bentuk || 'Plate', qty: '0' });
        byGrade.set(g.toUpperCase(), it);
        out.push(it);
      }
      const hk = num(m.hargaKg) > 0 ? num(m.hargaKg) : num(m.beratPc) > 0 && num(m.harga) > 0 ? num(m.harga) / num(m.beratPc) : 0;
      it.dims.push(emptyDim({ tebal: s(d.tebal), lebar: s(d.lebar), panjang: s(d.panjang), harga: hk ? fmtN(hk) : '' }));
      const ton = (num(m.qty) * num(m.beratPc)) / 1000;
      it.qty = String(Math.round(((n(it.qty) || 0) + ton) * 100) / 100).replace('.', ',');
    } else {
      out.push(emptyItem({ cakupan: 'spek', nama: String(m.uraian || m.fabNama || '').trim(), satuan: SATUAN_SPEK.includes(String(m.satuan)) ? String(m.satuan) : 'pcs', harga: fmtN(materialUnitPrice(m)), qty: String(num(m.qty) || ''), materialBaru: true, kategori: 'Non-baja' }));
    }
  });
  return out;
}

/** Form kontrak (baru, ubah draft, adendum cakupan kontrak aktif, perpanjangan, dari prospek / customer). */
export function KontrakForm({ kontrak, prospectId, customer, cabang, onSaved, onCancel }: {
  kontrak: Kontrak | null;
  prospectId?: string | null;
  customer?: string | null;
  cabang?: string | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const groups = useDataStore((st) => st.customerGroups);
  const customers = useDataStore((st) => st.customers);
  const prospects = useDataStore((st) => st.prospects);
  const me = useDataStore((st) => st.currentUser);
  const rules = useDataStore((st) => st.opsRules);
  const toast = useDataStore((st) => st.toast);

  const [d, setD] = useState<Draft>(() => {
    if (kontrak) return fromKontrak(kontrak);
    const mulai = todayStr();
    const base: Draft = {
      jenis: 'hq', skemaHarga: 'tetap', skemaCatatan: '', groupId: '', grupNama: '', entitas: [], cabangs: me?.cabang ? [me.cabang.toUpperCase()] : [], tglMulai: mulai, tglAkhir: defaultAkhir(mulai),
      noCustomer: '', top: '', franco: '', catatan: '', prevId: null, prospectId: prospectId || null, items: [emptyItem()],
    };
    const p = prospectId ? prospects.find((x) => x.id === prospectId) : undefined;
    const cust = p?.customer || customer || '';
    if (cust) {
      const g = groupOf(groups, cust);
      base.groupId = g?.id || '';
      base.grupNama = g?.name || cust;
      base.entitas = [cust];
      const c = (p?.cabang || cabang || '').toUpperCase();
      if (c && !base.cabangs.includes(c)) base.cabangs = [c, ...base.cabangs.filter((x) => x !== c)];
    }
    if (p) {
      const its = itemsFromProspect(p);
      if (its.length) base.items = its;
      base.noCustomer = p.noPo || '';
      base.catatan = `Dari prospek ${p.customer}${p.noPo ? ` · ${p.noPo}` : ''}`;
    }
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState('');
  const [rfqAcuan, setRfqAcuan] = useState<{ label: string; acuan: number; uom: string; src: string }[] | null>(null);

  const locked = !!kontrak && !['draft', 'ditolak'].includes(kontrak.status);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setItem = (k: string, p: Partial<ItemDraft>) => setD((x) => ({ ...x, items: x.items.map((it) => (it.key === k ? { ...it, ...p } : it)) }));
  const setDim = (k: string, id: string, p: Partial<DimDraft>) => setD((x) => ({ ...x, items: x.items.map((it) => (it.key === k ? { ...it, dims: it.dims.map((dd) => (dd.id === id ? { ...dd, ...p } : dd)) } : it)) }));
  const group = groups.find((g) => g.id === d.groupId);
  const entOptions = Array.from(new Set([...(group ? (group.entities?.length ? group.entities : [group.name]) : []), ...d.entitas]));

  // Kontrak sementara dari isian — untuk diskon & tingkat persetujuan.
  const asKontrak = useMemo(() => ({
    jenis: d.jenis,
    items: d.items.map((it, i) => ({
      id: it.key, urut: i, cakupan: it.cakupan, grade: it.grade, gradeKey: null, bentuk: it.bentuk, tebalMin: nd(it.tebalMin), tebalMax: nd(it.tebalMax),
      dims: it.dims.map((x) => ({ id: x.id, tebal: nd(x.tebal), lebar: nd(x.lebar), panjang: nd(x.panjang), harga: n(x.harga), acuan: n(x.acuan), acuanSrc: x.acuanSrc })),
      nama: it.nama, spesifikasi: it.spesifikasi, partNo: it.partNo, kategori: it.kategori, satuan: it.cakupan === 'spek' ? it.satuan : 'kg', harga: n(it.harga),
      acuan: it.acuan.map((a) => ({ label: a.label, tebal: nd(a.tebal), acuan: n(a.acuan) || 0, src: a.src })).filter((a) => a.acuan > 0),
      qtyKomitmen: null, materialBaru: it.materialBaru, vendorBerlaku: it.vendorBerlaku || null, saldoQty: 0, saldoNilai: 0, saldoTgl: null, saldoKet: null,
    })) as KontrakItem[],
  }), [d.jenis, d.items]);
  const maxDisc = kontrakMaxDisc(asKontrak);
  const level = maxDisc != null && maxDisc > rules.discSe + 1e-9 ? requiredLevel(maxDisc, rules) : null;
  const pasokan = d.items.some((i) => i.materialBaru);
  const lvOf = (disc: number | null) => (disc == null ? null : disc > rules.discSe + 1e-9 ? requiredLevel(disc, rules) : '');

  function pickGroup(id: string) {
    const g = groups.find((x) => x.id === id);
    if (!g) return set({ groupId: '', grupNama: '', entitas: [] });
    const ents = g.entities?.length ? g.entities : [g.name];
    const cabs = Array.from(new Set([g.homeCabang, ...(g.supportCabang || [])].filter(Boolean).map((c) => String(c).toUpperCase())));
    set({ groupId: g.id, grupNama: g.name, entitas: ents, cabangs: cabs.length ? cabs : d.cabangs });
  }
  function addEntitas() {
    const v = extra.trim();
    if (!v) return;
    set({ entitas: Array.from(new Set([...d.entitas, v])), grupNama: d.grupNama || v });
    setExtra('');
  }

  async function ambilAcuan(it: ItemDraft) {
    if (!it.grade.trim()) return toast(tr('Isi grade dulu'), 'error');
    try {
      if (it.cakupan === 'grade') {
        const q = new URLSearchParams({ grade: it.grade, ...(it.tebalMin ? { min: it.tebalMin.replace(',', '.') } : {}), ...(it.tebalMax ? { max: it.tebalMax.replace(',', '.') } : {}) });
        const r = await api.get<{ rows: { tebal: number; acuan: number; src: string }[] }>(`/api/kontrak/acuan?${q}`);
        if (!r.rows.length) return toast(tr('Belum ada jawaban RFQ / stok untuk grade ini — isi acuan manual.'), 'error');
        setItem(it.key, { acuan: r.rows.map((x) => ({ label: `tebal ${String(x.tebal).replace('.', ',')} mm`, tebal: String(x.tebal), acuan: fmtN(x.acuan), src: x.src })) });
        toast(`${r.rows.length} ${tr('dimensi acuan')}`, 'success');
      } else {
        let found = 0;
        const dims = await Promise.all(it.dims.map(async (x) => {
          if (!x.tebal) return x;
          const q = new URLSearchParams({ grade: it.grade, tebal: x.tebal.replace(',', '.'), ...(it.cakupan === 'dimensi' && x.lebar ? { lebar: x.lebar.replace(',', '.') } : {}), ...(it.cakupan === 'dimensi' && x.panjang ? { panjang: x.panjang.replace(',', '.') } : {}) });
          const r = await api.get<{ rows: { acuan: number; src: string }[] }>(`/api/kontrak/acuan?${q}`);
          if (!r.rows[0]) return x;
          found++;
          return { ...x, acuan: fmtN(r.rows[0].acuan), acuanSrc: r.rows[0].src };
        }));
        setItem(it.key, { dims });
        toast(found ? `${tr('Acuan terisi')}: ${found}/${it.dims.length}` : tr('Belum ada jawaban RFQ / stok untuk dimensi ini — isi acuan manual.'), found ? 'success' : 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengambil acuan', 'error');
    }
  }
  async function loadRfqAcuan() {
    if (!d.prospectId) return;
    try {
      const r = await api.get<{ rows: { label: string; acuan: number; uom: string; src: string }[] }>(`/api/kontrak/acuan?prospectId=${d.prospectId}`);
      setRfqAcuan(r.rows);
      if (!r.rows.length) toast(tr('Prospek ini belum punya jawaban RFQ dengan harga jual.'), 'error');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    }
  }

  function body() {
    return {
      ...d,
      groupId: d.groupId || null,
      items: d.items.map((it) => ({
        cakupan: it.cakupan, grade: it.grade, bentuk: it.bentuk, tebalMin: it.tebalMin, tebalMax: it.tebalMax,
        dims: it.dims.map((x) => ({ id: x.id, tebal: nd(x.tebal), lebar: nd(x.lebar), panjang: nd(x.panjang), harga: n(x.harga), acuan: n(x.acuan), acuanSrc: x.acuanSrc })),
        nama: it.nama, spesifikasi: it.spesifikasi, partNo: it.partNo, kategori: it.kategori, satuan: it.satuan, harga: n(it.harga),
        acuan: it.acuan.map((a) => ({ label: a.label, tebal: nd(a.tebal), acuan: n(a.acuan), src: a.src })),
        qtyKomitmen: it.qty ? (nd(it.qty) || 0) * (it.cakupan === 'spek' ? 1 : 1000) : null,
        materialBaru: it.materialBaru, vendorBerlaku: it.vendorBerlaku || null,
        ...(it.keep || {}),
      })),
    };
  }

  async function save(ajukan: boolean) {
    setBusy(true);
    try {
      const res = kontrak ? await api.put<{ kontrak: Kontrak }>(`/api/kontrak/${kontrak.id}`, body()) : await api.post<{ kontrak: Kontrak }>('/api/kontrak', body());
      if (ajukan) {
        const r2 = await api.patch<{ kontrak: Kontrak }>(`/api/kontrak/${res.kontrak.id}`, { action: 'ajukan' });
        toast(r2.kontrak.status === 'aktif' ? `${r2.kontrak.nomor} ${tr('aktif')}` : `${r2.kontrak.nomor} ${tr('diajukan untuk persetujuan')}`, 'success');
      } else toast(`${res.kontrak.nomor} ${tr('tersimpan')}`, 'success');
      onSaved(res.kontrak.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  const showHarga = d.jenis !== 'qty';
  const showQty = d.jenis !== 'harga';
  const totTon = d.items.filter((i) => i.cakupan !== 'spek').reduce((a, i) => a + (nd(i.qty) || 0), 0);

  return (
    <div className="kt kt-form">
      {kontrak?.prevId && <div className="kt-note warm">{tr('Perpanjangan')}: {tr('customer, cabang, dan item disalin dari kontrak sebelumnya. Perbarui harga acuan (Ambil acuan) supaya diskon dihitung dari harga jual terbaru.')}</div>}
      {d.prospectId && !kontrak && <div className="kt-note">{tr('Dibuat dari prospek')} <b>{prospects.find((x) => x.id === d.prospectId)?.customer}</b> · {tr('item, harga, dan customer terisi dari prospek. Lengkapi periode, dokumen, dan komitmen.')}</div>}
      {locked && <div className="kt-note warm">{tr('Kontrak sudah diajukan / aktif: yang bisa diubah hanya cakupan (entitas, cabang) dan keterangan — dicatat sebagai adendum. Perubahan harga / item: buat perpanjangan.')}</div>}

      <section>
        <h3 className="kt-h">1 · {tr('Jenis kontrak')}</h3>
        <div className="kt-cards">
          {(['harga', 'qty', 'hq'] as KontrakJenis[]).map((j) => (
            <button key={j} type="button" disabled={locked} className={`kt-card${d.jenis === j ? ' on' : ''}`} onClick={() => set({ jenis: j })} aria-pressed={d.jenis === j}>
              <b>{JENIS_LABEL[j]}</b><span>{tr(JENIS_HINT[j])}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="kt-h">2 · {tr('Customer & cabang')}</h3>
        <div className="kt-grid2">
          <div className="kt-col">
            <label className="kt-f"><span>{tr('Grup customer')}</span>
              <select value={d.groupId} onChange={(e) => pickGroup(e.target.value)}>
                <option value="">{tr('— tanpa grup (satu customer) —')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            {!d.groupId && (
              <label className="kt-f"><span>{tr('Nama kontrak / customer utama')}</span>
                <input list="kt-cust" value={d.grupNama} onChange={(e) => set({ grupNama: e.target.value, entitas: d.entitas.length <= 1 ? (e.target.value ? [e.target.value] : []) : d.entitas })} placeholder={tr('cth. PT Contoh Tambang Nusantara')} />
              </label>
            )}
            <span className="kt-l">{tr('Entitas yang terikat kontrak')}</span>
            <div className="kt-checks">
              {entOptions.length === 0 && <span className="muted">{tr('Pilih grup atau tambah entitas.')}</span>}
              {entOptions.map((e) => (
                <label key={e}><input type="checkbox" checked={d.entitas.includes(e)} onChange={() => set({ entitas: d.entitas.includes(e) ? d.entitas.filter((x) => x !== e) : [...d.entitas, e] })} />{e}</label>
              ))}
            </div>
            <div className="kt-inline">
              <input list="kt-cust" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={tr('Tambah entitas (nama customer)')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEntitas(); } }} />
              <button type="button" className="btn btn-outline btn-sm" onClick={addEntitas}>{tr('Tambah')}</button>
            </div>
            <datalist id="kt-cust">{customers.slice(0, 2000).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </div>
          <div className="kt-col">
            <span className="kt-l">{tr('Berlaku di cabang')}</span>
            <div className="kt-cabpick">
              {CABANG_LIST.map((c) => (
                <button key={c} type="button" className={`cf-chip${d.cabangs.includes(c) ? ' on' : ''}`} onClick={() => set({ cabangs: d.cabangs.includes(c) ? d.cabangs.filter((x) => x !== c) : [...d.cabangs, c] })}>{c}</button>
              ))}
            </div>
            <div className="field-note">{tr('Pengingat & realisasi dikirim ke Admin Sales, BM, dan Sales tiap cabang yang dipilih.')}</div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="kt-h">3 · {tr('Periode & syarat')}</h3>
        <div className="kt-row">
          <label className="kt-f"><span>{tr('No kontrak customer')}</span><input value={d.noCustomer} onChange={(e) => set({ noCustomer: e.target.value })} maxLength={80} /></label>
          <label className="kt-f"><span>{tr('Mulai')}</span><input type="date" disabled={locked} value={d.tglMulai} onChange={(e) => set({ tglMulai: e.target.value, tglAkhir: d.tglAkhir === defaultAkhir(d.tglMulai) ? defaultAkhir(e.target.value) : d.tglAkhir })} /></label>
          <label className="kt-f"><span>{tr('Berakhir')} <small className="muted">({tr('default +12 bulan')})</small></span><input type="date" disabled={locked} value={d.tglAkhir} onChange={(e) => set({ tglAkhir: e.target.value })} /></label>
          <label className="kt-f"><span>{tr('Syarat bayar')}</span><input value={d.top} onChange={(e) => set({ top: e.target.value })} placeholder="TOP 45 hari" maxLength={60} /></label>
          <label className="kt-f"><span>Franco</span><input value={d.franco} onChange={(e) => set({ franco: e.target.value })} placeholder={tr('Site customer')} maxLength={120} /></label>
        </div>
        <label className="kt-f"><span>{tr('Catatan')}</span><input value={d.catatan} onChange={(e) => set({ catatan: e.target.value })} maxLength={1000} placeholder={tr('cth. lokasi dokumen kontrak, syarat khusus, eskalasi harga')} /></label>
      </section>

      {showHarga && (
        <section>
          <h3 className="kt-h">4 · {tr('Skema harga')}</h3>
          <div className="kt-cards">
            {(['tetap', 'tinjau', 'kurs'] as KontrakSkema[]).map((k) => (
              <button key={k} type="button" disabled={locked} className={`kt-card${d.skemaHarga === k ? ' on' : ''}`} onClick={() => set({ skemaHarga: k })} aria-pressed={d.skemaHarga === k}>
                <b>{SKEMA_LABEL[k]}</b><span>{tr(SKEMA_HINT[k])}</span>
              </button>
            ))}
          </div>
          {d.skemaHarga !== 'tetap' && <label className="kt-f"><span>{d.skemaHarga === 'kurs' ? tr('Harga dasar & kurs acuan') : tr('Jadwal tinjau')}</span><input value={d.skemaCatatan} onChange={(e) => set({ skemaCatatan: e.target.value })} placeholder={d.skemaHarga === 'kurs' ? 'USD 3,85/kg · kurs dasar 15.900' : tr('tiap 6 bulan (Jul 2027)')} maxLength={300} /></label>}
        </section>
      )}

      <section>
        <div className="kt-hrow">
          <h3 className="kt-h">5 · {tr('Item kontrak')}</h3>
          {!locked && (
            <div className="row-actions">
              {d.prospectId && <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadRfqAcuan()}>{tr('Ambil harga jual dari RFQ prospek')}</button>}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ items: [...d.items, emptyItem()] })}>{tr('+ Item grade')}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ items: [...d.items, emptyItem({ cakupan: 'spek', materialBaru: true, kategori: 'Non-baja' })] })}>{tr('+ Material non-katalog')}</button>
            </div>
          )}
        </div>
        <div className="field-note" style={{ marginTop: 0 }}>{tr('Item = grade material dengan cakupan dimensi. Saat PO, aturan paling spesifik dipakai dulu: dimensi lengkap → tebal → semua dimensi. Material di luar katalog (mis. gasket) memakai spesifikasi + part number customer.')}</div>
        <fieldset disabled={locked} className="kt-fs">
          {d.items.map((it, i) => {
            const lines = itemDiscLines(asKontrak.items[i]);
            return (
              <div key={it.key} className={`kt-item${it.cakupan === 'spek' ? ' spek' : ''}`}>
                <div className="kt-item-h">
                  {it.cakupan !== 'spek' ? (
                    <label className="kt-f"><span>{tr('Item')} {i + 1} · grade</span><input list="kt-grade" value={it.grade} onChange={(e) => setItem(it.key, { grade: e.target.value })} style={{ fontWeight: 700, width: 150 }} /></label>
                  ) : (
                    <label className="kt-f"><span>{tr('Item')} {i + 1} · {tr('nama material')}</span><input value={it.nama} onChange={(e) => setItem(it.key, { nama: e.target.value })} style={{ fontWeight: 700, minWidth: 240 }} /></label>
                  )}
                  <div className="kt-f"><span>{tr('Cakupan')}</span>
                    <div className="seg-switch kt-seg">
                      {(['grade', 'tebal', 'dimensi', 'spek'] as KontrakCakupan[]).map((c) => (
                        <button key={c} type="button" className={it.cakupan === c ? 'on' : ''} onClick={() => setItem(it.key, { cakupan: c, dims: (c === 'tebal' || c === 'dimensi') && !it.dims.length ? [emptyDim()] : it.dims, materialBaru: c === 'spek' ? true : it.materialBaru })}>{tr(CAKUPAN_LABEL[c])}</button>
                      ))}
                    </div>
                  </div>
                  {showQty && (
                    <label className="kt-f"><span>{tr('Komitmen / thn')}</span><span className="kt-inline"><input value={it.qty} onChange={(e) => setItem(it.key, { qty: e.target.value })} style={{ width: 90, textAlign: 'right' }} className="mono" /><small>{it.cakupan === 'spek' ? it.satuan : tr('ton')}</small></span></label>
                  )}
                  <button type="button" className="btn btn-outline btn-sm danger" style={{ alignSelf: 'flex-end' }} onClick={() => set({ items: d.items.filter((x) => x.key !== it.key) })}>{tr('Hapus')}</button>
                </div>

                {it.cakupan === 'grade' && (
                  <div className="kt-item-b">
                    <div className="kt-row">
                      <label className="kt-f"><span>{tr('Rentang tebal (opsional)')}</span><span className="kt-inline"><input value={it.tebalMin} onChange={(e) => setItem(it.key, { tebalMin: e.target.value })} style={{ width: 60 }} aria-label={tr('Tebal minimum')} />–<input value={it.tebalMax} onChange={(e) => setItem(it.key, { tebalMax: e.target.value })} style={{ width: 60 }} aria-label={tr('Tebal maksimum')} /><small>mm · {tr('lebar & panjang bebas')}</small></span></label>
                      {showHarga && <label className="kt-f"><span>{tr('Harga kontrak')}</span><span className="kt-inline"><input className="mono" value={it.harga} onChange={(e) => setItem(it.key, { harga: e.target.value })} style={{ width: 110, textAlign: 'right' }} /><small>Rp/kg, {tr('semua dimensi')}</small></span></label>}
                      {showHarga && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => void ambilAcuan(it)}>{tr('Ambil acuan (RFQ & stok)')}</button>}
                    </div>
                    {showHarga && (
                      <table className="simple-table kt-mini">
                        <thead><tr><th>{tr('Dimensi acuan')}</th><th className="r">{tr('Harga acuan')}</th><th className="r">{tr('Diskon')}</th><th>{tr('Persetujuan')}</th><th /></tr></thead>
                        <tbody>
                          {it.acuan.map((a, j) => {
                            const l = lines[j];
                            const lv = lvOf(l?.disc ?? null);
                            return (
                              <tr key={j}>
                                <td><input value={a.label} onChange={(e) => setItem(it.key, { acuan: it.acuan.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} style={{ width: 140 }} /> <small className="muted">{a.src}</small></td>
                                <td className="r"><input className="mono" value={a.acuan} onChange={(e) => setItem(it.key, { acuan: it.acuan.map((x, k) => (k === j ? { ...x, acuan: e.target.value, src: x.src && !x.src.startsWith('manual') ? `manual (semula ${x.src})` : 'manual' } : x)) })} style={{ width: 100, textAlign: 'right' }} /></td>
                                <td className="r mono"><b>{pct(l?.disc)}</b></td>
                                <td>{lv == null ? '-' : <span className={`badge ${lv === '' ? 'green' : lv === 'bm' ? 'steel' : lv === 'gm' ? 'amber' : 'rust'}`}>{lv === '' ? tr('tanpa persetujuan') : levelLabel(lv)}</span>}</td>
                                <td><button type="button" className="link-btn" onClick={() => setItem(it.key, { acuan: it.acuan.filter((_, k) => k !== j) })}>×</button></td>
                              </tr>
                            );
                          })}
                          <tr><td colSpan={5}><button type="button" className="link-btn" onClick={() => setItem(it.key, { acuan: [...it.acuan, { label: 'tebal … mm', tebal: '', acuan: '', src: 'manual' }] })}>+ {tr('acuan manual')}</button></td></tr>
                        </tbody>
                      </table>
                    )}
                    {showHarga && <div className="field-note">{tr('Satu harga per kg untuk semua dimensi, jadi diskon tiap dimensi berbeda. Persetujuan mengikuti diskon tertinggi.')}</div>}
                  </div>
                )}

                {(it.cakupan === 'tebal' || it.cakupan === 'dimensi') && (
                  <div className="kt-item-b">
                    <table className="simple-table kt-mini">
                      <thead><tr><th>{it.cakupan === 'tebal' ? tr('Tebal (mm) · lebar & panjang bebas') : tr('Tebal × lebar × panjang (mm)')}</th>{showHarga && <><th className="r">{tr('Harga acuan')}</th><th className="r">{tr('Harga kontrak /kg')}</th><th className="r">{tr('Diskon')}</th><th>{tr('Persetujuan')}</th></>}<th /></tr></thead>
                      <tbody>
                        {it.dims.map((x, j) => {
                          const l = lines[j];
                          const lv = lvOf(l?.disc ?? null);
                          return (
                            <tr key={x.id}>
                              <td>
                                <span className="kt-inline">
                                  <input value={x.tebal} onChange={(e) => setDim(it.key, x.id, { tebal: e.target.value })} style={{ width: 54 }} aria-label="tebal" />
                                  {it.cakupan === 'dimensi' && <>×<input value={x.lebar} onChange={(e) => setDim(it.key, x.id, { lebar: e.target.value })} style={{ width: 66 }} aria-label="lebar" />×<input value={x.panjang} onChange={(e) => setDim(it.key, x.id, { panjang: e.target.value })} style={{ width: 66 }} aria-label="panjang" /></>}
                                </span>
                              </td>
                              {showHarga && (
                                <>
                                  <td className="r"><input className="mono" value={x.acuan} onChange={(e) => setDim(it.key, x.id, { acuan: e.target.value, acuanSrc: 'manual' })} style={{ width: 100, textAlign: 'right' }} /><div className="kt-sub">{x.acuanSrc}</div></td>
                                  <td className="r"><input className="mono" value={x.harga} onChange={(e) => setDim(it.key, x.id, { harga: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                                  <td className="r mono"><b>{pct(l?.disc)}</b></td>
                                  <td>{lv == null ? '-' : <span className={`badge ${lv === '' ? 'green' : lv === 'bm' ? 'steel' : lv === 'gm' ? 'amber' : 'rust'}`}>{lv === '' ? tr('tanpa persetujuan') : levelLabel(lv)}</span>}</td>
                                </>
                              )}
                              <td><button type="button" className="link-btn" aria-label={tr('Hapus')} onClick={() => setItem(it.key, { dims: it.dims.filter((y) => y.id !== x.id) })}>×</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="row-actions">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setItem(it.key, { dims: [...it.dims, emptyDim()] })}>{it.cakupan === 'tebal' ? tr('+ Tambah tebal') : tr('+ Tambah dimensi')}</button>
                      {showHarga && <button type="button" className="btn btn-outline btn-sm" onClick={() => void ambilAcuan(it)}>{tr('Ambil acuan (RFQ & stok)')}</button>}
                    </div>
                  </div>
                )}

                {it.cakupan === 'spek' && (
                  <div className="kt-item-b">
                    <div className="kt-row">
                      <label className="kt-f"><span>{tr('Part number customer')} <small className="muted">· {tr('kunci pencocokan PO')}</small></span><input className="mono" value={it.partNo} onChange={(e) => setItem(it.key, { partNo: e.target.value })} style={{ width: 200 }} /></label>
                      <label className="kt-f"><span>{tr('Satuan')}</span><select value={it.satuan} onChange={(e) => setItem(it.key, { satuan: e.target.value })}>{SATUAN_SPEK.map((x) => <option key={x}>{x}</option>)}</select></label>
                      <label className="kt-f"><span>{tr('Kategori produk')}</span><input value={it.kategori} onChange={(e) => setItem(it.key, { kategori: e.target.value })} placeholder="Non-baja · Gasket" style={{ width: 170 }} /></label>
                      <label className="kt-f kt-chk"><input type="checkbox" checked={it.materialBaru} onChange={(e) => setItem(it.key, { materialBaru: e.target.checked })} />{tr('Material baru (belum pernah dijual)')}</label>
                    </div>
                    <label className="kt-f"><span>{tr('Spesifikasi')}</span><input value={it.spesifikasi} onChange={(e) => setItem(it.key, { spesifikasi: e.target.value })} maxLength={500} /></label>
                    {showHarga && (
                      <div className="kt-row">
                        <label className="kt-f"><span>{tr('Harga acuan (harga jual Purchasing)')}</span><span className="kt-inline"><input className="mono" value={it.acuan[0]?.acuan || ''} onChange={(e) => setItem(it.key, { acuan: [{ label: it.nama, tebal: '', acuan: e.target.value, src: it.acuan[0]?.src || 'manual' }] })} style={{ width: 110, textAlign: 'right' }} /><small>/ {it.satuan}</small></span></label>
                        {rfqAcuan && rfqAcuan.length > 0 && (
                          <label className="kt-f"><span>{tr('Dari RFQ prospek')}</span>
                            <select value="" onChange={(e) => { const r = rfqAcuan[Number(e.target.value)]; if (r) setItem(it.key, { acuan: [{ label: it.nama, tebal: '', acuan: fmtN(r.acuan), src: r.src }] }); }}>
                              <option value="">{tr('— pilih —')}</option>
                              {rfqAcuan.map((r, k) => <option key={k} value={k}>{r.label} · {rp(r.acuan)}/{r.uom.toLowerCase()} · {r.src.replace('harga jual Purchasing · ', '')}</option>)}
                            </select>
                          </label>
                        )}
                        <label className="kt-f"><span>{tr('Harga kontrak')}</span><span className="kt-inline"><input className="mono" value={it.harga} onChange={(e) => setItem(it.key, { harga: e.target.value })} style={{ width: 110, textAlign: 'right' }} /><small>/ {it.satuan}</small></span></label>
                        <div className="kt-f"><span>{tr('Diskon')}</span><b className="mono" style={{ lineHeight: '34px' }}>{pct(lines[0]?.disc)}</b></div>
                        <label className="kt-f"><span>{tr('Harga vendor berlaku s.d.')}</span><input type="date" value={it.vendorBerlaku} onChange={(e) => setItem(it.key, { vendorBerlaku: e.target.value })} /></label>
                      </div>
                    )}
                    {showHarga && it.vendorBerlaku && it.vendorBerlaku < d.tglAkhir && (
                      <div className="kt-note bad">{tr('Harga vendor berlaku s.d.')} {it.vendorBerlaku}, {tr('kontrak s.d.')} {d.tglAkhir}: {tr('sisa periode tanpa jaminan harga beli. Pertimbangkan skema ditinjau berkala / ikut kurs, atau minta Purchasing memperpanjang harga vendor.')}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        <datalist id="kt-grade">{GRADE_SUGGESTIONS.map((g) => <option key={g} value={g} />)}</datalist>
        {showQty && totTon > 0 && <div className="field-note">{tr('Total komitmen baja')} <b className="mono">{String(Math.round(totTon * 100) / 100).replace('.', ',')} t</b> · {tr('komitmen dihitung per item, gabungan semua dimensi di dalamnya')}</div>}
      </section>

      <div className={`kt-appr${level || pasokan ? ' need' : ''}`}>
        <div>
          {showHarga ? (
            <b>{maxDisc == null ? tr('Isi harga & acuan untuk menghitung persetujuan') : level ? `${tr('Diskon tertinggi')} ${pct(maxDisc)} → ${tr('perlu persetujuan')} ${levelLabel(level)}` : `${tr('Diskon tertinggi')} ${pct(maxDisc)} → ${tr('tanpa persetujuan diskon')}`}</b>
          ) : (
            <b>{tr('Kontrak qty: tidak perlu persetujuan diskon (harga tiap PO lewat Surat Penawaran).')}</b>
          )}
          <span>{tr('Batas')}: {tr('tanpa persetujuan')} ≤ {rules.discSe}% · BM ≤ {rules.discBm}% · GM ≤ {rules.discGm}% · VP ≤ {rules.discVp}%. {pasokan ? tr('Ada material baru → persetujuan kesiapan pasokan GM Operation.') : ''} {tr('PO yang memakai harga kontrak tidak perlu persetujuan diskon lagi.')}</span>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel}>{tr('Batal')}</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void save(false)}>{locked ? tr('Simpan adendum') : tr('Simpan draft')}</button>
          {!locked && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>{level || pasokan ? `${tr('Ajukan ke')} ${[level ? levelLabel(level) : '', pasokan ? 'GM Operation' : ''].filter(Boolean).join(' & ')}` : tr('Simpan & aktifkan')}</button>}
        </div>
      </div>
    </div>
  );
}

export { dimLabel };
