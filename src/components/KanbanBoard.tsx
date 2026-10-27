'use client';
import { arrivalChip } from '@/lib/po-indent';
import { jakartaDate } from '@/lib/followup-rule';

import { quotePermAct } from '@/lib/roles';
import { lostDateOf } from '@/lib/lose-date';
import { promptItemFlow } from '@/lib/item-flow-prompt';
import { flowItems, flowTotals } from '@/lib/item-flow';
import { FlowBar } from './modals/ItemFlowModal';
import { KamBadge } from './KamBadge';
import { IssueBadge } from './issues/shared';
import { useMemo, useState } from 'react';
import { KANBAN_STATUSES, STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah, klasBadgeColor, num, valueHighlightClass } from '@/lib/format';
import { buildProspectStarCounts } from '@/lib/reports';
import { qcdRequiredOnMove } from '@/lib/qcd';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';
import { IconCart, IconDoc, IconEdit, IconRfq, IconTrash, IconWa } from './icons';
import { changeDate, periodDate } from '@/lib/filter';
import { NewBadge } from './NewBadge';
import { ProspectPurchasingBubble, useProspectPurchasingCounts } from './ProspectPurchasingBubble';
import { useCan, canNow } from '@/hooks/useCan';
import { FollowUpMoveModal } from './FollowUpMoveModal';
import { followUpRequiredOnMove } from '@/lib/followup-rule';

import { useT } from '@/store/useLangStore';
import { isGmLevel } from '@/lib/roles';
const CAP = 40;

function KanbanCard({ r, purchCount, starCount }: { r: Prospect; purchCount?: number; starCount?: number }) {
  const tr = useT();
  const openModal = useUiStore((s) => s.openModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const klas = classify(r);
  // Mirrors auth.ts#canDeleteProspect, which the DELETE route still enforces —
  // this only hides a button that would 403 for everyone else.
  const canE = useCan('prospek', 'e');
  // Ikon Surat Penawaran (Admin Sales: hak Tambah/Ubah, lainnya: Download).
  const canX = useCan('prospek', quotePermAct(currentUser?.role));
  const canRfq = useCan('rfq', 'e');
  const canDelete = useCan('prospek', 'd') && (isGmLevel(currentUser?.role) || currentUser?.role === 'admin');
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`kanban-card${dragging ? ' dragging' : ''}${valueHighlightClass(r.value) ? ' ' + valueHighlightClass(r.value) : ''}`}
      draggable={canE}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', r.id);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="kc-top">
        <span className="kc-customer">
          {r.customer}
          <KamBadge customer={r.customer} />
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
        <span className={`badge ${r.penawaranTerkirim ? 'green' : 'rust pending-dot'}`}>{r.penawaranTerkirim ? tr("Penawaran Terkirim") : tr("Penawaran Pending")}</span>
        <IssueBadge prospectId={r.id} />
      </div>
      {num(r.status) === 6 && (
        <div className="kc-meta-row">
          <span className="kc-lose-date">{tr("Lose")} {formatDateID(lostDateOf(r))}{r.qcdKompetitor ? ` · ${r.qcdKompetitor}` : ''}</span>
        </div>
      )}
      {num(r.status) === 5 && (
        <div className="kc-meta-row">
          <span className={`badge ${r.terfaktur ? 'green' : 'amber'}`}>
            {r.terfaktur ? tr("Omzet (Terfaktur)") : tr("GIT (Belum Terfaktur)")}
          </span>
        </div>
      )}
      {klas === 'Won' && <ItemFlowChip r={r} />}
      {klas === 'Won' && <ArrivalChip r={r} />}
      {klas === 'Lost' && <ItemQcdChip r={r} />}
      <div className="kc-actions">
        {canE && (
        <button
          className="icon-btn wa-btn"
          title={tr("WhatsApp")}
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ followUpCtx: { type: 'prospect', id: r.id } });
            openModal('followUp');
          }}
        >
          <IconWa />
        </button>
        )}
        {canX && (
        <button
          className="icon-btn doc-btn"
          title={tr("Buat Surat Penawaran")}
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ quotationProspectId: r.id });
            openModal('quotation');
          }}
        >
          <IconDoc />
        </button>
        )}
        {canRfq && (
        <button
          className="icon-btn rfq-btn"
          title={tr("Buat RFQ ke Purchasing")}
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ rfqCtx: { prospectId: r.id, rfqId: null } });
            openModal('rfq');
          }}
        >
          <IconRfq />
        </button>
        )}
        {canRfq && (
        <button
          className="icon-btn fupa-btn"
          title={klas === 'Won' ? tr("Buat FUP A (Permintaan Pembelian)") : tr("FUP A hanya tersedia untuk prospek berstatus Won (PO/Kontrak atau DO)")}
          disabled={klas !== 'Won'}
          onClick={(e) => {
            e.stopPropagation();
            useUiStore.setState({ fupaCtx: { fupaId: null, sourceRfqId: null, prospectId: r.id } });
            openModal('fupa');
          }}
        >
          <IconCart />
        </button>
        )}
        <button
          className="icon-btn"
          title={canE ? tr("Edit") : tr("Lihat (hanya-baca)")}
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
            title={tr("Hapus")}
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

