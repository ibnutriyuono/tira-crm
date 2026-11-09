'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { marginRank } from '@/lib/margin-tier';
import { formatDateID } from '@/lib/format';
import { FSV_META, fmtQty, locCabang, locLabel, matchStock, stockVariants, unitShort, type StockMatch } from '@/lib/stock';
import { useStock } from '@/hooks/useStock';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/**
 * Saran dari stok gudang untuk satu baris material prospek — tampil di atas
 * "Kondisi stok": saran harga jual minimal (HPP stok ÷ (1 − margin), tanpa
 * menampilkan HPP) beserta batas diskon Sales / BM / GM / VP dari saran itu
 * (sama dengan cek diskon Surat Penawaran), posisi stok per gudang, kondisi (FSV + umur), dan semua
 * varian grade (-D / -G) yang ada. "Pakai" mengisi Harga/kg (bila satuan kg)
 * dan Kondisi stok (Ready / Ready cabang lain) bila masih kosong.
 */
export function StockSuggest({
  grade,
  bentuk,
  dim,
  cabang,
  chosen = '',
  onUse,
}: {
  grade: string;
  bentuk: string;
  dim: Record<string, string | undefined>;
  cabang: string;
  /** Item No stok yang dipilih Sales ("Pakai") — jadi patokan saran harga & cek diskon. */
  chosen?: string;
  onUse: (p: { hargaKg?: string; stok?: 'ready' | 'ready2'; itemNo: string }) => void;
}) {
  const tr = useT();
  const { items, meta } = useStock(!!grade.trim());
  const [all, setAll] = useState(false);
  const [disc, setDisc] = useState(false);
  const matches = useMemo(() => (items.length && grade.trim() ? matchStock({ grade, bentuk, dim }, items, cabang, 12) : []), [items, grade, bentuk, dim, cabang]);
  const variants = useMemo(() => (items.length && grade.trim() ? stockVariants(grade, items) : []), [items, grade]);
  const hasSize = ['tebal', 'dia', 'sisi'].some((k) => String(dim[k] || '').trim());

  if (!items.length || !grade.trim() || !variants.length) return null;
  const asOf = meta?.asOf ? ` · ${tr('per')} ${formatDateID(meta.asOf)}` : '';

  if (!hasSize || !matches.length) {
    return (
      <div className="stk-sug stk-quiet">
        <span className="stk-ic" aria-hidden="true">▣</span>
        {hasSize
          ? <>{tr('Grade ini ada di stok gudang, tapi ukurannya belum ada yang cocok.')}{asOf}</>
          : <>{tr('Grade ini ada di stok gudang')} ({variants.map((v) => (v ? `-${v}` : tr('standar'))).join(', ')}) — {tr('isi ukuran untuk melihat saran harga & posisi stok.')}</>}
      </div>
    );
  }

  // Patokan: stok yang dipilih Sales; bila belum memilih, opsi teratas yang punya HPP.
  const picked = chosen ? matches.find((m) => m.row.itemNo === chosen) || null : null;
  const best = (picked && picked.row.saran != null ? picked : null) || matches.find((m) => m.row.saran != null) || null;
  // Ringkas: opsi terbaik tiap varian (standar / -D / -G) selalu tampil, lalu dilengkapi sampai 3.
  const shown = all
    ? matches
    : (() => {
        const pick: StockMatch[] = picked ? [picked] : [];
        matches.forEach((m) => {
          if (!pick.some((p) => (p.row.variant || '') === (m.row.variant || ''))) pick.push(m);
        });
        matches.forEach((m) => {
          if (pick.length < 3 && !pick.includes(m)) pick.push(m);
        });
        return matches.filter((m) => pick.includes(m));
      })();
  const hasDG = variants.some((v) => v === 'D' || v === 'G');
  return (
    <div className="stk-sug">
      <div className="stk-head">
        {best ? (
          <b>
            {tr('Saran harga jual minimal')} {rp(best.row.saran as number)}/{unitShort(best.row.unit)} — {tr('cek subsystem sebelum menawarkan')}
          </b>
        ) : null}
        {best ? (
          <span className="stk-basis">
            {picked === best ? `${tr('Patokan: stok dipilih')} — ` : `${tr('Patokan: opsi stok teratas')} — `}
            {best.row.description.replace(/\s+/g, ' ')}
            {picked !== best && ` · ${tr('klik "Pakai" pada opsi lain untuk mengganti patokan')}`}
          </span>
        ) : (
          <b>{tr('Ada di stok gudang — HPP belum tersedia, tanyakan harga ke Purchasing. Cek subsystem sebelum menawarkan.')}</b>
        )}
        <span className="muted">
          {matches.length} {tr('opsi stok')}{hasDG ? ` · ${tr('termasuk varian')} ${variants.filter(Boolean).map((v) => `-${v}`).join(' / ')}` : ''}{asOf}
          {!matches[0].exact && ` · ${tr('ukuran persis tidak ada — ditampilkan ukuran terdekat di atasnya')}`}
        </span>
        {best && (
          <button type="button" className="link-btn stk-disc-btn" onClick={() => setDisc(!disc)} aria-expanded={disc}>
            {disc ? tr('Tutup') : 'discount?'}
          </button>
        )}
        {best && disc && <DiscountPanel saran={best.row.saran as number} unit={unitShort(best.row.unit)} cabang={cabang} />}
      </div>
      <ul className="stk-list">
        {shown.map((m) => (
          <Opt key={m.row.id} m={m} onUse={onUse} picked={m.row.itemNo === chosen} />
        ))}
      </ul>
      {matches.length > shown.length || all ? (
        <button type="button" className="link-btn" onClick={() => setAll(!all)}>
          {all ? tr('Sembunyikan') : `${tr('Lihat semua')} (${matches.length})`}
        </button>
      ) : null}
    </div>
  );
}

