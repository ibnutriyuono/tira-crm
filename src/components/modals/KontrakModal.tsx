'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import type { Kontrak } from '@/lib/kontrak';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';
import { KontrakList, type KontrakRow } from '../kontrak/KontrakList';
import { KontrakDetail, type KontrakDetailData } from '../kontrak/KontrakDetail';
import { KontrakForm } from '../kontrak/KontrakForm';
import { KontrakCari } from '../kontrak/KontrakCari';

type View = 'list' | 'detail' | 'form' | 'cari';

/**
 * Kontrak Harga Customer: daftar → detail → form (baru / ubah / adendum /
 * perpanjangan / dari prospek / dari customer) → Cari realisasi.
 * Dibuka dari menu Customer, Kelola Customer, panel prospek, dan notifikasi.
 */
export function KontrakModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'kontrak');
  const ctx = useUiStore((s) => s.kontrakCtx);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const toast = useDataStore((s) => s.toast);

  const [seen, setSeen] = useState('');
  const [view, setView] = useState<View>('list');
  const [id, setId] = useState<string | null>(null);
  const [newFrom, setNewFrom] = useState<{ prospectId?: string | null; customer?: string | null; cabang?: string | null } | null>(null);
  const [rows, setRows] = useState<KontrakRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<KontrakDetailData | null>(null);
  const [tick, setTick] = useState(0);

  const ctxKey = show ? JSON.stringify(ctx || {}) : '';
  if (ctxKey !== seen) {
    setSeen(ctxKey);
    if (show) {
      setView(ctx?.view || (ctx?.id ? 'detail' : ctx?.prospectId || ctx?.customer ? 'form' : 'list'));
      setId(ctx?.id || null);
      setNewFrom(ctx?.prospectId || ctx?.customer ? { prospectId: ctx.prospectId, customer: ctx.customer, cabang: ctx.cabang } : null);
      setDetail(null);
    }
  }

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ kontrak: KontrakRow[]; canEdit: boolean }>('/api/kontrak');
      setRows(r.kontrak);
      setCanEdit(r.canEdit);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal memuat kontrak', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!show) return;
    if (view === 'list') void loadList();
    if ((view === 'detail' || view === 'cari' || (view === 'form' && id)) && id) {
      let alive = true;
      api.get<KontrakDetailData>(`/api/kontrak/${id}`)
        .then((r) => { if (alive) setDetail(r); })
        .catch((e) => toast(e instanceof Error ? e.message : 'Gagal memuat kontrak', 'error'));
      return () => { alive = false; };
    }
  }, [show, view, id, tick, loadList, toast]);

  const close = () => {
    const back = ctx?.returnTo;
    useUiStore.setState({ kontrakCtx: null });
    if (back) openModal(back);
    else closeModal();
  };
  const open = (kid: string) => { setId(kid); setDetail(null); setView('detail'); };
  const toList = () => { setId(null); setDetail(null); setNewFrom(null); setView('list'); };
  async function perpanjang(kid: string) {
    try {
      const r = await api.patch<{ id: string }>(`/api/kontrak/${kid}`, { action: 'perpanjang' });
      toast(tr('Draft perpanjangan dibuat — perbarui harga acuan lalu ajukan.'), 'success');
      setId(r.id);
      setDetail(null);
      setView('form');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    }
  }

  const k: Kontrak | null = detail?.kontrak || null;
  const title =
    view === 'list' ? tr('Kontrak Harga Customer')
      : view === 'form' ? (id ? `${tr('Ubah kontrak')} ${k?.nomor || ''}` : tr('Kontrak baru'))
        : view === 'cari' ? `${tr('Cari realisasi')} · ${k?.nomor || ''}`
          : `${tr('Kontrak')} ${k?.nomor || ''}`;

  return (
    <Modal
      show={show}
      onClose={close}
      title={title}
      xwide
      footer={
        <>
          {view !== 'list' && <button type="button" className="btn btn-outline" onClick={() => (view === 'cari' && id ? open(id) : toList())}>‹ {view === 'cari' ? tr('Kembali ke kontrak') : tr('Daftar kontrak')}</button>}
          <button type="button" className="btn btn-outline" onClick={close}>{tr('Tutup')}</button>
        </>
      }
    >
      {view === 'list' && <KontrakList rows={rows} canEdit={canEdit} loading={loading} onOpen={open} onNew={() => { setId(null); setNewFrom(null); setDetail(null); setView('form'); }} onCari={(kid) => { setId(kid); setDetail(null); setView('cari'); }} onPerpanjang={(kid) => void perpanjang(kid)} />}
      {view === 'detail' && (detail ? <KontrakDetail data={detail} onReload={() => setTick((t) => t + 1)} onEdit={() => setView('form')} onCari={() => setView('cari')} onOpen={open} onDeleted={toList} /> : <div className="empty-state" style={{ padding: 30 }}><p>{tr('Memuat…')}</p></div>)}
      {view === 'form' && (!id || detail) && (
        <KontrakForm
          key={id || `new-${newFrom?.prospectId || newFrom?.customer || ''}`}
          kontrak={id ? k : null}
          prospectId={id ? null : newFrom?.prospectId}
          customer={id ? null : newFrom?.customer}
          cabang={id ? null : newFrom?.cabang}
          onSaved={(kid) => { setNewFrom(null); open(kid); }}
          onCancel={() => (id ? open(id) : toList())}
        />
      )}
      {view === 'cari' && (k ? <KontrakCari kontrak={k} onDone={() => open(k.id)} /> : <div className="empty-state" style={{ padding: 30 }}><p>{tr('Memuat…')}</p></div>)}
    </Modal>
  );
}
