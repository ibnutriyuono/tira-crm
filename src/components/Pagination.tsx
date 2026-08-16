'use client';

import { useUiStore } from '@/store/useUiStore';

export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const ui = useUiStore();

  return (
    <div className="pagination">
      <div className="pg-info">
        Halaman {page} dari {totalPages}
      </div>
      <div className="pg-controls">
        <select
          className="btn-sm"
          value={String(ui.pageSize)}
          onChange={(e) => ui.setFilter({ pageSize: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
        >
          <option value="25">25 / halaman</option>
          <option value="50">50 / halaman</option>
          <option value="100">100 / halaman</option>
          <option value="all">Semua</option>
        </select>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => useUiStore.setState({ page: page - 1 })}>
          &laquo; Prev
        </button>
        <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => useUiStore.setState({ page: page + 1 })}>
          Next &raquo;
        </button>
      </div>
    </div>
  );
}
