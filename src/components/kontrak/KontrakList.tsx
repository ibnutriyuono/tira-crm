'use client';

import { useMemo, useState } from 'react';
import { JENIS_LABEL, SKEMA_LABEL, dayDiffStr, kontrakState, waktuBerjalan, type Kontrak, type KontrakState } from '@/lib/kontrak';
import { todayStr } from '@/lib/format';
import { useT } from '@/store/useLangStore';
import { useDataStore } from '@/store/useDataStore';
import { canNow } from '@/hooks/useCan';
import { ProgBar, StateBadge, fmtQty, levelLabel, pct, rp, tgl, totals } from './shared';

export type KontrakRow = Kontrak & { canDecide?: boolean };

type F = '' | 'aktif' | 'akanHabis' | 'menunggu' | 'draft' | 'habis' | 'lain';

/** Daftar Kontrak Harga: ringkasan yang bisa diklik, filter, dan tabel kontrak. */
export function KontrakList({ rows, canEdit, loading, onOpen, onNew, onCari, onPerpanjang }: {
  rows: KontrakRow[];
  canEdit: boolean;
  loading: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onCari: (id: string) => void;
  onPerpanjang: (id: string) => void;
}) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const today = todayStr();
  const [f, setF] = useState<F>('');
  const [jenis, setJenis] = useState('');
  const [cab, setCab] = useState('');
  const [q, setQ] = useState('');

  const withState = useMemo(() => rows.map((k) => ({ k, s: kontrakState(k, today) as KontrakState })), [rows, today]);
  const inF = (s: KontrakState, ff: F) =>
    ff === '' ? true : ff === 'aktif' ? s === 'aktif' || s === 'akanHabis' || s === 'belum' : ff === 'lain' ? s === 'ditolak' || s === 'batal' : s === ff;
  const base = withState.filter(({ k }) => (!jenis || k.jenis === jenis) && (!cab || k.cabangs.includes(cab)));
  const shown = base.filter(({ k, s }) => {
    if (!inF(s, f)) return false;
    const ql = q.trim().toLowerCase();
    if (!ql) return true;
    const hay = [k.nomor, k.noCustomer, k.grupNama, ...k.entitas, ...k.cabangs, ...k.items.map((i) => `${i.grade || ''} ${i.nama || ''} ${i.partNo || ''}`)].join(' ').toLowerCase();
    return hay.includes(ql);
  });
  const cnt = (ff: F) => base.filter(({ s }) => inF(s, ff)).length;
  const aktif = base.filter(({ s }) => s === 'aktif' || s === 'akanHabis');
  const tot = aktif.reduce((a, { k }) => { const t = totals(k); return { kom: a.kom + t.kom, pakai: a.pakai + t.pakai, nilai: a.nilai + t.nilai }; }, { kom: 0, pakai: 0, nilai: 0 });
  const tertinggal = aktif.filter(({ k }) => { const t = totals(k); return t.kom > 0 && t.pakai / t.kom < waktuBerjalan(k, today) - 0.1; }).length;
  const soon = base.filter(({ s }) => s === 'akanHabis').sort((a, b) => a.k.tglAkhir.localeCompare(b.k.tglAkhir));
  const cabs = Array.from(new Set(rows.flatMap((k) => k.cabangs))).sort();

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const head = ['No Kontrak', 'No Kontrak Customer', 'Grup / Customer', 'Entitas', 'Cabang', 'Jenis', 'Skema Harga', 'Mulai', 'Berakhir', 'Status', 'Komitmen (t)', 'Realisasi (t)', 'Nilai Realisasi', 'Persetujuan'];
    const data = shown.map(({ k, s }) => {
      const t = totals(k);
      return [k.nomor, k.noCustomer || '', k.grupNama, k.entitas.join('; '), k.cabangs.join(', '), JENIS_LABEL[k.jenis], SKEMA_LABEL[k.skemaHarga], k.tglMulai, k.tglAkhir, s, t.kom / 1000, t.pakai / 1000, Math.round(t.nilai), levelLabel(k.level)];
    });
    const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kontrak');
    XLSX.writeFile(wb, `CRM_Kontrak_Harga_${today}.xlsx`);
    toast(`Export: ${data.length} kontrak`, 'success');
  }

  const tile = (ff: F, cls: string, label: string, value: string | number, foot: string) => (
    <button type="button" className={`kpi ${cls} rq-tile${f === ff && ff ? ' on' : ''}`} onClick={() => setF(f === ff ? '' : ff)} aria-pressed={f === ff}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="foot">{foot}</div>
    </button>
  );

  return (
    <div className="kt">
      <div className="kpi-grid rq-kpis">
        {tile('aktif', 'aktif', tr('Kontrak aktif'), aktif.length, `${cnt('menunggu')} ${tr('menunggu persetujuan')}`)}
        {tile('akanHabis', 'pending', tr('Akan habis ≤ 90 hari'), soon.length, soon[0] ? `${soon[0].k.nomor} · ${dayDiffStr(today, soon[0].k.tglAkhir)} ${tr('hari lagi')}` : tr('tidak ada'))}
        {tile('menunggu', 'git', tr('Menunggu persetujuan'), cnt('menunggu'), tr('diskon / pasokan material baru'))}
        <div className="kpi rate"><div className="label">{tr('Realisasi komitmen qty')}</div><div className="value">{tot.kom ? `${fmtQty(tot.pakai, 'kg')} / ${fmtQty(tot.kom, 'kg')}` : '-'}</div><div className="foot">{tot.kom ? `${Math.round((tot.pakai / tot.kom) * 100)}%` : ''}{tertinggal ? ` · ${tertinggal} ${tr('kontrak tertinggal')}` : ''}</div></div>
        <div className="kpi won"><div className="label">{tr('Nilai realisasi kontrak aktif')}</div><div className="value">{rp(tot.nilai)}</div><div className="foot">{tr('PO terhubung + realisasi awal')}</div></div>
      </div>

      <div className="toolbar-row rq-filters">
        {canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>{tr('+ Kontrak Baru')}</button>}
        <div className="kt-chips" role="group" aria-label={tr('Status')}>
          {([['', tr('Semua')], ['aktif', tr('Aktif')], ['akanHabis', tr('Akan habis')], ['menunggu', tr('Menunggu')], ['draft', tr('Draft')], ['habis', tr('Habis')], ['lain', tr('Ditolak / batal')]] as [F, string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" className={`cf-chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} <span className="muted">{k ? cnt(k) : base.length}</span></button>
          ))}
        </div>
        <select value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label={tr('Jenis kontrak')}>
          <option value="">{tr('Semua jenis')}</option>
          {(['harga', 'qty', 'hq'] as const).map((j) => <option key={j} value={j}>{JENIS_LABEL[j]}</option>)}
        </select>
        {cabs.length > 1 && (
          <select value={cab} onChange={(e) => setCab(e.target.value)} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua cabang')}</option>
            {cabs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <input type="search" className="rq-search" placeholder={tr('Cari no kontrak, grup / entitas, material, part number…')} value={q} onChange={(e) => setQ(e.target.value)} />
        {canNow('kontrak', 'x') && <button type="button" className="btn btn-outline btn-sm" onClick={() => void exportExcel()}>{tr('Export Excel')}</button>}
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: 30 }}><p>{tr('Memuat kontrak…')}</p></div>
      ) : shown.length === 0 ? (
        <div className="empty-state" style={{ padding: 30 }}>
          <h3>{rows.length ? tr('Tidak ada kontrak yang cocok') : tr('Belum ada kontrak')}</h3>
          <p>{rows.length ? tr('Coba ubah filter atau kata kunci.') : canEdit ? tr('Klik "+ Kontrak Baru", atau "Jadikan kontrak" dari prospek yang menang tender.') : tr('Kontrak diinput oleh Admin Sales.')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table kt-table">
            <thead>
              <tr>
                <th>{tr('No kontrak')}</th>
                <th>{tr('Customer / grup')}</th>
                <th>{tr('Cabang')}</th>
                <th>{tr('Jenis')}</th>
                <th style={{ minWidth: 170 }}>{tr('Periode · sisa')}</th>
                <th style={{ minWidth: 160 }}>{tr('Realisasi')}</th>
                <th>{tr('Persetujuan')}</th>
                <th>{tr('Status')}</th>
                <th>{tr('Aksi')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ k, s }) => {
                const t = totals(k);
                const wb = waktuBerjalan(k, today);
                const sisa = dayDiffStr(today, k.tglAkhir);
                const late = t.kom > 0 && t.pakai / t.kom < wb - 0.1 && (s === 'aktif' || s === 'akanHabis');
                return (
                  <tr key={k.id}>
                    <td><button type="button" className="link-btn mono" onClick={() => onOpen(k.id)}><b>{k.nomor}</b></button>{k.noCustomer && <div className="kt-sub">{k.noCustomer}</div>}</td>
                    <td><b>{k.grupNama}</b><div className="kt-sub">{k.entitas.length} {tr('entitas')}{k.entitas.length <= 2 ? `: ${k.entitas.join(', ')}` : ''}</div></td>
                    <td><div className="kt-cabs">{k.cabangs.map((c) => <span key={c}>{c}</span>)}</div></td>
                    <td><span className={`badge ${k.jenis === 'hq' ? 'steel' : 'slate'}`}>{JENIS_LABEL[k.jenis]}</span>{k.jenis !== 'qty' && <div className="kt-sub">{SKEMA_LABEL[k.skemaHarga]}</div>}</td>
                    <td>
                      <div className="kt-sub" style={{ color: 'inherit' }}>{tgl(k.tglMulai)} – {tgl(k.tglAkhir)}</div>
                      <ProgBar value={wb} />
                      <div className={`kt-sub${s === 'akanHabis' ? ' warn' : ''}`}>{s === 'habis' ? `${tr('habis')} ${-sisa} ${tr('hari lalu')}` : s === 'belum' ? `${tr('mulai')} ${tgl(k.tglMulai)}` : `${tr('sisa')} ${sisa} ${tr('hari')}`}{k.nextNomor ? ` · ${tr('perpanjangan')} ${k.nextNomor}` : ''}</div>
                    </td>
                    <td>
                      {t.kom > 0 ? (
                        <>
                          <b className="mono">{fmtQty(t.pakai, 'kg')} / {fmtQty(t.kom, 'kg')}</b>
                          <ProgBar value={t.pakai / t.kom} time={wb} late={late} />
                          <div className={`kt-sub${late ? ' bad' : ''}`}>{Math.round((t.pakai / t.kom) * 100)}%{late ? ` · ${tr('tertinggal')}` : ''} · {rp(t.nilai)}</div>
                        </>
                      ) : (
                        <><b className="mono">{rp(t.nilai)}</b><div className="kt-sub">{k.poCount || 0} PO{t.otherUnits ? ` · ${tr('non-katalog')}` : ''}</div></>
                      )}
                    </td>
                    <td className="kt-sub" style={{ color: 'inherit' }}>{k.status === 'draft' ? '-' : levelLabel(k.level)}{k.maxDiscount != null && <div className="kt-sub">{tr('diskon maks')} {pct(k.maxDiscount)}</div>}{k.butuhPasokan && <div className="kt-sub">+ {tr('pasokan')}</div>}</td>
                    <td><StateBadge state={s} />{k.canDecide && <div><span className="badge violet">{tr('perlu keputusan Anda')}</span></div>}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(k.id)}>{tr('Buka')}</button>
                        {canEdit && (s === 'aktif' || s === 'akanHabis' || s === 'habis') && <button type="button" className="btn btn-outline btn-sm" onClick={() => onCari(k.id)}>{tr('Cari realisasi')}</button>}
                        {canEdit && (s === 'akanHabis' || s === 'habis') && !k.nextId && <button type="button" className="btn btn-plan btn-sm" onClick={() => onPerpanjang(k.id)}>{tr('Perpanjang')}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="rq-count">{tr('Menampilkan')} <b>{shown.length}</b> {tr('dari')} {rows.length} {tr('kontrak')} · {tr('Kontrak yang lewat tanggal berakhir otomatis Habis dan tidak lagi dipakai saat PO dibuat.')}</div>
    </div>
  );
}