function Opt({ m, onUse, picked }: { m: StockMatch; picked: boolean; onUse: (p: { hargaKg?: string; stok?: 'ready' | 'ready2'; itemNo: string }) => void }) {
  const tr = useT();
  const r = m.row;
  const u = unitShort(r.unit);
  const f = r.fsv ? FSV_META[r.fsv] : null;
  const locs = Object.entries(r.locations).sort((a, b) => b[1] - a[1]);
  return (
    <li className={`${m.local ? 'local' : ''}${picked ? ' picked' : ''}`}>
      <div className="stk-l1">
        <span className="stk-desc">{r.description.replace(/\s+/g, ' ')}</span>
        {r.variant && <span className={`badge ${r.variant === 'D' ? 'steel' : 'violet'}`}>-{r.variant}</span>}
        {m.fits === false && <span className="badge slate" title={tr('Lebar × panjang stok lebih kecil dari yang diminta')}>{tr('ukuran lebih kecil')}</span>}
        <span className="stk-price">{r.saran != null ? `${tr('min.')} ${rp(r.saran)}/${u}` : tr('HPP belum ada')}</span>
      </div>
      <div className="stk-l2">
        <span>
          <b>{fmtQty(r.qty)} {u}</b>
          {f && <span className={`stk-fsv ${f.cls}`}>{tr(f.label)}</span>}
          {r.ageDays != null && <span className="muted"> · {tr('umur')} {fmtQty(r.ageDays)} {tr('hari')}</span>}
        </span>
        <span className="stk-locs">
          {locs.map(([loc, q]) => (
            <span key={loc} className={m.local && locCabang(loc) ? 'here' : ''}>
              {locLabel(loc)}{locCabang(loc) ? ` (${locCabang(loc)})` : ''} {fmtQty(q)}
            </span>
          ))}
        </span>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          title={u === 'kg' && r.saran != null ? tr('Isi Harga/kg dengan saran ini dan Kondisi stok') : tr('Isi Kondisi stok')}
          onClick={() => onUse({ hargaKg: u === 'kg' && r.saran != null ? String(r.saran) : undefined, stok: m.local ? 'ready' : 'ready2', itemNo: r.itemNo })}
        >
          {picked ? `✓ ${tr('Dipakai')}` : tr('Pakai')}
        </button>
      </div>
    </li>
  );
}

type Approver = { name: string; role: string; label: string };
const approverCache = new Map<string, Promise<Record<string, Approver[]>>>();

/**
 * Saran diskon dari saran harga stok: harga terendah tiap tingkat dan siapa
 * yang menyetujui (BM cabang, GM, VP — sama dengan penerima pengajuan di
 * Surat Penawaran). Batas role user sendiri ditandai: di dalam batas itu
 * surat langsung bisa dikirim tanpa persetujuan.
 */
function DiscountPanel({ saran, unit, cabang }: { saran: number; unit: string; cabang: string }) {
  const tr = useT();
  const rules = useDataStore((s) => s.opsRules);
  const me = useDataStore((s) => s.currentUser);
  const [who, setWho] = useState<Record<string, Approver[]> | null>(null);
  useEffect(() => {
    const key = cabang.toUpperCase();
    if (!approverCache.has(key)) approverCache.set(key, api.get<Record<string, Approver[]>>(`/api/margin-approvals/approvers?cabang=${encodeURIComponent(key)}`).catch(() => ({})));
    let live = true;
    approverCache.get(key)!.then((r) => live && setWho(r));
    return () => {
      live = false;
    };
  }, [cabang]);
  const rank = marginRank(me?.role);
  const myIdx = rank >= 4 ? 3 : rank >= 3 ? 2 : rank >= 1 ? 1 : 0;
  const names = (k: string) => (who ? (who[k] || []).map((a) => (a.label && a.label !== k.toUpperCase() ? `${a.name} (${a.label})` : a.name)).join(', ') || '–' : '…');
  const tiers: [number, string, string][] = [
    [rules.discSe, tr('Sales (SE)'), tr('tanpa persetujuan')],
    [rules.discBm, 'BM', names('bm')],
    [rules.discGm, 'GM', names('gm')],
    [rules.discVp, 'VP', names('vp')],
  ];
  const myLimit = tiers[myIdx][0];
  const min = (d: number) => rp(Math.ceil((saran * (100 - d)) / 100));
  return (
    <div className="stk-disc">
      <div className="stk-disc-grid">
        {tiers.map(([d, role, acc], i) => (
          <div key={i} className={`stk-disc-row${i === myIdx ? ' mine' : ''}`}>
            <span>≤ {d}%</span>
            <span className="mono">≥ {min(d)}/{unit}</span>
            <b>{role}</b>
            <span>{acc}</span>
          </div>
        ))}
      </div>
      <div className="muted">
        {tr('Anda bisa langsung mengirim surat sampai diskon')} {myLimit}% ({min(myLimit)}/{unit}). {tr('Di atas')} {rules.discVp}% {tr('tetap ke VP sebagai pengecualian.')}
      </div>
    </div>
  );
}
