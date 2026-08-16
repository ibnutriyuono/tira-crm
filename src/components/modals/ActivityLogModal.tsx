'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload } from '../icons';
import { api } from '@/lib/api-client';
import { ACTIVITY_ACTION_META, ACTIVITY_ENTITY_LABEL, STATUS_META } from '@/lib/constants';
import { todayStr } from '@/lib/format';
import { getSocket } from '@/lib/socket-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { ActivityLog } from '@/lib/types';

interface Actor {
  userId: string;
  username: string;
  name: string;
}
interface ActivityResponse {
  logs: ActivityLog[];
  total: number;
  page: number;
  pageSize: number;
  actors: Actor[];
}

const PAGE_SIZE = 50;

const EMPTY_FILTERS = { q: '', entity: '', action: '', userId: '', from: '', to: '' };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Renders one side of a field diff. Json columns (materials, items) would dump
 * unreadable blobs into the table, so arrays collapse to a count and the
 * prospect status number is resolved back to its label.
 */
function formatValue(entity: string, field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(kosong)';
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (Array.isArray(v)) return `${v.length} item`;
  if (typeof v === 'object') return JSON.stringify(v);
  if (entity === 'prospect' && field === 'status') return `${v} · ${STATUS_META[Number(v)]?.label ?? '-'}`;
  return String(v);
}

