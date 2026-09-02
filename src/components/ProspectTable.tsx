'use client';

import { classify, formatDateID, formatRupiah, klasBadgeColor, num, valueHighlightClass } from '@/lib/format';
import { STATUS_META } from '@/lib/constants';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';
import { IconDoc, IconEdit, IconRfq, IconTrash, IconWa } from './icons';
import { Pagination } from './Pagination';
import { ProspectPurchasingBubble, useProspectPurchasingCounts } from './ProspectPurchasingBubble';

const COLS: { key: string; label: string; sortable?: boolean }[] = [
  { key: 'no', label: 'No' },
  { key: 'reg', label: 'Reg', sortable: true },
  { key: 'cabang', label: 'Cabang', sortable: true },
  { key: 'se', label: 'SE', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true },
  { key: 'uraian', label: 'Produk', sortable: true },
  { key: 'qty', label: 'Qty', sortable: true },
  { key: 'value', label: 'Value', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'klas', label: 'Klasifikasi' },
  { key: 'penawaranTerkirim', label: 'Penawaran', sortable: true },
  { key: 'tglPenawaran', label: 'Tgl Penawaran', sortable: true },
  { key: 'aksi', label: 'Aksi' },
];

export function ProspectTable({ filtered, total }: { filtered: Prospect[]; total: number }) {
  const ui = useUiStore();
  const openModal = useUiStore((s) => s.openModal);
  // Above the empty-list early return — hooks cannot run conditionally.
  const purchCounts = useProspectPurchasingCounts(true);

  if (filtered.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <h3>{total === 0 ? 'Belum ada data prospek' : 'Tidak ada data yang cocok dengan filter'}</h3>
          <p>{total === 0 ? 'Mulai dengan menambah prospek baru, atau import file Excel prospect list yang sudah ada.' : 'Coba ubah atau reset filter pencarian.'}</p>
          {total === 0 && (
            <button
              className="btn btn-primary"
              onClick={() => {
                useUiStore.setState({ editProspectId: null });
                openModal('prospectForm');
              }}
            >
              + Tambah Prospek Pertama
            </button>
          )}
        </div>
      </div>
    );
  }

  const pageSize = ui.pageSize === 'all' ? filtered.length : ui.pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(ui.page, totalPages);
  const startIdx = (page - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  function toggleSort(key: string) {
    if (ui.sortKey === key) ui.setFilter({ sortDir: ui.sortDir === 'asc' ? 'desc' : 'asc', page: ui.page });
    else ui.setFilter({ sortKey: key, sortDir: 'asc', page: ui.page });
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => {
                const arrow = ui.sortKey === c.key ? (ui.sortDir === 'asc' ? '▲' : '▼') : '';
                return (
                  <th key={c.key} onClick={c.sortable ? () => toggleSort(c.key) : undefined}>
                    {c.label}
                    {arrow && <span className="arrow">{arrow}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r, idx) => {
              const klas = classify(r);
              const stMeta = STATUS_META[num(r.status)] || STATUS_META[0];
              return (
                <tr key={r.id} className={valueHighlightClass(r.value)}>
                  <td className="num">{startIdx + idx + 1}</td>
                  <td className="center">{r.reg || '-'}</td>
                  <td>{r.cabang || '-'}</td>
                  <td>{r.se || '-'}</td>
                  <td className="customer">{r.customer || '-'}<ProspectPurchasingBubble count={purchCounts[r.id]} /></td>
                  <td className="produk">{r.uraian || '-'}</td>
                  <td className="num">{num(r.qty).toLocaleString('id-ID')}</td>
                  <td className="num">{formatRupiah(r.value)}</td>
                  <td>
                    <span className={`badge ${stMeta.color}`}>
                      {num(r.status)} · {stMeta.label}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${klasBadgeColor(klas)}`}>{klas}</span>
                  </td>
                  <td>
                    <span className={`badge ${r.penawaranTerkirim ? 'green' : 'rust pending-dot'}`}>{r.penawaranTerkirim ? 'Terkirim' : 'Pending'}</span>
                  </td>
                  <td className="mono">{formatDateID(r.tglPenawaran)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn wa-btn"
                        title="Follow Up WhatsApp"
                        onClick={() => {
                          useUiStore.setState({ followUpCtx: { type: 'prospect', id: r.id } });
                          openModal('followUp');
                        }}
                      >
                        <IconWa />
                      </button>
                      <button
                        className="icon-btn doc-btn"
                        title="Buat Surat Penawaran"
                        onClick={() => {
                          useUiStore.setState({ quotationProspectId: r.id });
                          openModal('quotation');
                        }}
                      >
                        <IconDoc />
                      </button>
                      <button
                        className="icon-btn rfq-btn"
                        title="Buat RFQ ke Purchasing"
                        onClick={() => {
                          useUiStore.setState({ rfqCtx: { prospectId: r.id, rfqId: null } });
                          openModal('rfq');
                        }}
                      >
                        <IconRfq />
                      </button>
                      <button
                        className="icon-btn edit-btn"
                        title="Edit"
                        onClick={() => {
                          useUiStore.setState({ editProspectId: r.id });
                          openModal('prospectForm');
                        }}
                      >
                        <IconEdit />
                      </button>
                      <button
                        className="icon-btn danger del-btn"
                        title="Hapus"
                        onClick={() => {
                          useUiStore.setState({
                            deleteCtx: { mode: 'prospect', id: r.id, title: 'Hapus Prospek', message: `Yakin ingin menghapus prospek "${r.customer}"? Tindakan ini tidak dapat dibatalkan.` },
                          });
                          openModal('delete');
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} />
    </>
  );
}
