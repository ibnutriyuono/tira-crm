'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { itemCakupanText, itemTitle, type Kontrak, type KontrakKandidat, type KontrakNamaMirip } from '@/lib/kontrak';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { canNow } from '@/hooks/useCan';
import { fmtQty, rp, rpKg, tgl } from './shared';

type Tab = 'kuat' | 'beda' | 'luar' | 'mirip';
interface Saldo { id: string; q: string; v: string; d: string; ket: string }

/** Cari realisasi (PO lama di CRM) + realisasi awal (sebelum CRM / tidak tercatat). */
export function KontrakCari({ kontrak: k, onDone }: { kontrak: Kontrak; onDone: () => void }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const me = useDataStore((s) => s.currentUser);
  const [rows, setRows] = useState<KontrakKandidat[] | null>(null);
  const [mirip, setMirip] = useState<KontrakNamaMirip[]>([]);
  const [tab, setTab] = useState<Tab>('kuat');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saldo, setSaldo] = useState<Saldo[]>(() =>
    k.items.map((it) => ({ id: it.id, q: it.saldoQty ? String(it.satuan === 'kg' ? it.saldoQty / 1000 : it.saldoQty).replace('.', ',') : '', v: it.saldoNilai ? Math.round(it.saldoNilai).toLocaleString('id-ID') : '', d: it.saldoTgl || '', ket: it.saldoKet || '' })),
  );
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get<{ rows: KontrakKandidat[]; mirip: KontrakNamaMirip[] }>(`/api/kontrak/${k.id}/kandidat`)
      .then((r) => {
        if (!alive) return;
        setRows(r.rows);
        setMirip(r.mirip);
        const s: Record<string, boolean> = {};
        r.rows.forEach((x) => { if (x.grup === 'kuat' && !x.lain) s[`${x.prospectId}|${x.itemId}`] = true; });
        setSel(s);
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Gagal memuat kandidat', 'error'));
    return () => { alive = false; };
  }, [k.id, reload, toast]);

  const list = useMemo(() => rows || [], [rows]);
  const by = (g: Tab) => list.filter((x) => x.grup === g);
  const unitOf = (x: KontrakKandidat) => k.items.find((i) => i.id === x.kontrakItemId)?.satuan || 'kg';
  const sumQ = (xs: KontrakKandidat[]) => xs.filter((x) => unitOf(x) === 'kg').reduce((a, x) => a + x.qty, 0);
  const chosen = useMemo(() => list.filter((x) => sel[`${x.prospectId}|${x.itemId}`] && x.grup !== 'luar' && !x.lain), [list, sel]);

  async function link() {
    if (!chosen.length) return toast(tr('Centang item yang akan dihubungkan'), 'error');
    setBusy(true);
    try {
      const r = await api.post<{ linked: number; skipped: number }>(`/api/kontrak/${k.id}/link`, { links: chosen.map((x) => ({ prospectId: x.prospectId, itemId: x.itemId, kontrakItemId: x.kontrakItemId, dimId: x.dimId })) });
      toast(`${r.linked} ${tr('item terhubung')}${r.skipped ? ` · ${r.skipped} ${tr('dilewati')}` : ''}`, 'success');
      setReload((v) => v + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function saveSaldo() {
    setBusy(true);
    try {
      const nd = (v: string) => { const x = parseFloat(v.replace(',', '.')); return Number.isFinite(x) ? x : 0; };
      const nr = (v: string) => { const x = parseFloat(v.replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
      await api.put(`/api/kontrak/${k.id}/saldo`, {
        items: saldo.map((x) => {
          const it = k.items.find((i) => i.id === x.id)!;
          return { id: x.id, saldoQty: nd(x.q) * (it.satuan === 'kg' ? 1000 : 1), saldoNilai: nr(x.v), saldoTgl: x.d || null, saldoKet: x.ket };
        }),
      });
      toast(tr('Realisasi awal tersimpan'), 'success');
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }
  const canUnify = canNow('customer', 'e') && (me?.role === 'admin' || me?.role === 'gm' || me?.role === 'vp');

  const tiles: [Tab, string, string, string][] = [
    ['kuat', tr('Cocok kuat'), `${by('kuat').length} item · ${fmtQty(sumQ(by('kuat')), 'kg')}`, tr('spesifikasi & harga sama · sudah dicentang')],
    ['beda', tr('Spesifikasi sama, harga beda'), `${by('beda').length} item · ${fmtQty(sumQ(by('beda')), 'kg')}`, tr('periksa, centang bila memang dari kontrak')],
    ['luar', tr('Material di luar kontrak'), `${by('luar').length} item`, tr('ditampilkan, tidak dihitung realisasi')],
    ['mirip', tr('Nama customer mirip'), `${mirip.length} PO`, tr('perlu Satukan Nama Customer dulu')],
  ];

  return (
    <div className="kt kt-cari">
      <div className="kt-chips kt-crit">
        <span className="muted">{tr('Kriteria')}:</span>
        <span>{k.entitas.length} {tr('entitas')} {k.grupNama}</span>
        <span>{tr('Cabang')} {k.cabangs.join(' · ')}</span>
        <span>{tr('Tgl PO')} {tgl(k.tglMulai)} – {tgl(k.tglAkhir)}</span>
        <span>{tr('Status PO, DO, terfaktur')}</span>
        <span>{tr('Belum terhubung ke kontrak lain')}</span>
      </div>
      <div className="kpi-grid rq-kpis">
        {tiles.map(([key, label, value, foot]) => (
          <button key={key} type="button" className={`kpi rq-tile${tab === key ? ' on' : ''} ${key === 'kuat' ? 'won' : key === 'beda' ? 'lost' : key === 'mirip' ? 'pending' : 'git'}`} onClick={() => setTab(key)} aria-pressed={tab === key}>
            <div className="label">{label}</div><div className="value" style={{ fontSize: 19 }}>{value}</div><div className="foot">{foot}</div>
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="empty-state" style={{ padding: 24 }}><p>{tr('Mencari PO yang cocok…')}</p></div>
      ) : tab === 'mirip' ? (
        <div className="kt-note warm">
          {mirip.length === 0 ? tr('Tidak ada PO dengan nama customer yang mirip.') : (
            <>
              <b>{mirip.length} {tr('PO dengan nama customer mirip entitas, belum bisa dicocokkan otomatis')}</b>
              <table className="simple-table kt-mini" style={{ marginTop: 8 }}>
                <tbody>
                  {mirip.map((m) => <tr key={m.prospectId}><td className="mono">{m.noPo || '-'}</td><td>“{m.customer}”</td><td className="muted">≈ {m.mirip} · {m.cabang}</td><td className="r mono">{rp(m.nilai)}</td></tr>)}
                </tbody>
              </table>
              <div className="kt-inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                <span>{tr('Satukan nama dulu di Kelola Customer agar PO ini masuk kandidat — sekaligus merapikan laporan lain.')}</span>
                {canUnify ? <button type="button" className="btn btn-plan btn-sm" onClick={() => useUiStore.getState().openModal('customerUnify')}>{tr('Buka Satukan Nama Customer')}</button> : <span className="muted">{tr('Minta GM / Admin menyatukan nama.')}</span>}
              </div>
            </>
          )}
        </div>
      ) : by(tab).length === 0 ? (
        <div className="kt-note">{tab === 'kuat' ? tr('Tidak ada kandidat cocok kuat yang belum terhubung.') : tab === 'beda' ? tr('Tidak ada PO dengan harga beda.') : tr('Tidak ada material di luar kontrak.')}</div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table kt-table">
            <thead><tr><th style={{ width: 36 }}><span className="sr-only">{tr('Pilih')}</span></th><th>{tr('No PO · tanggal')}</th><th>{tr('Entitas · cabang')}</th><th>{tr('Item PO')}</th><th className="r">Qty</th><th className="r">{tr('Harga PO / kontrak')}</th><th>{tr('Dasar kecocokan')}</th></tr></thead>
            <tbody>
              {by(tab).map((x) => {
                const key = `${x.prospectId}|${x.itemId}`;
                const it = k.items.find((i) => i.id === x.kontrakItemId);
                return (
                  <tr key={key}>
                    <td><input type="checkbox" aria-label={tr('Hubungkan item ini')} disabled={tab === 'luar' || !!x.lain} checked={!!sel[key]} onChange={() => setSel((s) => ({ ...s, [key]: !s[key] }))} /></td>
                    <td><b className="mono">{x.noPo || '-'}</b><div className="kt-sub">{tgl(x.tglPO)} · {x.status === 5 ? (x.terfaktur ? tr('Terfaktur') : 'DO') : 'PO'}</div></td>
                    <td>{x.customer}<div className="kt-sub">{x.cabang} · SE {x.se || '-'}</div></td>
                    <td><b>{x.label}</b><div className="kt-sub">{it ? `→ ${itemTitle(it)} · ${itemCakupanText(it)}` : tr('tidak ada di kontrak')}</div>{x.lain && <div className="kt-sub bad">{tr('sudah terhubung ke')} {x.lain}</div>}</td>
                    <td className="r"><b className="mono">{fmtQty(x.qty, unitOf(x))}</b><div className="kt-sub">{x.qtySrc}</div></td>
                    <td className="r mono">{rpKg(x.harga, unitOf(x))}{x.hargaKontrak != null && <div className="kt-sub">{tr('kontrak')} {rpKg(x.hargaKontrak, unitOf(x))}</div>}</td>
                    <td><div className="kt-chips">{x.alasan.map((a) => <span key={a} className={`badge ${/beda|luar/.test(a) ? 'rust' : /sama|nomor/.test(a) ? 'green' : 'steel'}`}>{a}</span>)}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="kt-appr">
        <div><b>{tr('Dicentang')} {chosen.length} {tr('item')} · {fmtQty(sumQ(chosen), 'kg')}</b><span>{tr('Masuk realisasi kontrak. Harga beda tetap ditandai di detail kontrak. Bisa dilepas lagi kapan saja (tercatat di riwayat). Data PO tidak diubah.')}</span></div>
        <div className="row-actions"><button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => void link()}>{tr('Hubungkan ke kontrak')}</button></div>
      </div>

      <h3 className="kt-h" style={{ marginTop: 18 }}>{tr('Realisasi awal (saldo awal)')}</h3>
      <div className="field-note" style={{ marginTop: 0 }}>{tr('Untuk PO yang terjadi sebelum CRM dipakai atau tidak pernah diinput. Wajib keterangan asal data; ditampilkan terpisah dari PO terhubung.')}</div>
      <div className="table-wrap">
        <table className="simple-table kt-table">
          <thead><tr><th>{tr('Item kontrak')}</th><th className="r">{tr('Qty awal')}</th><th className="r">{tr('Nilai')}</th><th>{tr('Per tanggal')}</th><th>{tr('Keterangan')}</th></tr></thead>
          <tbody>
            {saldo.map((x, i) => {
              const it = k.items.find((y) => y.id === x.id)!;
              const upd = (p: Partial<Saldo>) => setSaldo((s) => s.map((y, j) => (j === i ? { ...y, ...p } : y)));
              return (
                <tr key={x.id}>
                  <td><b>{itemTitle(it)}</b><div className="kt-sub">{itemCakupanText(it)}</div></td>
                  <td className="r"><span className="kt-inline"><input className="mono" value={x.q} onChange={(e) => upd({ q: e.target.value })} style={{ width: 70, textAlign: 'right' }} aria-label={tr('Qty awal')} /><small>{it.satuan === 'kg' ? 't' : it.satuan}</small></span></td>
                  <td className="r"><input className="mono" value={x.v} onChange={(e) => upd({ v: e.target.value })} style={{ width: 120, textAlign: 'right' }} aria-label={tr('Nilai')} /></td>
                  <td><input type="date" value={x.d} onChange={(e) => upd({ d: e.target.value })} aria-label={tr('Per tanggal')} /></td>
                  <td><input value={x.ket} onChange={(e) => upd({ ket: e.target.value })} placeholder={tr('cth. PO Jan–Mar sebelum CRM, rekap Excel')} style={{ minWidth: 220 }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-outline" onClick={onDone}>{tr('Selesai')}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveSaldo()}>{tr('Simpan realisasi awal')}</button>
      </div>
    </div>
  );
}
