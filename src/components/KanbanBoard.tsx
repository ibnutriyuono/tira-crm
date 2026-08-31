'use client';

import { useState } from 'react';
import { KANBAN_STATUSES, STATUS_META } from '@/lib/constants';
import { classify, formatRupiah, klasBadgeColor, num, valueHighlightClass } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';
import { IconCart, IconDoc, IconEdit, IconRfq, IconTrash, IconWa } from './icons';

const CAP = 40;

function KanbanCard({ r }: { r: Prospect }) {
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
        <span className="kc-customer">{r.customer}</span>
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

export function KanbanBoard({ filtered }: { filtered: Prospect[] }) {
  const openModal = useUiStore((s) => s.openModal);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);
  const [dragOverStatus, setDragOverStatus] = useState<number | null>(null);

  async function handleDrop(newStatus: number, e: React.DragEvent) {
    e.preventDefault();
    setDragOverStatus(null);
    const id = e.dataTransfer.getData('text/plain');
    const rec = filtered.find((x) => x.id === id) || useDataStore.getState().prospects.find((x) => x.id === id);
    if (!rec || num(rec.status) === newStatus) return;

    const optimistic = { ...rec, status: newStatus };
    upsertProspect(optimistic);
    toast('Status prospek diperbarui', 'success');
    if (newStatus === 4 || newStatus === 6) {
      useUiStore.setState({ qcdCtx: { mode: 'kanban', statusVal: newStatus, recordId: id } });
      openModal('qcd');
    }
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
          const items = filtered.filter((r) => num(r.status) === s);
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
                </div>
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
                  <div className="kanban-empty">Tidak ada data</div>
                ) : (
                  shown.map((r) => <KanbanCard key={r.id} r={r} />)
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
