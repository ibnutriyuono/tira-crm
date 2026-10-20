'use client';

import { useUiStore } from '@/store/useUiStore';

import { useT } from '@/store/useLangStore';
export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const tr = useT();
  const ui = useUiStore();

  return (
    <div className="pagination">
      <div className="pg-info">
        {tr("Halaman")} {page} {tr("dari")} {totalPages}
      </div>
      <div className="pg-controls">
        <select
          className="btn-sm"
          value={String(ui.pageSize)}
          onChange={(e) => ui.setFilter({ pageSize: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
        >
          <option value="25">{tr("25 / halaman")}</option>
          <option value="50">{tr("50 / halaman")}</option>
          <option value="100">{tr("100 / halaman")}</option>
          <option value="all">{tr("Semua")}</option>
        </select>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => useUiStore.setState({ page: page - 1 })}>
          {tr("« Prev")}
        </button>
        <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => useUiStore.setState({ page: page + 1 })}>
          {tr("Next »")}
        </button>
      </div>
    </div>
  );
}
