'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { signatureFromCanvas, signatureFromFile } from '@/lib/signature-image';
import { useDataStore } from '@/store/useDataStore';
import type { SafeUser } from '@/lib/types';

import { useT } from '@/store/useLangStore';
/** URL gambar tanda tangan user yang login (versi ikut signatureAt supaya tidak memakai cache lama). */
export const signatureUrl = (at: string | null | undefined) => (at ? `/api/account/signature?v=${encodeURIComponent(at)}` : '');

/** Kanvas untuk menandatangani dengan mouse / jari / stylus. */
function SignaturePad({ onChange, clearKey }: { onChange: (hasInk: boolean) => void; clearKey: number }) {
  const tr = useT();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14204a';
    ctx.lineWidth = 2.6;
    onChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when clearKey changes
  }, [clearKey]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas
      ref={ref}
      className="sig-pad"
      aria-label={tr("Area tanda tangan — gambar dengan mouse, jari, atau stylus")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        last.current = pos(e);
        const ctx = e.currentTarget.getContext('2d');
        if (ctx && last.current) {
          ctx.beginPath();
          ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#14204a';
          ctx.fill();
        }
        onChange(true);
      }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return;
        const ctx = e.currentTarget.getContext('2d');
        if (!ctx) return;
        const p = pos(e);
        // tekanan stylus (bila ada) sedikit memengaruhi tebal garis
        ctx.lineWidth = e.pressure > 0 && e.pointerType === 'pen' ? 1.4 + e.pressure * 2.6 : 2.6;
        const mx = (last.current.x + p.x) / 2;
        const my = (last.current.y + p.y) / 2;
        ctx.beginPath();
        ctx.moveTo(last.current.x, last.current.y);
        ctx.quadraticCurveTo(last.current.x, last.current.y, mx, my);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last.current = p;
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
      }}
      onPointerCancel={() => {
        drawing.current = false;
        last.current = null;
      }}
    />
  );
}

/**
 * Akun Saya › Tanda tangan: gambar langsung atau unggah foto/scan. Disimpan
 * per user dan otomatis dipasang di surat penawaran yang dibuat user ini.
 */
export function SignatureSection() {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const [mode, setMode] = useState<'lihat' | 'gambar' | 'unggah'>('lihat');
  const [hasInk, setHasInk] = useState(false);
  const [clearKey, setClearKey] = useState(0);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const padWrap = useRef<HTMLDivElement | null>(null);

  if (!me) return null;
  const has = !!me.signatureAt;

  function apply(user: SafeUser) {
    const cur = useDataStore.getState().currentUser;
    if (cur) useDataStore.getState().setCurrentUser({ ...cur, ...user, customRoleLabel: cur.customRoleLabel });
  }

  async function save(png: string | null) {
    if (!png) return toast('Tanda tangan masih kosong', 'error');
    setBusy(true);
    try {
      const { user } = await api.put<{ user: SafeUser }>('/api/account/signature', { png });
      apply(user);
      setMode('lihat');
      setUploaded(null);
      toast('Tanda tangan disimpan — otomatis dipakai di surat penawaran', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan tanda tangan', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Hapus tanda tangan Anda?')) return;
    setBusy(true);
    try {
      const { user } = await api.del<{ user: SafeUser }>('/api/account/signature');
      apply(user);
      toast('Tanda tangan dihapus', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Pilih file gambar (JPG / PNG)', 'error');
    try {
      const png = await signatureFromFile(f);
      if (!png) return toast('Coretan tanda tangan tidak terbaca. Gunakan foto yang terang dengan latar kertas putih.', 'error');
      setUploaded(png);
    } catch {
      toast('Gagal membaca gambar', 'error');
    }
  }

  return (
    <div className="sig-section">
      <div className="sig-head">
        <div>
          <b>{tr("Tanda tangan")}</b>
          <div className="field-note" style={{ margin: 0 }}>{tr("Dipasang otomatis di atas nama Anda pada surat penawaran (.docx).")}</div>
        </div>
        <div className="sa-pills" role="group" aria-label={tr("Cara mengisi tanda tangan")}>
          <button type="button" className={mode === 'gambar' ? 'on' : ''} onClick={() => { setMode('gambar'); setClearKey((k) => k + 1); }}>
            {tr("Gambar langsung")}
          </button>
          <button type="button" className={mode === 'unggah' ? 'on' : ''} onClick={() => { setMode('unggah'); setUploaded(null); }}>
            {tr("Unggah foto / scan")}
          </button>
        </div>
      </div>

      {mode === 'lihat' &&
        (has ? (
          <div className="sig-current">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signatureUrl(me.signatureAt)} alt={tr("Tanda tangan Anda")} />
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={remove}>
              {tr("Hapus")}
            </button>
          </div>
        ) : (
          <div className="sig-empty">{tr("Belum ada tanda tangan. Pilih \"Gambar langsung\" atau \"Unggah foto / scan\".")}</div>
        ))}

      {mode === 'gambar' && (
        <div ref={padWrap}>
          <SignaturePad clearKey={clearKey} onChange={setHasInk} />
          <div className="sig-actions">
            <span className="field-note" style={{ margin: 0 }}>{tr("Tanda tangani di kotak dengan mouse, jari, atau stylus.")}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setClearKey((k) => k + 1)}>{tr("Ulangi")}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode('lihat')}>{tr("Batal")}</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !hasInk}
              onClick={() => {
                const c = padWrap.current?.querySelector('canvas');
                void save(c ? signatureFromCanvas(c) : null);
              }}
            >
              {tr("Simpan tanda tangan")}
            </button>
          </div>
        </div>
      )}

      {mode === 'unggah' && (
        <div>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void onFile(e.target.files?.[0])} />
          <div className="field-note">{tr("Foto tanda tangan di kertas putih yang terang; latar dibuat transparan dan gambar dipangkas otomatis.")}</div>
          {uploaded && (
            <div className="sig-current">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploaded} alt={tr("Hasil olahan tanda tangan")} />
            </div>
          )}
          <div className="sig-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode('lihat')}>{tr("Batal")}</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !uploaded} onClick={() => void save(uploaded)}>
              {tr("Simpan tanda tangan")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