export function ActivityLogModal() {
  const show = useUiStore((s) => s.modal === 'activity');
  const closeModal = useUiStore((s) => s.closeModal);
  const toast = useDataStore((s) => s.toast);
  const currentUser = useDataStore((s) => s.currentUser);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function patchFilters(patch: Partial<typeof EMPTY_FILTERS>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQ) params.set('q', debouncedQ);
    if (filters.entity) params.set('entity', filters.entity);
    if (filters.action) params.set('action', filters.action);
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);

    setLoading(true);
    try {
      setData(await api.get<ActivityResponse>(`/api/activity?${params}`));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat log aktivitas', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedQ, filters.entity, filters.action, filters.userId, filters.from, filters.to, toast]);

  useEffect(() => {
    if (show) load();
  }, [show, load]);

  // Live tail: only while sitting on page 1, otherwise a new event would shift
  // rows out from under whatever page the reader is on.
  useEffect(() => {
    if (!show || page !== 1) return;
    const s = getSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onCreated = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 500); // coalesce bursts (e.g. an Excel import)
    };
    s.on('activity:created', onCreated);
    return () => {
      if (timer) clearTimeout(timer);
      s.off('activity:created', onCreated);
    };
  }, [show, page, load]);

  async function exportExcel() {
    const logs = data?.logs || [];
    if (logs.length === 0) return toast('Tidak ada log untuk diexport pada filter saat ini', 'error');
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [['WAKTU', 'USERNAME', 'NAMA', 'ROLE', 'AKSI', 'ENTITAS', 'AKTIVITAS', 'PERUBAHAN', 'IP']];
    logs.forEach((l) => {
      const detail = l.changes
        ? Object.entries(l.changes)
            .map(([k, c]) => `${c.label}: ${formatValue(l.entity, k, c.from)} → ${formatValue(l.entity, k, c.to)}`)
            .join('; ')
        : '';
      aoa.push([formatWhen(l.createdAt), l.username, l.actorName, l.role || '', ACTIVITY_ACTION_META[l.action]?.label || l.action, ACTIVITY_ENTITY_LABEL[l.entity] || l.entity, l.summary, detail, l.ip || '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 56 }, { wch: 56 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Log Aktivitas');
    XLSX.writeFile(wb, `CRM_Log_Aktivitas_${todayStr()}.xlsx`);
    toast(`Export berhasil: ${logs.length} baris log`, 'success');
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const scopeHint =
    currentUser?.role === 'admin' || currentUser?.role === 'gm'
      ? 'seluruh perusahaan'
      : currentUser?.role === 'rm'
        ? `Regional ${currentUser.reg ?? '-'}`
        : currentUser?.role === 'bm'
          ? `Cabang ${currentUser.cabang || '-'}`
          : 'aktivitas Anda sendiri';

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Log Aktivitas"
      xwide
      footer={
        <>
          <div className="pg-info" style={{ marginRight: 'auto' }}>
            Halaman {page} dari {totalPages} · {total} aktivitas
          </div>
          <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            &laquo; Prev
          </button>
          <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next &raquo;
          </button>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
        </>
      }
    >
      <div className="activity-filters">
        <div className="field search-field">
          <label htmlFor="act-q">Cari</label>
          <input id="act-q" type="search" placeholder="Cari aktivitas atau nama user…" value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="act-user">User</label>
          <select id="act-user" value={filters.userId} onChange={(e) => patchFilters({ userId: e.target.value })}>
            <option value="">Semua user</option>
            {(data?.actors || []).map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name} ({a.username})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="act-action">Aksi</label>
          <select id="act-action" value={filters.action} onChange={(e) => patchFilters({ action: e.target.value })}>
            <option value="">Semua aksi</option>
            {Object.entries(ACTIVITY_ACTION_META).map(([v, m]) => (
              <option key={v} value={v}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="act-entity">Entitas</label>
          <select id="act-entity" value={filters.entity} onChange={(e) => patchFilters({ entity: e.target.value })}>
            <option value="">Semua entitas</option>
            {Object.entries(ACTIVITY_ENTITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="act-from">Dari</label>
          <input id="act-from" type="date" value={filters.from} onChange={(e) => patchFilters({ from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="act-to">Sampai</label>
          <input id="act-to" type="date" value={filters.to} onChange={(e) => patchFilters({ to: e.target.value })} />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Reset
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel}>
              <IconDownload />
              Export
            </button>
          </div>
        </div>
      </div>

      <div className="hint" style={{ marginBottom: 10 }}>
        Menampilkan {scopeHint}. Log diperbarui realtime dan tidak dapat diubah atau dihapus dari aplikasi.
      </div>

      <div className="activity-table-wrap">
        <table className="simple-table activity-table">
          <thead>
            <tr>
              <th style={{ width: 168 }}>Waktu</th>
              <th style={{ width: 150 }}>User</th>
              <th style={{ width: 108 }}>Aksi</th>
              <th style={{ width: 92 }}>Entitas</th>
              <th>Aktivitas</th>
              <th style={{ width: 116 }}>IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={6} className="activity-empty">
                  Memuat log…
                </td>
              </tr>
            ) : (data?.logs.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={6} className="activity-empty">
                  Belum ada aktivitas yang cocok dengan filter ini.
                </td>
              </tr>
            ) : (
              data!.logs.map((l) => {
                const meta = ACTIVITY_ACTION_META[l.action] || { label: l.action, color: 'slate' };
                const changeKeys = l.changes ? Object.keys(l.changes) : [];
                const isOpen = expanded.has(l.id);
                return (
                  <tr key={l.id}>
                    <td className="mono activity-when">{formatWhen(l.createdAt)}</td>
                    <td>
                      <div className="activity-actor">{l.actorName}</div>
                      <div className="activity-actor-sub mono">{l.username}</div>
                    </td>
                    <td>
                      <span className={`badge ${meta.color}`}>{meta.label}</span>
                    </td>
                    <td>{ACTIVITY_ENTITY_LABEL[l.entity] || l.entity}</td>
                    <td>
                      <div>{l.summary}</div>
                      {changeKeys.length > 0 && (
                        <>
                          <button
                            type="button"
                            className="activity-toggle"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(l.id)) next.delete(l.id);
                                else next.add(l.id);
                                return next;
                              })
                            }
                          >
                            {isOpen ? '− Sembunyikan' : `+ ${changeKeys.length} perubahan`}
                          </button>
                          {isOpen && (
                            <ul className="activity-changes">
                              {changeKeys.map((k) => {
                                const c = l.changes![k];
                                return (
                                  <li key={k}>
                                    <b>{c.label}:</b> <span className="from">{formatValue(l.entity, k, c.from)}</span> → <span className="to">{formatValue(l.entity, k, c.to)}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </>
                      )}
                    </td>
                    <td className="mono activity-ip">{l.ip || '-'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
