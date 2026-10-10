'use client';

import { useMemo, useState } from 'react';
import { KANBAN_STATUSES, STATUS_META } from '@/lib/constants';
import { classify, formatRupiah, klasBadgeColor, num, valueHighlightClass } from '@/lib/format';
import { buildProspectStarCounts } from '@/lib/reports';
import { qcdRequiredOnMove } from '@/lib/qcd';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';
import { IconCart, IconDoc, IconEdit, IconRfq, IconTrash, IconWa } from './icons';
import { changeDate } from '@/lib/filter';
import { NewBadge } from './NewBadge';
import { ProspectPurchasingBubble, useProspectPurchasingCounts } from './ProspectPurchasingBubble';

const CAP = 40;

function KanbanCard({ r, purchCount, starCount }: { r: Prospect; purchCount?: number; starCount?: number }) {
  const openModal = useUiStore((s) => s.openModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const klas = classify(r);
  // Mirrors auth.ts#canDeleteProspect, which the DELETE route still enforces —
  // this only hides a button that would 403 for everyone else.
  const canDelete = currentUser?.role === 'gm' || currentUser?.role === 'admin';
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`kanban-card${dragging ? ' dragging' : ''}${valueHighlightClass(r.value) ? ' ' + valueHighlightClass(r.value) : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', r.id);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="kc-top">
        <span className="kc-customer">
          {r.customer}
          <NewBadge createdAt={r.createdAt} />
          <ProspectPurchasingBubble count={purchCount} />
          {!!starCount && (
            <span className="prospect-star-badge" title={`Masuk Rencana Penjualan pada ${starCount} periode berbeda`}>
              ★ {starCount}
            </span>
          )}
        </span>
        <span className={`badge ${klasBadgeColor(klas)}`}>{klas}</span>
      </div>
      <div className="kc-produk">{r.uraian || '-'}</div>
      <div className="kc-meta-row">
        <span className="mono">{formatRupiah(r.value)}</span>
        <span>
          {r.cabang || '-'} · {r.se || '-'}
        </span>
      </div>
      <div className="kc-meta-row">
        <span className={`badge ${r.penawaranTerkirim ? 'green' : 'rust pending-dot'}`}>{r.penawaranTerkirim ? 'Penawaran Terkirim' : 'Penawaran Pending'}</span>
      </div>
      {num(r.status) === 5 && (
        <div className="kc-meta-row">
          <span className={`badge ${r.terfaktur ? 'green' : 'amber'}`}>
            {r.terfaktur ? 'Omzet (Terfaktur)' : 'GIT (Belum Terfaktur)'}
          </span>
        </div>
      )}
      <div className="kc-actions">
        <button
          className="icon-btn wa-btn"
          title="WhatsApp"
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ followUpCtx: { type: 'prospect', id: r.id } });
            openModal('followUp');
          }}
        >
          <IconWa />
        </button>
        <button
          className="icon-btn doc-btn"
          title="Buat Surat Penawaran"
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ quotationProspectId: r.id });
            openModal('quotation');
          }}
        >
          <IconDoc />
        </button>
        <button
          className="icon-btn rfq-btn"
          title="Buat RFQ ke Purchasing"
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ rfqCtx: { prospectId: r.id, rfqId: null } });
            openModal('rfq');
          }}
        >
          <IconRfq />
        </button>
        <button
          className="icon-btn fupa-btn"
          title={klas === 'Won' ? 'Buat FUP A (Permintaan Pembelian)' : 'FUP A hanya tersedia untuk prospek berstatus Won (PO/Kontrak atau DO)'}
          disabled={klas !== 'Won'}
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ fupaCtx: { fupaId: null, sourceRfqId: null, prospectId: r.id } });
            openModal('fupa');
          }}
        >
          <IconCart />
        </button>
        <button
          className="icon-btn"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ editProspectId: r.id });
            openModal('prospectForm');
          }}
        >
          <IconEdit />
        </button>
        {canDelete && (
          <button
            className="icon-btn danger"
            title="Hapus"
            onClick={(e) => {
              e.stopPropagation();
              useUiStore.setState({ deleteCtx: { mode: 'prospect', id: r.id, title: 'Hapus Prospek', message: `Yakin ingin menghapus prospek "${r.customer}"? Tindakan ini tidak dapat dibatalkan.` } });
              openModal('delete');
            }}
          >
            <IconTrash />
          </button>
        )}
      </div>
    </div>
  );
}

type KolomSort = '' | 'baru' | 'lama' | 'nilai-desc' | 'nilai-asc' | 'customer' | 'se';

const SORT_OPTIONS: { value: KolomSort; label: string }[] = [
  { value: '', label: 'Urutan: bawaan' },
  { value: 'baru', label: 'Urutan: masuk tahap terbaru' },
  { value: 'lama', label: 'Urutan: paling lama di tahap ini' },
  { value: 'nilai-desc', label: 'Urutan: nilai tertinggi' },
  { value: 'nilai-asc', label: 'Urutan: nilai terendah' },
  { value: 'customer', label: 'Urutan: customer A–Z' },
  { value: 'se', label: 'Urutan: SE A–Z' },
];

/** Sorts a column's cards; '' keeps the order the list already has (the table's own sort). */
function sortKolom(list: Prospect[], by: KolomSort): Prospect[] {
  if (!by) return list;
  const text = (v: string | null | undefined) => (v || '').trim().toLowerCase();
  const out = list.slice();
  if (by === 'baru') out.sort((a, b) => changeDate(b).localeCompare(changeDate(a)));
  if (by === 'lama') out.sort((a, b) => (changeDate(a) || '9999').localeCompare(changeDate(b) || '9999'));
  if (by === 'nilai-desc') out.sort((a, b) => num(b.value) - num(a.value));
  if (by === 'nilai-asc') out.sort((a, b) => num(a.value) - num(b.value));
  if (by === 'customer') out.sort((a, b) => text(a.customer).localeCompare(text(b.customer), 'id'));
  if (by === 'se') out.sort((a, b) => text(a.se).localeCompare(text(b.se), 'id') || num(b.value) - num(a.value));
  return out;
}

export function KanbanBoard({ filtered }: { filtered: Prospect[] }) {
  const openModal = useUiStore((s) => s.openModal);
  // Filter bulan per kolom, berdasar KAPAN prospek masuk ke tahap itu
  // (statusChangedAt) — bukan tanggal dibuat. Jadi "Negosiasi bulan ini"
  // berarti yang bergerak ke Negosiasi bulan ini, bukan yang kebetulan
  // dibuat bulan ini dan sekarang ada di Negosiasi.
  const [bulanPerKolom, setBulanPerKolom] = useState<Record<number, string>>({});
  const [hariPerKolom, setHariPerKolom] = useState<Record<number, string>>({});
  const [sortPerKolom, setSortPerKolom] = useState<Record<number, KolomSort>>({});
  // Khusus kolom DO: pisahkan yang sudah terfaktur (Omzet) dari yang belum (GIT).
  const [fakturDo, setFakturDo] = useState<'' | 'omzet' | 'git'>('');
  const purchCounts = useProspectPurchasingCounts(true);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const starCounts = useMemo(() => buildProspectStarCounts(salesPlans), [salesPlans]);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);
  const [dragOverStatus, setDragOverStatus] = useState<number | null>(null);

  async function handleDrop(newStatus: number, e: React.DragEvent) {
    e.preventDefault();
    setDragOverStatus(null);
    const id = e.dataTransfer.getData('text/plain');
    const rec = filtered.find((x) => x.id === id) || useDataStore.getState().prospects.find((x) => x.id === id);
    if (!rec || num(rec.status) === newStatus) return;

    // Deal ditutup (masuk PO/Kontrak/DO dari tahap terbuka, atau Lose) wajib
    // QCD; masuk PO/DO tanpa No. PO wajib No. PO. Dalam dua kasus itu status
    // BELUM dipindahkan sekarang: kartu tetap di kolom asalnya (tanpa upsert
    // optimis, tanpa PATCH) sampai modal QCD disimpan -- modal itulah yang
    // mengirim status + QCD (+ No. PO) sekaligus. "Batal" = kartu tidak pindah.
    const prev = num(rec.status);
    const needsNoPo = (newStatus === 4 || newStatus === 5) && !(rec.noPo || '').trim();
    if (qcdRequiredOnMove(prev, newStatus) || needsNoPo) {
      useUiStore.setState({ qcdCtx: { mode: 'kanban', statusVal: newStatus, recordId: id, commit: true } });
      openModal('qcd');
      return;
    }

    const optimistic = { ...rec, status: newStatus };
    upsertProspect(optimistic);
    toast('Status prospek diperbarui', 'success');
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${id}`, { status: newStatus });
      upsertProspect(prospect);
    } catch (err) {
      upsertProspect(rec); // revert on failure
      toast(err instanceof Error ? err.message : 'Gagal menyimpan perubahan status', 'error');
    }
  }

  return (
    <>
      <div className="kanban">
        {KANBAN_STATUSES.map((s) => {
          const semua = filtered.filter((r) => num(r.status) === s);
          // Opsi bulan dibangun dari isi kolom itu sendiri, supaya tidak ada
          // pilihan bulan yang hasilnya pasti kosong.
          const bulanOptions = Array.from(new Set(semua.map((r) => changeDate(r).slice(0, 7)).filter(Boolean))).sort((a, b) => b.localeCompare(a));
          const bulanAktif = bulanPerKolom[s] || '';
          const dalamBulan = bulanAktif ? semua.filter((r) => changeDate(r).slice(0, 7) === bulanAktif) : semua;
          // Penajaman opsional dari filter bulan: opsi hari dibangun dari isi
          // dalamBulan (bukan seluruh kolom), supaya kalau bulan dipilih,
          // pilihan harinya cuma hari-hari yang benar-benar ada di bulan itu.
          const hariOptions = Array.from(new Set(dalamBulan.map((r) => changeDate(r).slice(0, 10)).filter(Boolean))).sort((a, b) => b.localeCompare(a));
          const hariAktif = hariPerKolom[s] || '';
          const dalamHari = hariAktif ? dalamBulan.filter((r) => changeDate(r).slice(0, 10) === hariAktif) : dalamBulan;
          // Filter faktur hanya berlaku di kolom DO; hitungan di opsinya
          // mengikuti filter bulan/hari yang sedang aktif.
          const fakturAktif = s === 5 ? fakturDo : '';
          const nOmzet = s === 5 ? dalamHari.filter((r) => r.terfaktur).length : 0;
          const sortAktif = sortPerKolom[s] || '';
          // Diurutkan SEBELUM dipotong CAP, supaya "nilai tertinggi" benar-benar yang tertinggi di kolom.
          const items = sortKolom(fakturAktif ? dalamHari.filter((r) => (fakturAktif === 'omzet' ? r.terfaktur : !r.terfaktur)) : dalamHari, sortAktif);
          const totalVal = items.reduce((sum, r) => sum + num(r.value), 0);
          const shown = items.slice(0, CAP);
          return (
            <div className="kanban-col" key={s}>
              <div className={`kanban-col-head ${STATUS_META[s].color}`}>
                <div className="kc-title">
                  {s} · {STATUS_META[s].label}
                </div>
                <div className="kc-meta">
                  {items.length} prospek · {formatRupiah(totalVal)}
                  {(bulanAktif || hariAktif || fakturAktif) && semua.length !== items.length && <span> (dari {semua.length})</span>}
                </div>
                {bulanOptions.length > 0 && (
                  <select
                    className="kc-month"
                    value={bulanAktif}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBulanPerKolom((prev) => ({ ...prev, [s]: v }));
                      // Opsi hari akan dibangun ulang dari bulan yang baru —
                      // hari yang tadinya dipilih bisa saja tidak ada di
                      // bulan itu sama sekali, jadi direset bukan dibiarkan
                      // menyaring ke hasil yang diam-diam kosong.
                      setHariPerKolom((prev) => ({ ...prev, [s]: '' }));
                    }}
                    title="Saring berdasar bulan perubahan status ke tahap ini"
                  >
                    <option value="">Semua bulan</option>
                    {bulanOptions.map((m) => (
                      <option key={m} value={m}>
                        {new Date(`${m}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })}
                      </option>
                    ))}
                  </select>
                )}
                {hariOptions.length > 0 && (
                  <select
                    className="kc-month"
                    value={hariAktif}
                    onChange={(e) => setHariPerKolom((prev) => ({ ...prev, [s]: e.target.value }))}
                    title="Persempit lagi ke hari tertentu perubahan status ke tahap ini"
                  >
                    <option value="">Semua hari{bulanAktif ? ' di bulan ini' : ''}</option>
                    {hariOptions.map((d) => (
                      <option key={d} value={d}>
                        {new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: bulanAktif ? undefined : 'numeric' })}
                      </option>
                    ))}
                  </select>
                )}
                {semua.length > 1 && (
                  <select
                    className="kc-month"
                    value={sortAktif}
                    onChange={(e) => setSortPerKolom((prev) => ({ ...prev, [s]: e.target.value as KolomSort }))}
                    title="Urutkan kartu di kolom ini"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {s === 5 && semua.length > 0 && (
                  <select
                    className="kc-month"
                    value={fakturDo}
                    onChange={(e) => setFakturDo(e.target.value as '' | 'omzet' | 'git')}
                    title="Saring DO berdasar status faktur: Omzet (sudah terfaktur) atau GIT (belum terfaktur)"
                  >
                    <option value="">Semua (Omzet + GIT)</option>
                    <option value="omzet">Omzet (Terfaktur) · {nOmzet}</option>
                    <option value="git">GIT (Belum Terfaktur) · {dalamHari.length - nOmzet}</option>
                  </select>
                )}
              </div>
              <div
                className={`kanban-col-body${dragOverStatus === s ? ' drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStatus(s);
                }}
                onDragLeave={() => setDragOverStatus((cur) => (cur === s ? null : cur))}
                onDrop={(e) => handleDrop(s, e)}
              >
                {shown.length === 0 ? (
                  <div className="kanban-empty">{fakturAktif ? (fakturAktif === 'omzet' ? 'Tidak ada DO terfaktur' : 'Tidak ada DO berstatus GIT') + (bulanAktif || hariAktif ? ' pada periode ini' : '') : hariAktif ? 'Tidak ada perubahan status di hari ini' : bulanAktif ? 'Tidak ada perubahan status di bulan ini' : 'Tidak ada data'}</div>
                ) : (
                  shown.map((r) => <KanbanCard key={r.id} r={r} purchCount={purchCounts[r.id]} starCount={starCounts.get(r.id)} />)
                )}
                {items.length > CAP && <div className="kanban-more">+{items.length - CAP} lainnya — persempit dengan filter</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
