'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { STATUS_META } from '@/lib/constants';
import { classify, formatDateID, formatRupiah } from '@/lib/format';
import { api } from '@/lib/api-client';
import { buildCustomerIntel, type CustomerIntelRow } from '@/lib/reports';
import {
  AKTIF_NEGLECT_DAYS,
  activitiesFor,
  buildActivityIndex,
  buildTimeline,
  localToday,
  matchContactFilter,
  summarizeContact,
  type ContactFilter,
  type ContactSummary,
} from '@/lib/customer-contact';
import { activityLabel } from '@/lib/reaktivasi';
import { matchScope, scopeAllLabel, scopeChoiceLabel, scopeGroups } from '@/lib/scope-picker';
import { activityOwner } from '@/lib/sales-activity';
import type { SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

type Row = CustomerIntelRow & { contact: ContactSummary };
const WRAP = { whiteSpace: 'normal', lineHeight: 1.35 } as const;
type SortKey = 'won' | 'recent' | 'stale' | 'contact';

const short = (s: string | null | undefined, n = 60) => {
  const t = (s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function CustomerIntelModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customerIntel';
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const records = useDataStore((s) => s.prospects);
  const currentUser = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const canLogActivity = !!currentUser && activityOwner(currentUser) !== null;

  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'timeline' | 'transaksi'>('timeline');
  const [healthFilter, setHealthFilter] = useState('');
  const [contactFilter, setContactFilter] = useState<ContactFilter>('');
  const [sortBy, setSortBy] = useState<SortKey>('won');
  /** Cakupan: '' = semua yang terlihat oleh role ini, atau reg:/cab:/se: (lib/scope-picker). */
  const [scope, setScope] = useState('');

  // Aktivitas Harian in the user's scope (Sales: own, BM: branch, RM: region, GM/Admin: all).
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [actLoaded, setActLoaded] = useState(false);
  const loadActivities = useCallback(async () => {
    try {
      setActivities((await api.get<{ activities: SalesActivity[] }>('/api/sales-activities?all=1')).activities);
    } catch {
      setActivities([]);
    } finally {
      setActLoaded(true);
    }
  }, []);
  // Reload on every open, so a contact just recorded via "Catat" shows up on return.
  useEffect(() => {
    if (show) void loadActivities();
  }, [show, loadActivities]);

  const today = localToday();
  const groups = useMemo(() => scopeGroups(currentUser, [...records, ...activities]), [currentUser, records, activities]);
  // A choice no longer offered (data/role changed) falls back to everything.
  const scopeAktif = groups.some((g) => g.options.some((o) => o.value === scope)) ? scope : '';
  const scopedRecords = useMemo(() => records.filter((r) => matchScope(scopeAktif, r)), [records, scopeAktif]);
  // Older activities may lack cabang/reg: take them from the SE's own prospects.
  const scopedActivities = useMemo(() => {
    if (!scopeAktif) return activities;
    const home = new Map<string, { cabang: string | null; reg: number | null }>();
    records.forEach((r) => {
      const se = (r.se || '').trim().toUpperCase();
      if (se && !home.has(se)) home.set(se, { cabang: r.cabang, reg: r.reg });
    });
    return activities.filter((a) => {
      const h = home.get((a.se || '').trim().toUpperCase());
      return matchScope(scopeAktif, { se: a.se, cabang: a.cabang || h?.cabang, reg: a.reg ?? h?.reg });
    });
  }, [activities, records, scopeAktif]);
  const index = useMemo(() => buildActivityIndex(scopedActivities), [scopedActivities]);
  const rows: Row[] = useMemo(
    () => buildCustomerIntel(scopedRecords).map((r) => ({ ...r, contact: summarizeContact(r, activitiesFor(index, r.name), today) })),
    [scopedRecords, index, today],
  );
  const scopeLabel = scopeChoiceLabel(scopeAktif, currentUser);

  const list = useMemo(() => {
    let l = rows;
    if (healthFilter) l = l.filter((r) => r.health === healthFilter);
    if (contactFilter) l = l.filter((r) => matchContactFilter(r.contact, contactFilter));
    if (search) {
      const q = search.toLowerCase();
      l = l.filter((r) => r.name.toLowerCase().includes(q) || r.cabang.toLowerCase().includes(q) || r.contact.ses.some((s) => s.toLowerCase().includes(q)));
    }
    const sorted = l.slice();
    if (sortBy === 'won') sorted.sort((a, b) => b.wonValue - a.wonValue);
    if (sortBy === 'recent') sorted.sort((a, b) => (b.lastOrderDate || '').localeCompare(a.lastOrderDate || ''));
    if (sortBy === 'stale') sorted.sort((a, b) => (b.daysSinceOrder ?? -1) - (a.daysSinceOrder ?? -1));
    // Never contacted first, then longest since contact; bigger accounts first on ties.
    if (sortBy === 'contact')
      sorted.sort((a, b) => (b.contact.daysSinceContact ?? Infinity) - (a.contact.daysSinceContact ?? Infinity) || b.wonValue - a.wonValue);
    return sorted;
  }, [rows, search, healthFilter, contactFilter, sortBy]);

  const avgDays = (() => {
    const withOrder = rows.filter((r) => r.daysSinceOrder != null);
    if (withOrder.length === 0) return 0;
    return Math.round(withOrder.reduce((n, r) => n + (r.daysSinceOrder ?? 0), 0) / withOrder.length);
  })();
  const prioritas = rows.filter((r) => r.contact.prioritas);
  const disentuh30 = rows.filter((r) => r.contact.count30 > 0).length;

  function logContact(r: Row) {
    const order = r.lastOrderDate ? `terakhir order ${formatDateID(r.lastOrderDate)} (${r.daysSinceOrder} hari lalu)` : 'belum pernah order';
    useUiStore.setState({
      activityPrefill: { customer: r.name, tipe: 'kunjungan', keterangan: `Customer Intelligence — ${r.health}, ${order}. `, returnTo: 'customerIntel' },
    });
    openModal('salesActivity');
  }

  const catatButton = (r: Row, label = 'Catat') => (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={!canLogActivity}
      title={canLogActivity ? 'Catat kunjungan / telepon / meeting ke Aktivitas Harian' : 'Pencatatan aktivitas hanya untuk Sales dan BM'}
      onClick={(e) => {
        e.stopPropagation();
        logContact(r);
      }}
    >
      {label}
    </button>
  );

  async function exportExcel() {
    if (list.length === 0) return toast('Tidak ada data customer untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const header = [
      'CUSTOMER', 'CABANG', 'WON', 'TOTAL VALUE WON', 'AKTIF PIPELINE', 'LOST', 'WIN RATE', 'ORDER TERAKHIR', 'HARI SEJAK ORDER', 'STATUS',
      'KONTAK TERAKHIR', 'JENIS KONTAK', 'SE KONTAK', 'KETERANGAN KONTAK', 'HARI SEJAK KONTAK', 'KONTAK 30 HARI', 'KONTAK 90 HARI', 'STATUS KONTAK',
      'RENCANA BERIKUTNYA', 'SE YANG MENANGANI', 'PIC DIKENAL',
    ];
    const aoa: unknown[][] = [header];
    list.forEach((r) => {
      const c = r.contact;
      const plan = c.plans[0];
      aoa.push([
        r.name, r.cabang, r.won, r.wonValue, r.aktif, r.lost, `${r.winRate}%`, r.lastOrderDate || '', r.daysSinceOrder ?? '', r.health,
        c.last?.tanggal || '', c.last ? activityLabel(c.last.tipe) : '', c.last?.se || '', c.last?.keterangan || '', c.daysSinceContact ?? '',
        c.count30, c.count90, c.status,
        plan ? `${plan.tanggal} · ${activityLabel(plan.tipe)} · ${plan.se}` : '',
        c.ses.join(', '),
        c.pics.map((p) => (p.jabatan ? `${p.nama} (${p.jabatan})` : p.nama)).join(', '),
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 28 }, { wch: 8 }, { wch: 6 }, { wch: 18 }, { wch: 14 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 18 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 34 }, { wch: 32 }, { wch: 24 }, { wch: 36 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customer Intel');
    XLSX.writeFile(wb, `CRM_Customer_Intelligence_${scopeLabel.replace(/[^\w-]+/g, '_')}_${today}.xlsx`);
    toast(`Export berhasil: ${list.length} customer`, 'success');
  }

  const active = detail ? rows.find((r) => r.name === detail) : null;

  if (active) {
    const c = active.contact;
    const acts = activitiesFor(index, active.name);
    const timeline = buildTimeline(active.records, acts);
    const history = active.records
      .slice()
      .sort((a, b) => (b.tglPO || b.tglPenawaran || '').localeCompare(a.tglPO || a.tglPenawaran || ''));
    return (
      <Modal
        show={show}
        onClose={() => { setDetail(null); closeModal(); }}
        title={`Customer — ${active.name}`}
        xwide
        footer={
          <>
            {catatButton(active, 'Catat Aktivitas')}
            <button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>← Kembali</button>
          </>
        }
      >
        <div className="import-summary" style={{ marginTop: 0 }}>
          Total Won <b>{formatRupiah(active.wonValue)}</b> dari <b>{active.won}</b> deal · Aktif <b>{active.aktif}</b> · Lost <b>{active.lost}</b> ·
          Win rate <b>{active.winRate}%</b> · <span className={`badge ${active.healthColor}`}>{active.health}</span>
          {active.daysSinceOrder != null ? ` · ${active.daysSinceOrder} hari sejak order terakhir` : ' · belum pernah order'}
        </div>

        <div className="kpi-grid" style={{ marginTop: 12 }}>
          <div className="kpi">
            <div className="label">Kontak Terakhir</div>
            <div className="value" style={{ fontSize: 18 }}>{c.last ? formatDateID(c.last.tanggal) : '-'}</div>
            <div className="foot">{c.last ? `${activityLabel(c.last.tipe)} · ${c.last.se} · ${c.daysSinceContact} hari lalu` : 'Belum ada di Aktivitas Harian'}</div>
          </div>
          <div className="kpi">
            <div className="label">Kontak 30 / 90 Hari</div>
            <div className="value">{c.count30} / {c.count90}</div>
            <div className="foot">aktivitas selesai</div>
          </div>
          <div className="kpi">
            <div className="label">Status Kontak</div>
            <div className="value" style={{ fontSize: 14, lineHeight: 1.4 }}><span className={`badge ${c.statusColor}`} style={WRAP}>{c.status}</span></div>
            <div className="foot">{c.plans[0] ? `Rencana: ${formatDateID(c.plans[0].tanggal)} · ${activityLabel(c.plans[0].tipe)} · ${c.plans[0].se}` : 'Belum ada rencana kontak'}</div>
          </div>
          <div className="kpi">
            <div className="label">SE yang Menangani</div>
            <div className="value" style={{ fontSize: 15, lineHeight: 1.4 }}>{c.ses.length ? c.ses.join(', ') : '-'}</div>
            <div className="foot">dari Aktivitas Harian</div>
          </div>
          <div className="kpi">
            <div className="label">PIC Dikenal</div>
            <div className="value" style={{ fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>
              {c.pics.length ? c.pics.map((p) => (p.jabatan ? `${p.nama} (${p.jabatan})` : p.nama)).join(', ') : '-'}
            </div>
            <div className="foot">yang pernah ditemui/dihubungi</div>
          </div>
        </div>

        <div className="toolbar-row">
          <div className="seg">
            <button type="button" className={`btn btn-sm ${detailTab === 'timeline' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDetailTab('timeline')}>
              Timeline Interaksi ({timeline.length})
            </button>
            <button type="button" className={`btn btn-sm ${detailTab === 'transaksi' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDetailTab('transaksi')}>
              Riwayat Transaksi ({history.length})
            </button>
          </div>
        </div>

        {detailTab === 'timeline' ? (
          timeline.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 10px' }}><p>Belum ada interaksi tercatat.</p></div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table" style={{ minWidth: 960 }}>
                <thead>
                  <tr><th>Tanggal</th><th>Jenis</th><th>SE</th><th>Uraian / Keterangan</th><th>PIC</th><th>Nilai</th></tr>
                </thead>
                <tbody>
                  {timeline.map((e, i) => (
                    <tr key={`${e.tanggal}-${i}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateID(e.tanggal)}</td>
                      <td><span className={`badge ${e.color}`}>{e.jenis}</span></td>
                      <td>{e.se || '-'}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{e.uraian}</td>
                      <td>{e.pic || '-'}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{e.nilai != null ? formatRupiah(e.nilai) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 960 }}>
              <thead>
                <tr><th>Uraian</th><th>Cabang</th><th>SE</th><th>Tgl Penawaran</th><th>Tgl PO</th><th>Nilai</th><th>Status</th><th>Klasifikasi</th></tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.id}>
                      <td>{r.uraian || '-'}</td>
                      <td>{r.cabang || '-'}</td>
                      <td>{r.se || '-'}</td>
                      <td>{formatDateID(r.tglPenawaran)}</td>
                      <td>{formatDateID(r.tglPO)}</td>
                      <td className="mono">{formatRupiah(r.value)}</td>
                      <td><span className={`badge ${meta?.color || 'slate'}`}>{meta?.label || '-'}</span></td>
                      <td>{classify(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal show={show} onClose={closeModal} title={`Customer Intelligence — ${scopeLabel}`} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>Tutup</button>}>
      <div className="import-summary" style={{ marginTop: 0 }}>
        Rekap otomatis dari histori transaksi dan Aktivitas Harian tiap customer. Aktif = order dalam 45 hari terakhir, Menghangat = 46–90
        hari, Dingin = &gt;90 hari tanpa order. <b>Prioritas</b> = Dingin/Menghangat yang belum disentuh sejak order terakhir, atau Aktif yang
        tidak dihubungi &gt;{AKTIF_NEGLECT_DAYS} hari (dan belum ada rencana kontak). Data mengikuti cakupan role Anda.
      </div>

      {groups.length > 0 && (
        <div className="toolbar-row" style={{ marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            Cakupan
            <select className="btn-sm" value={scopeAktif} onChange={(e) => setScope(e.target.value)} title="Persempit ke regional, cabang atau SE tertentu dalam cakupan role Anda">
              <option value="">{scopeAllLabel(currentUser)}</option>
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {scopeAktif && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setScope('')}>
              Reset cakupan
            </button>
          )}
        </div>
      )}

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="label">Total Customer</div>
          <div className="value">{rows.length}</div>
          <div className="foot">Pernah tercatat bertransaksi/prospek</div>
        </div>
        <div className="kpi won">
          <div className="label">Aktif</div>
          <div className="value">{rows.filter((r) => r.health === 'Aktif').length}</div>
          <div className="foot">Order ≤ 45 hari</div>
        </div>
        <div className="kpi pending">
          <div className="label">Menghangat</div>
          <div className="value">{rows.filter((r) => r.health === 'Menghangat').length}</div>
          <div className="foot">46–90 hari</div>
        </div>
        <div className="kpi lost">
          <div className="label">Dingin (Follow-up)</div>
          <div className="value">{rows.filter((r) => r.health === 'Dingin (Follow-up)').length}</div>
          <div className="foot">&gt; 90 hari tanpa order</div>
        </div>
        <div className="kpi">
          <div className="label">Rata-rata Hari Sejak Order</div>
          <div className="value">{avgDays}</div>
          <div className="foot">dari customer yang pernah order</div>
        </div>
        <div
          className="kpi lost"
          style={{ cursor: 'pointer' }}
          title="Tampilkan customer prioritas"
          onClick={() => { setContactFilter('prioritas'); setHealthFilter(''); setSortBy('won'); }}
        >
          <div className="label">Prioritas Disentuh</div>
          <div className="value">{actLoaded ? prioritas.length : '…'}</div>
          <div className="foot">{formatRupiah(prioritas.reduce((s, r) => s + r.wonValue, 0))} histori won</div>
        </div>
        <div className="kpi">
          <div className="label">Dihubungi 30 Hari</div>
          <div className="value">{actLoaded ? disentuh30 : '…'}</div>
          <div className="foot">customer dengan ≥1 aktivitas</div>
        </div>
      </div>

      <div className="toolbar-row">
        <input type="search" className="search-grow" placeholder="Cari customer, cabang, SE" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="btn-sm" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="Aktif">Aktif</option>
          <option value="Menghangat">Menghangat</option>
          <option value="Dingin (Follow-up)">Dingin (perlu follow-up)</option>
          <option value="Belum Pernah Order">Belum Pernah Order</option>
        </select>
        <select className="btn-sm" value={contactFilter} onChange={(e) => setContactFilter(e.target.value as ContactFilter)}>
          <option value="">Semua Kontak</option>
          <option value="prioritas">Prioritas disentuh</option>
          <option value="gt30">Belum dihubungi &gt; 30 hari</option>
          <option value="gt60">Belum dihubungi &gt; 60 hari</option>
          <option value="gt90">Belum dihubungi &gt; 90 hari</option>
          <option value="rencana">Ada rencana kontak</option>
        </select>
        <select className="btn-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
          <option value="won">Urutkan: Total Won Tertinggi</option>
          <option value="recent">Urutkan: Order Terbaru</option>
          <option value="stale">Urutkan: Paling Lama Tidak Order</option>
          <option value="contact">Urutkan: Paling Lama Tidak Dihubungi</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>Export Excel</button>
      </div>
      <div className="import-summary">Menampilkan <b>{list.length}</b> dari <b>{rows.length}</b> customer</div>
      {list.length === 0 ? (
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>Belum ada data</h3><p>Ringkasan ini dihitung otomatis dari daftar prospek.</p></div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>Customer</th><th>Cabang</th><th>Total Value Won</th><th>Order Terakhir</th><th>Status</th>
                <th>Kontak Terakhir</th><th title="Aktivitas selesai 30 / 90 hari terakhir">30/90 H</th><th>Status Kontak</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const c = r.contact;
                return (
                  <tr key={r.name} style={{ cursor: 'pointer' }} onClick={() => { setDetail(r.name); setDetailTab('timeline'); }} title="Lihat timeline & riwayat transaksi">
                    <td style={{ fontWeight: 600, color: 'var(--steel-600)' }}>{r.name}</td>
                    <td>{r.cabang || '-'}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatRupiah(r.wonValue)}</td>
                    <td>{r.lastOrderDate ? `${formatDateID(r.lastOrderDate)} · ${r.daysSinceOrder} hari lalu` : '-'}</td>
                    <td><span className={`badge ${r.healthColor}`}>{r.health}</span></td>
                    <td style={{ minWidth: 160 }}>
                      {c.last ? (
                        <>
                          <div>{formatDateID(c.last.tanggal)} · {activityLabel(c.last.tipe)}</div>
                          <div className="field-note" style={{ margin: 0 }}>
                            {c.last.se}{c.last.keterangan ? ` — ${short(c.last.keterangan, 50)}` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="field-note" style={{ margin: 0 }}>{actLoaded ? 'Belum ada' : '…'}</span>
                      )}
                    </td>
                    <td className="center">{c.count30} / {c.count90}</td>
                    <td>
                      <span className={`badge ${c.statusColor}`} style={WRAP}>{c.status}</span>
                      {c.plans[0] && <div className="field-note" style={{ margin: 0 }}>Rencana {formatDateID(c.plans[0].tanggal)}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {catatButton(r)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