/** Won card: per-item progress (PO vs terkirim); opens Status Item & Riwayat. */
function ItemFlowChip({ r }: { r: Prospect }) {
  const tr = useT();
  const items = flowItems(r);
  const t = flowTotals(items);
  const sent = items.reduce((s, i) => s + i.sent, 0);
  const po = items.reduce((s, i) => s + (i.po || 0), 0);
  const label = !t.confirmed ? 'Konfirmasi qty PO per item' : `Terkirim ${po ? Math.round((sent / po) * 100) : 0}% dari PO`;
  return (
    <div className="kc-meta-row">
      <button
        type="button"
        className="kc-item-btn"
        title={tr("Status Item & Riwayat (penawaran → PO → kirim)")}
        onClick={(e) => {
          e.stopPropagation();
          useUiStore.setState({ itemFlowCtx: { prospectId: r.id }, modal: 'itemFlow' });
        }}
      >
        <span>{label}</span>
        <FlowBar it={{ offered: items.reduce((s, i) => s + i.offered, 0), po, sent }} />
      </button>
    </div>
  );
}

/** Kartu Lose dengan beberapa item: kompetitor pemenang & QCD per item. */
function ItemQcdChip({ r }: { r: Prospect }) {
  const tr = useT();
  const items = flowItems(r);
  if (items.length < 2) return null;
  const filled = items.filter((i) => i.qcd?.kompetitor).length;
  const komps = new Set(items.map((i) => (i.qcd?.kompetitor || r.qcdKompetitor || '').trim()).filter(Boolean));
  return (
    <div className="kc-meta-row">
      <button
        type="button"
        className="kc-item-btn"
        title={tr("QCD & kompetitor pemenang per item")}
        onClick={(e) => {
          e.stopPropagation();
          useUiStore.setState({ itemFlowCtx: { prospectId: r.id, mode: 'qcd' }, modal: 'itemFlow' });
        }}
      >
        <span>
          {filled ? `${tr("Kompetitor per item")}: ${komps.size}` : `${tr("QCD per item")} (${items.length} ${tr("item")})`}
        </span>
      </button>
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
  const tr = useT();
  const openModal = useUiStore((s) => s.openModal);
  // Filter bulan per kolom (periodDate): kolom PO/Kontrak memakai bulan PO,
  // kolom DO memakai bulan faktur untuk yang terfaktur (Omzet) dan bulan
  // masuk DO untuk GIT; kolom lain memakai KAPAN prospek masuk ke tahap itu
  // (statusChangedAt) — bukan tanggal dibuat.
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
  // Pindah ke Permintaan/Penawaran/Negosiasi: tunggu jadwal follow-up dulu.
  const [pendingMove, setPendingMove] = useState<{ rec: Prospect; to: number } | null>(null);

  async function handleDrop(newStatus: number, e: React.DragEvent) {
    e.preventDefault();
    setDragOverStatus(null);
    if (!canNow('prospek', 'e')) return toast('Role Anda tidak memiliki hak mengubah status prospek', 'error');
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

    // Tahap pipeline aktif: kartu belum pindah sampai jadwal follow-up diisi
    // ("Batal" = tetap di kolom asal). Lihat lib/followup-rule.ts.
    if (followUpRequiredOnMove(prev, newStatus)) {
      setPendingMove({ rec, to: newStatus });
      return;
    }
    await commitMove(rec, newStatus);
  }

  async function commitMove(rec: Prospect, newStatus: number, followUp?: { followUpAt: string; followUpNote: string }) {
    const prev = num(rec.status);
    const optimistic = { ...rec, status: newStatus, ...(followUp ? { followUpAt: followUp.followUpAt, followUpNote: followUp.followUpNote || null } : {}) };
    upsertProspect(optimistic);
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${rec.id}`, { status: newStatus, ...(followUp || {}) });
      upsertProspect(prospect);
      toast(followUp ? `Status prospek diperbarui · follow-up ${formatDateID(followUp.followUpAt)}` : 'Status prospek diperbarui', 'success');
      promptItemFlow(prev, prospect);
      return true;
    } catch (err) {
      upsertProspect(rec); // revert on failure
      toast(err instanceof Error ? err.message : 'Gagal menyimpan perubahan status', 'error');
      return false;
    }
  }

  return (
    <>
      <div className="kanban">
        {KANBAN_STATUSES.map((s) => {
          const semua = filtered.filter((r) => num(r.status) === s);
          // Opsi bulan dibangun dari isi kolom itu sendiri, supaya tidak ada
          // pilihan bulan yang hasilnya pasti kosong.
          const bulanOptions = Array.from(new Set(semua.map((r) => periodDate(r).slice(0, 7)).filter(Boolean))).sort((a, b) => b.localeCompare(a));
          const bulanAktif = bulanPerKolom[s] || '';
          const dalamBulan = bulanAktif ? semua.filter((r) => periodDate(r).slice(0, 7) === bulanAktif) : semua;
          // Penajaman opsional dari filter bulan: opsi hari dibangun dari isi
          // dalamBulan (bukan seluruh kolom), supaya kalau bulan dipilih,
          // pilihan harinya cuma hari-hari yang benar-benar ada di bulan itu.
          const hariOptions = Array.from(new Set(dalamBulan.map((r) => periodDate(r).slice(0, 10)).filter(Boolean))).sort((a, b) => b.localeCompare(a));
          const hariAktif = hariPerKolom[s] || '';
          const dalamHari = hariAktif ? dalamBulan.filter((r) => periodDate(r).slice(0, 10) === hariAktif) : dalamBulan;
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
                  {items.length} {tr("prospek ·")} {formatRupiah(totalVal)}
                  {(bulanAktif || hariAktif || fakturAktif) && semua.length !== items.length && <span> {tr("(dari")} {semua.length})</span>}
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
                    title={s === 4 ? tr("Saring berdasar bulan PO") : s === 5 ? tr("DO terfaktur (Omzet): bulan faktur · GIT (belum terfaktur): bulan masuk DO") : tr("Saring berdasar bulan perubahan status ke tahap ini")}
                  >
                    <option value="">{tr("Semua bulan")}</option>
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
                    title={s === 4 ? tr("Persempit ke tanggal PO tertentu") : s === 5 ? tr("Persempit ke tanggal faktur (Omzet) / tanggal masuk DO (GIT)") : tr("Persempit lagi ke hari tertentu perubahan status ke tahap ini")}
                  >
                    <option value="">{tr("Semua hari")}{bulanAktif ? tr(" di bulan ini") : ''}</option>
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
                    title={tr("Urutkan kartu di kolom ini")}
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
                    title={tr("Saring DO berdasar status faktur: Omzet (sudah terfaktur) atau GIT (belum terfaktur)")}
                  >
                    <option value="">{tr("Semua (Omzet + GIT)")}</option>
                    <option value="omzet">{tr("Omzet (Terfaktur) ·")} {nOmzet}</option>
                    <option value="git">{tr("GIT (Belum Terfaktur) ·")} {dalamHari.length - nOmzet}</option>
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
                  <div className="kanban-empty">{fakturAktif ? (fakturAktif === 'omzet' ? 'Tidak ada DO terfaktur' : 'Tidak ada DO berstatus GIT') + (bulanAktif || hariAktif ? ' pada periode ini' : '') : hariAktif ? tr("Tidak ada perubahan status di hari ini") : bulanAktif ? tr("Tidak ada perubahan status di bulan ini") : tr("Tidak ada data")}</div>
                ) : (
                  shown.map((r) => <KanbanCard key={r.id} r={r} purchCount={purchCounts[r.id]} starCount={starCounts.get(r.id)} />)
                )}
                {items.length > CAP && <div className="kanban-more">+{items.length - CAP} {tr("lainnya — persempit dengan filter")}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {pendingMove && (
        <FollowUpMoveModal
          prospect={pendingMove.rec}
          toStatus={pendingMove.to}
          onCancel={() => setPendingMove(null)}
          onConfirm={async (followUpAt, followUpNote) => {
            const ok = await commitMove(pendingMove.rec, pendingMove.to, { followUpAt, followUpNote });
            if (ok) setPendingMove(null);
          }}
        />
      )}
    </>
  );
}

/** Target kedatangan barang Indent / Import (diisi Purchasing). */
function ArrivalChip({ r }: { r: Prospect }) {
  const tr = useT();
  const c = arrivalChip(r, jakartaDate());
  if (!c) return null;
  return (
    <div className="kc-meta-row">
      <span className={`kc-eta ${c.cls}`} title={tr("Target kedatangan dari Purchasing (PO Indent)")}>{c.text}</span>
    </div>
  );
}
