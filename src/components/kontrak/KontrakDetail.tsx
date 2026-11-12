'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { STATUS_META } from '@/lib/constants';
import {
  JENIS_LABEL, SKEMA_LABEL, dayDiffStr, dimLabel, itemCakupanText, itemDiscLines, itemTitle, kontrakState, waktuBerjalan,
  type Kontrak, type KontrakLinkView,
} from '@/lib/kontrak';
import { todayStr } from '@/lib/format';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { ProgBar, StateBadge, fmtQty, levelLabel, pct, rp, rpKg, tgl, totals } from './shared';

export interface KontrakDetailData {
  kontrak: Kontrak;
  links: KontrakLinkView[];
  logs: { id: string; aksi: string; ket: string | null; byName: string | null; at: string }[];
  prev: { id: string; nomor: string } | null;
  next: { id: string; nomor: string; status: string } | null;
  need: { maxDisc: number | null; level: string | null; butuhPasokan: boolean; missing: string[] } | null;
  canEdit: boolean;
  canDelete: boolean;
  canDecide: Record<string, boolean>;
}

const REM = [90, 60, 30, 7];

/** Detail kontrak: kepala, persetujuan, item & realisasi, PO terhubung, pengingat, riwayat. */
export function KontrakDetail({ data, onReload, onEdit, onCari, onOpen, onDeleted }: {
  data: KontrakDetailData;
  onReload: () => void;
  onEdit: () => void;
  onCari: () => void;
  onOpen: (id: string) => void;
  onDeleted: () => void;
}) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const { kontrak: k, links, logs, canEdit, canDecide } = data;
  const today = todayStr();
  const st = kontrakState(k, today);
  const wb = waktuBerjalan(k, today);
  const t = totals(k);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [cab, setCab] = useState('');
  const [batal, setBatal] = useState(false);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const r = await api.patch<{ kontrak?: Kontrak; id?: string }>(`/api/kontrak/${k.id}`, body);
      toast(ok, 'success');
      if (body.action === 'perpanjang' && r.id) onOpen(r.id);
      else onReload();
      setNote('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function unlink(l: KontrakLinkView) {
    if (!window.confirm(`${tr('Lepas')} ${l.noPo || 'PO'} · ${l.label} ${tr('dari kontrak ini?')}`)) return;
    try {
      await api.del(`/api/kontrak/${k.id}/link`, { linkId: l.id });
      toast(tr('Dilepas dari kontrak'), 'success');
      onReload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    }
  }
  async function del() {
    if (!window.confirm(`${tr('Hapus draft')} ${k.nomor}?`)) return;
    try {
      await api.del(`/api/kontrak/${k.id}`);
      toast(`${k.nomor} ${tr('dihapus')}`, 'success');
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    }
  }
  const openProspect = (id: string) => { useUiStore.getState().closeModal(); useUiStore.setState({ deskPanelId: id }); };

  const decidable = k.approvals.filter((a) => a.status === 'menunggu' && canDecide[a.jenis]);
  const shownLinks = links.filter((l) => !cab || (l.cabang || '').toUpperCase() === cab);
  const linkCabs = Array.from(new Set(links.map((l) => (l.cabang || '').toUpperCase()).filter(Boolean)));
  const bedaCount = links.filter((l) => l.beda != null && Math.abs(l.beda) > 0.3).length;

  return (
    <div className="kt kt-detail">
      <div className="kt-dhead">
        <div>
          <div className="kt-dtitle"><b className="mono">{k.nomor}</b><span className="badge steel">{JENIS_LABEL[k.jenis]}</span><StateBadge state={st} />{(st === 'aktif' || st === 'akanHabis') && <span className={`badge ${st === 'akanHabis' ? 'amber' : 'slate'}`}>{dayDiffStr(today, k.tglAkhir)} {tr('hari lagi')}</span>}</div>
          <div className="kt-dname">{k.grupNama}</div>
          <div className="kt-sub">{k.noCustomer ? `${tr('No kontrak customer')} ${k.noCustomer} · ` : ''}{tr('input')} {k.createdByName}, {tgl(k.createdAt)}{data.prev ? <> · {tr('perpanjangan dari')} <button type="button" className="link-btn" onClick={() => onOpen(data.prev!.id)}>{data.prev.nomor}</button></> : null}</div>
        </div>
        <div className="row-actions">
          {canEdit && ['draft', 'ditolak'].includes(k.status) && <button type="button" className="btn btn-outline btn-sm" onClick={onEdit}>{tr('Edit')}</button>}
          {canEdit && ['draft', 'ditolak'].includes(k.status) && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act({ action: 'ajukan' }, tr('Diajukan'))}>{data.need?.level || data.need?.butuhPasokan ? tr('Ajukan persetujuan') : tr('Aktifkan')}</button>}
          {data.canDelete && <button type="button" className="btn btn-outline btn-sm danger" onClick={() => void del()}>{tr('Hapus draft')}</button>}
          {canEdit && ['aktif', 'menunggu'].includes(k.status) && <button type="button" className="btn btn-outline btn-sm" onClick={onEdit}>{tr('Adendum cakupan')}</button>}
          {canEdit && k.status === 'aktif' && <button type="button" className="btn btn-outline btn-sm" onClick={onCari}>{tr('Cari realisasi & realisasi awal')}</button>}
          {canEdit && k.status === 'aktif' && !data.next && <button type="button" className="btn btn-plan btn-sm" disabled={busy} onClick={() => void act({ action: 'perpanjang' }, tr('Draft perpanjangan dibuat'))}>{tr('Perpanjang')}</button>}
          {data.next && <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(data.next!.id)}>{tr('Perpanjangan')} {data.next.nomor}</button>}
          {canEdit && !['batal', 'draft'].includes(k.status) && <button type="button" className="btn btn-outline btn-sm danger" onClick={() => setBatal((v) => !v)}>{tr('Batalkan')}</button>}
        </div>
      </div>

      {batal && (
        <div className="kt-note bad kt-inline">
          <input style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Alasan pembatalan kontrak')} />
          <button type="button" className="btn btn-outline btn-sm danger" disabled={busy} onClick={() => void act({ action: 'batal', catatan: note }, tr('Kontrak dibatalkan'))}>{tr('Batalkan kontrak')}</button>
        </div>
      )}

      {data.need && data.need.missing.length > 0 && k.jenis !== 'qty' && <div className="kt-note warm">{tr('Harga acuan belum ada untuk')}: {data.need.missing.slice(0, 6).join('; ')}. {tr('Edit → Ambil acuan, atau isi acuan manual.')}</div>}

      {decidable.length > 0 && (
        <div className="kt-decide">
          {decidable.map((a) => (
            <div key={a.jenis}>
              <b>{a.jenis === 'pasokan' ? tr('Persetujuan kesiapan pasokan material baru') : `${tr('Persetujuan diskon')} · ${tr('diskon maks')} ${pct(k.maxDiscount)} (${levelLabel(a.level)})`}</b>
              <span className="muted">{a.jenis === 'pasokan' ? tr('Konfirmasi vendor sanggup memasok qty & spesifikasi selama periode kontrak.') : tr('Harga kontrak dibanding harga jual acuan per item tercantum di bawah.')}</span>
              <div className="kt-inline">
                <input style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Catatan (wajib bila menolak)')} />
                <button type="button" className="btn btn-outline btn-sm danger" disabled={busy} onClick={() => void act({ action: 'tolak', jenis: a.jenis, catatan: note }, tr('Ditolak'))}>{tr('Tolak')}</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act({ action: 'setuju', jenis: a.jenis, catatan: note }, tr('Disetujui'))}>{tr('Setujui')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="kt-cards4">
        <div className="kt-box"><small>{tr('Entitas customer')}</small><div>{k.entitas.map((e) => <div key={e}>{e}</div>)}</div></div>
        <div className="kt-box"><small>{tr('Berlaku di cabang')}</small><div className="kt-cabs">{k.cabangs.map((c) => <span key={c}>{c}{c === k.cabang ? ' ★' : ''}</span>)}</div><div className="kt-sub">★ {tr('cabang pemilik')}</div></div>
        <div className="kt-box"><small>{tr('Periode & harga')}</small><div>{tgl(k.tglMulai)} – {tgl(k.tglAkhir)}</div><div>{k.jenis !== 'qty' ? `${SKEMA_LABEL[k.skemaHarga]}${k.skemaCatatan ? ` · ${k.skemaCatatan}` : ''}` : tr('Harga per PO lewat penawaran')}</div><div className="kt-sub">{[k.top, k.franco ? `franco ${k.franco}` : ''].filter(Boolean).join(' · ')}</div></div>
        <div className="kt-box">
          <small>{tr('Persetujuan')}</small>
          {k.approvals.length === 0 ? <div>{k.status === 'draft' ? tr('belum diajukan') : tr('tanpa persetujuan')}{k.maxDiscount != null ? ` · ${tr('diskon maks')} ${pct(k.maxDiscount)}` : ''}</div> : k.approvals.map((a) => (
            <div key={a.jenis}><span className={`badge ${a.status === 'disetujui' ? 'green' : a.status === 'ditolak' ? 'rust' : 'steel'}`}>{a.status}</span> {a.jenis === 'pasokan' ? tr('pasokan · GM Operation') : `${tr('diskon')} ${pct(k.maxDiscount)} · ${levelLabel(a.level)}`}{a.byName ? <div className="kt-sub">{a.byName}{a.at ? `, ${tgl(a.at)}` : ''}{a.note ? ` — ${a.note}` : ''}</div> : null}</div>
          ))}
        </div>
      </div>
      {k.catatan && <div className="kt-sub" style={{ marginBottom: 10 }}>{k.catatan}</div>}

      <h3 className="kt-h">{tr('Item kontrak & realisasi')}</h3>
      <div className="table-wrap">
        <table className="simple-table kt-table">
          <thead>
            <tr><th>{tr('Item · cakupan')}</th>{k.jenis !== 'qty' && <><th className="r">{tr('Harga kontrak')}</th><th className="r">{tr('Harga acuan')}</th><th className="r">{tr('Diskon')}</th></>}{k.jenis !== 'harga' && <th className="r">{tr('Komitmen')}</th>}<th className="r">{tr('Terpakai')}</th>{k.jenis !== 'harga' && <th className="r">{tr('Sisa')}</th>}<th style={{ minWidth: 190 }}>{k.jenis !== 'harga' ? tr('Progres vs waktu') : tr('Rincian')}</th></tr>
          </thead>
          <tbody>
            {k.items.map((it) => {
              const re = k.real?.[it.id];
              const pakai = (re?.pakai || 0) + (it.saldoQty || 0);
              const kom = it.qtyKomitmen || 0;
              const lines = itemDiscLines(it);
              const discs = lines.map((l) => l.disc).filter((x): x is number => x != null);
              const late = kom > 0 && pakai / kom < wb - 0.1 && (st === 'aktif' || st === 'akanHabis');
              const rinci = Object.entries(re?.rinci || {}).map(([kk, v]) => {
                const dd = it.dims.find((x) => x.id === kk);
                return `${dd ? dimLabel(dd, it.cakupan) : kk.startsWith('t') ? `tebal ${kk.slice(1)}` : kk}: ${fmtQty(v, it.satuan)}`;
              });
              const multi = it.cakupan === 'tebal' || it.cakupan === 'dimensi';
              return [
                <tr key={it.id} className="kt-itrow">
                  <td><b>{itemTitle(it)}</b>{it.materialBaru && <span className="badge violet" style={{ marginLeft: 6 }}>{tr('material baru')}</span>}<div className="kt-sub">{itemCakupanText(it)}</div>{it.vendorBerlaku && <div className={`kt-sub${it.vendorBerlaku < k.tglAkhir ? ' warn' : ''}`}>{tr('harga vendor s.d.')} {tgl(it.vendorBerlaku)}</div>}</td>
                  {k.jenis !== 'qty' && (
                    <>
                      <td className="r mono">{multi ? '' : rpKg(it.harga, it.satuan)}</td>
                      <td className="r mono muted">{multi ? '' : lines.length > 1 ? `${rp(Math.min(...lines.map((l) => l.acuan || Infinity)))}–${rp(Math.max(...lines.map((l) => l.acuan || 0)))}` : rp(lines[0]?.acuan)}</td>
                      <td className="r mono">{discs.length > 1 ? `${pct(Math.min(...discs))}–${pct(Math.max(...discs))}` : discs.length ? pct(discs[0]) : '-'}</td>
                    </>
                  )}
                  {k.jenis !== 'harga' && <td className="r mono">{kom ? fmtQty(kom, it.satuan) : '-'}</td>}
                  <td className="r mono"><b>{fmtQty(pakai, it.satuan)}</b>{it.saldoQty > 0 && <div className="kt-sub">{tr('awal')} {fmtQty(it.saldoQty, it.satuan)}</div>}</td>
                  {k.jenis !== 'harga' && <td className="r mono">{kom ? fmtQty(Math.max(0, kom - pakai), it.satuan) : '-'}</td>}
                  <td>
                    {kom > 0 && <ProgBar value={pakai / kom} time={wb} late={late} />}
                    {kom > 0 && <div className={`kt-sub${late ? ' bad' : ''}`}>{Math.round((pakai / kom) * 100)}% {tr('terpakai')}{late ? ` · ${tr('tertinggal')}` : ''}</div>}
                    {rinci.length > 0 && <div className="kt-sub">{rinci.join(' · ')}</div>}
                  </td>
                </tr>,
                ...(multi && k.jenis !== 'qty'
                  ? it.dims.map((dd, j) => (
                      <tr key={dd.id} className="kt-subrow">
                        <td>↳ {dimLabel(dd, it.cakupan)}</td>
                        <td className="r mono">{rpKg(dd.harga)}</td>
                        <td className="r mono muted">{rp(dd.acuan)}</td>
                        <td className="r mono">{pct(lines[j]?.disc)}</td>
                        {k.jenis !== 'harga' && <td />}
                        <td className="r mono">{re?.rinci[dd.id] ? fmtQty(re.rinci[dd.id], 'kg') : '-'}</td>
                        {k.jenis !== 'harga' && <td />}
                        <td className="kt-sub">{dd.acuanSrc || ''}</td>
                      </tr>
                    ))
                  : []),
              ];
            })}
            {t.kom > 0 && (
              <tr className="kt-total">
                <td>{tr('Total baja')}</td>
                {k.jenis !== 'qty' && <><td /><td /><td className="r mono">{k.maxDiscount != null ? `${tr('maks')} ${pct(k.maxDiscount)}` : ''}</td></>}
                <td className="r mono">{fmtQty(t.kom, 'kg')}</td>
                <td className="r mono">{fmtQty(t.pakai, 'kg')}</td>
                <td className="r mono">{fmtQty(Math.max(0, t.kom - t.pakai), 'kg')}</td>
                <td className={t.pakai / t.kom < wb - 0.1 ? 'bad' : ''}>{Math.round((t.pakai / t.kom) * 100)}% {tr('terpakai')} · {tr('waktu berjalan')} {Math.round(wb * 100)}%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="field-note">{tr('Garis tegak pada progres = posisi waktu kontrak hari ini. Komitmen qty per item (grade), gabungan semua dimensi. Saat PO, aturan paling spesifik dipakai dulu: dimensi lengkap → tebal → semua dimensi.')}</div>

      <div className="kt-split">
        <section style={{ flex: '999 1 560px', minWidth: 0 }}>
          <div className="kt-hrow">
            <h3 className="kt-h">{tr('PO terhubung')} <span className="muted">{data.kontrak.poCount || 0}</span></h3>
            {linkCabs.length > 1 && (
              <div className="kt-chips">
                <button type="button" className={`cf-chip${!cab ? ' on' : ''}`} onClick={() => setCab('')}>{tr('Semua')}</button>
                {linkCabs.map((c) => <button key={c} type="button" className={`cf-chip${cab === c ? ' on' : ''}`} onClick={() => setCab(c)}>{c}</button>)}
              </div>
            )}
          </div>
          {shownLinks.length === 0 ? (
            <div className="kt-note">{k.status === 'aktif' ? tr('Belum ada PO terhubung. PO baru dihubungkan dari panel prospek; PO lama lewat "Cari realisasi".') : tr('PO dihubungkan setelah kontrak aktif.')}</div>
          ) : (
            <div className="table-wrap">
              <table className="simple-table kt-table">
                <thead><tr><th>{tr('No PO · tanggal')}</th><th>{tr('Entitas · cabang')}</th><th>{tr('Item')}</th><th className="r">Qty</th><th className="r">{tr('Nilai')}</th><th>{tr('Harga')}</th><th>{tr('Status')}</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {shownLinks.map((l) => (
                    <tr key={l.id}>
                      <td><button type="button" className="link-btn mono" onClick={() => openProspect(l.prospectId)}>{l.noPo || '-'}</button><div className="kt-sub">{tgl(l.tglPO)}</div></td>
                      <td>{l.customer}<div className="kt-sub">{l.cabang} · SE {l.se || '-'}</div></td>
                      <td>{l.label}</td>
                      <td className="r mono">{fmtQty(l.qty, k.items.find((i) => i.id === l.kontrakItemId)?.satuan || 'kg')}</td>
                      <td className="r mono">{rp(l.nilai)}</td>
                      <td>{l.hargaKontrak == null ? '-' : l.beda != null && Math.abs(l.beda) > 0.3 ? <span className="badge rust">{tr('beda')} {l.beda > 0 ? '+' : ''}{pct(l.beda)}</span> : <span className="badge green">{tr('harga kontrak')}</span>}</td>
                      <td><span className="badge slate">{l.status === 5 ? (l.terfaktur ? tr('Terfaktur') : 'DO') : STATUS_META[l.status]?.label || l.status}</span></td>
                      {canEdit && <td><button type="button" className="link-btn" onClick={() => void unlink(l)}>{tr('Lepas')}</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {links.length > 0 && <div className="field-note">{tr('Nilai PO dari kontrak')}: <b className="mono">{rp(links.reduce((a, l) => a + l.nilai, 0))}</b>{bedaCount ? ` · ${bedaCount} ${tr('item memakai harga di luar kontrak (perlu persetujuan diskon terpisah)')}` : ''}</div>}
        </section>

        <section style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h3 className="kt-h">{tr('Pengingat masa berlaku')}</h3>
          <div className="kt-timeline">
            {REM.map((h) => {
              const d = new Date(Date.parse(`${k.tglAkhir}T00:00:00Z`) - h * 86400000).toISOString().slice(0, 10);
              const past = today >= d;
              return (
                <div key={h} className={past ? 'past' : ''}>
                  <b>H-{h}</b> <span className="muted">{tgl(d)}</span>
                  <div className="kt-sub">{h >= 60 ? tr('SE, BM & Admin Sales cabang berlaku') : tr('+ GM')} · {past ? tr('sudah lewat') : tr('terjadwal')}</div>
                </div>
              );
            })}
            <div className={today > k.tglAkhir ? 'past' : ''}><b>{tr('Berakhir')}</b> <span className="muted">{tgl(k.tglAkhir)}</span><div className="kt-sub">{tr('status otomatis Habis')}{data.next ? ` · ${tr('diganti')} ${data.next.nomor}` : ''}</div></div>
          </div>
          <h3 className="kt-h">{tr('Riwayat')}</h3>
          <div className="kt-log">
            {logs.map((l) => <div key={l.id}><b>{l.aksi}</b>{l.ket ? ` — ${l.ket}` : ''}<div className="kt-sub">{l.byName} · {tgl(l.at)}</div></div>)}
          </div>
        </section>
      </div>
    </div>
  );
}
