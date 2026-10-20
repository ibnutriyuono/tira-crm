'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconPlus, IconTrash } from '../icons';
import { api } from '@/lib/api-client';
import { formatDateID, formatRupiah, num } from '@/lib/format';
import {
  KAM_ACTION_STATUS,
  KAM_POLA,
  KAM_TIERS,
  KAM_TIER_META,
  buildGroupIndex,
  canManageKam,
  groupForCustomer,
  groupOmzetYtd,
  isKeyTier,
  normalizeCustomerName,
  type GroupOmzet,
  kamFlags,
  type KamFlag,
} from '@/lib/kam';
import { localToday } from '@/lib/sales-activity';
import { CABANG_LIST } from '@/lib/constants';

/** 'YYYY-MM-DD' + n days (UTC math on a date-only value, no timezone drift). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
import type { CustomerGroup, KamAction, KamTeam, KamTier, Prospect, SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { canNow, useCan } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
type Tab = 'ringkasan' | 'daftar' | 'profil' | 'struktur';
interface RosterUser {
  id: string;
  name: string;
  role: string;
  cabang: string | null;
}

const ROLE_LABEL: Record<string, string> = { gm: 'GM', rm: 'RM', bm: 'BM', sales: 'Sales', admin: 'Admin', purchasing: 'Purchasing', purchasing05: 'PIC Line 05' };
const rpJt = (n: number | null) => (n == null ? '-' : `Rp ${Math.round(n).toLocaleString('id-ID')} jt`);
const pctTxt = (n: number | null, sign = false) => (n == null ? '-' : `${sign && n > 0 ? '+' : ''}${Math.round(n)}%`);
const FLAG_BADGE: Record<KamFlag['level'], string> = { high: 'rust', mid: 'amber', low: 'violet' };
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
const WON = (p: Prospect) => num(p.status) === 4 || num(p.status) === 5;
const OPEN = (p: Prospect) => num(p.status) >= 1 && num(p.status) <= 3;

const EMPTY_TEAM: KamTeam = { sponsorId: null, ketuaId: null, sekretarisId: null, anggotaIds: [] };

/**
 * Key Account Management: ringkasan & sinyal risiko, daftar grup, profil &
 * account plan, struktur organisasi (tim nasional + grup: perusahaan, omzet YTD, ketua, sekretaris, PIC). Tier,
 * skor dan angka omzet/margin berasal dari analisa KAM (impor Excel); kontak
 * terakhir dan pipeline dihitung dari data CRM.
 */
export function KeyAccountModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'keyAccount');
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const groups = useDataStore((s) => s.customerGroups);
  const prospects = useDataStore((s) => s.prospects);
  const rfqs = useDataStore((s) => s.rfqs);
  const upsertGroup = useDataStore((s) => s.upsertCustomerGroup);
  const removeGroup = useDataStore((s) => s.removeCustomerGroup);
  const setGroups = useDataStore((s) => s.setCustomerGroups);
  const toast = useDataStore((s) => s.toast);

  const customers = useDataStore((s) => s.customers);
  const customerNames = useMemo(() => [...new Set(customers.map((c) => (c.name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [customers]);
  // Kelola Role: tanpa hak Tambah/Ubah Key Account semua isian jadi hanya-baca; hapus grup butuh hak Hapus.
  const kamE = useCan('kam', 'e');
  const kamD = useCan('kam', 'd');
  const manager = kamE && canManageKam(currentUser?.role);
  const today = localToday();

  const [tab, setTab] = useState<Tab>('ringkasan');
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [team, setTeam] = useState<KamTeam>(EMPTY_TEAM);
  const [teamDirty, setTeamDirty] = useState(false);
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [selId, setSelId] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<'' | KamTier>('');
  const [q, setQ] = useState('');
  const [onlyRisk, setOnlyRisk] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t, a, g] = await Promise.all([
        api.get<{ roster: RosterUser[] }>('/api/users/roster'),
        api.get<{ team: KamTeam }>('/api/kam-team'),
        api.get<{ activities: SalesActivity[] }>('/api/sales-activities?all=1').catch(() => ({ activities: [] as SalesActivity[] })),
        api.get<{ groups: CustomerGroup[] }>('/api/customer-groups'),
      ]);
      setRoster(r.roster.filter((u) => u.role !== 'purchasing05'));
      setTeam(t.team);
      setTeamDirty(false);
      setActivities(a.activities);
      setGroups(g.groups);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat Key Account', 'error');
    }
  }, [setGroups, toast]);

  useEffect(() => {
    if (show) void load();
  }, [show, load]);

  const userName = useCallback((id: string | null | undefined) => {
    if (!id) return '';
    const u = roster.find((x) => x.id === id);
    return u ? `${u.name}` : '(user dihapus)';
  }, [roster]);
  const userLabel = (u: RosterUser) => `${u.name} · ${ROLE_LABEL[u.role] || u.role}${u.cabang ? ` ${u.cabang}` : ''}`;

  // Per group: last contact (Aktivitas Harian), CRM pipeline and won value.
  const stats = useMemo(() => {
    const idx = buildGroupIndex(groups);
    const m = new Map<string, { lastContact: string | null; open: number; openValue: number; wonYear: number; prospects: Prospect[]; cabangs: Set<string> }>();
    groups.forEach((g) => m.set(g.id, { lastContact: null, open: 0, openValue: 0, wonYear: 0, prospects: [], cabangs: new Set() }));
    activities.forEach((a) => {
      if (a.status === 'rencana') return;
      const g = groupForCustomer(idx, a.customer);
      if (!g) return;
      const s = m.get(g.id)!;
      if (!s.lastContact || a.tanggal > s.lastContact) s.lastContact = a.tanggal;
    });
    const year = today.slice(0, 4);
    prospects.forEach((p) => {
      const g = groupForCustomer(idx, p.customer);
      if (!g) return;
      const s = m.get(g.id)!;
      s.prospects.push(p);
      if (p.cabang) s.cabangs.add(p.cabang.toUpperCase());
      if (OPEN(p)) {
        s.open++;
        s.openValue += num(p.value);
      }
      if (WON(p) && (p.tglPO || p.tglPenawaran || '').startsWith(year)) s.wonYear += num(p.value);
    });
    return { idx, m };
  }, [groups, activities, prospects, today]);

  const daysSince = (g: CustomerGroup) => {
    const lc = stats.m.get(g.id)?.lastContact;
    return lc ? daysBetween(lc, today) : null;
  };
  const flagsOf = (g: CustomerGroup) => kamFlags(g, { today, daysSinceContact: daysSince(g) });

  const sel = groups.find((g) => g.id === selId) || groups.find((g) => isKeyTier(g.tier)) || groups[0] || null;
  const openProfile = (id: string) => {
    setSelId(id);
    setTab('profil');
  };

  async function saveGroup(id: string, patch: Record<string, unknown>, ok = 'Tersimpan') {
    setBusy(true);
    try {
      const { group } = await api.put<{ group: CustomerGroup }>(`/api/customer-groups/${id}`, patch);
      upsertGroup(group);
      toast(ok, 'success');
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr("Key Account Management")}
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          {tr("Tutup")}
        </button>
      }
    >
      <div className="ea-tabs" role="tablist">
        {(
          [
            ['ringkasan', tr("Ringkasan")],
            ['daftar', tr("Daftar Grup")],
            ['profil', tr("Profil & Account Plan")],
            ['struktur', tr("Struktur Organisasi")],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'ringkasan' && <Ringkasan groups={groups} stats={stats} flagsOf={flagsOf} userName={userName} today={today} prospects={prospects} rfqs={rfqs} openProfile={openProfile} />}
      {tab === 'daftar' && (
        <Daftar
          groups={groups}
          manager={manager}
          tierFilter={tierFilter}
          setTierFilter={setTierFilter}
          q={q}
          setQ={setQ}
          onlyRisk={onlyRisk}
          setOnlyRisk={setOnlyRisk}
          flagsOf={flagsOf}
          daysSince={daysSince}
          userName={userName}
          openProfile={openProfile}
          onImported={(g) => setGroups(g)}
          onCreated={(g) => {
            upsertGroup(g);
            openProfile(g.id);
          }}
        />
      )}
      {tab === 'profil' &&
        (sel ? (
          <Profil
            key={sel.id}
            g={sel}
            groups={groups}
            setSelId={setSelId}
            manager={manager}
            isKetua={kamE && !!currentUser && sel.ketuaId === currentUser.id}
            canDelete={kamD && (currentUser?.role === 'gm' || currentUser?.role === 'admin')}
            stat={stats.m.get(sel.id)}
            flags={flagsOf(sel)}
            daysSince={daysSince(sel)}
            userName={userName}
            busy={busy}
            saveGroup={saveGroup}
            goStruktur={() => setTab('struktur')}
            onDeleted={(id) => {
              removeGroup(id);
              setSelId('');
              setTab('daftar');
            }}
          />
        ) : (
          <div className="empty-state">{tr("Belum ada grup. Tambahkan grup atau impor dari Excel analisa KAM di tab Daftar Grup.")}</div>
        ))}
      {tab === 'struktur' && (
        <Struktur
          groups={groups}
          roster={roster}
          userLabel={userLabel}
          userName={userName}
          team={team}
          setTeam={(t) => {
            setTeam(t);
            setTeamDirty(true);
          }}
          teamDirty={teamDirty}
          manager={manager}
          canDelete={kamD && (currentUser?.role === 'gm' || currentUser?.role === 'admin')}
          currentUserId={kamE ? currentUser?.id || '' : ''}
          busy={busy}
          prospects={prospects}
          customerNames={customerNames}
          today={today}
          createGroup={async (name) => {
            setBusy(true);
            try {
              const { group } = await api.post<{ group: CustomerGroup }>('/api/customer-groups', { name });
              upsertGroup(group);
              toast(`Grup "${group.name}" dibuat`, 'success');
              return true;
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Gagal membuat grup', 'error');
              return false;
            } finally {
              setBusy(false);
            }
          }}
          deleteGroup={async (g) => {
            if (!window.confirm(`Hapus grup "${g.name}"? Perusahaan di dalamnya tidak terhapus, hanya keluar dari grup.`)) return;
            setBusy(true);
            try {
              await api.del(`/api/customer-groups/${g.id}`);
              removeGroup(g.id);
              toast(`Grup "${g.name}" dihapus`, 'success');
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Gagal menghapus grup', 'error');
            } finally {
              setBusy(false);
            }
          }}
          saveTeam={async () => {
            setBusy(true);
            try {
              const r = await api.put<{ team: KamTeam }>('/api/kam-team', team);
              setTeam(r.team);
              setTeamDirty(false);
              toast('Tim KAM nasional disimpan', 'success');
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Gagal menyimpan tim', 'error');
            } finally {
              setBusy(false);
            }
          }}
          saveGroup={saveGroup}
          openProfile={openProfile}
        />
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

type Stats = { idx: Map<string, CustomerGroup>; m: Map<string, { lastContact: string | null; open: number; openValue: number; wonYear: number; prospects: Prospect[]; cabangs: Set<string> }> };

function TierBadge({ tier }: { tier: KamTier }) {
  const m = KAM_TIER_META[tier];
  return <span className={`kam-badge ${tier}`}>{isKeyTier(tier) ? '★ ' : ''}{m.label}</span>;
}

function Flags({ flags }: { flags: KamFlag[] }) {
  if (!flags.length) return <span className="field-note" style={{ margin: 0 }}>–</span>;
  return (
    <span className="kam-flags">
      {flags.map((f) => (
        <span key={f.key} className={`badge ${FLAG_BADGE[f.level]}`}>
          {f.text}
        </span>
      ))}
    </span>
  );
}

function Ringkasan({
  groups, stats, flagsOf, userName, today, prospects, rfqs, openProfile,
}: {
  groups: CustomerGroup[];
  stats: Stats;
  flagsOf: (g: CustomerGroup) => KamFlag[];
  userName: (id: string | null | undefined) => string;
  today: string;
  prospects: Prospect[];
  rfqs: { id: string; noRfq: string | null; tglRfq: string | null; cabang: string | null; customer: string | null; createdAt: string }[];
  openProfile: (id: string) => void;
}) {
  const tr = useT();
  const totalL12 = groups.reduce((s, g) => s + (g.l12m || 0), 0);
  const risky = groups.filter((g) => isKeyTier(g.tier)).map((g) => ({ g, f: flagsOf(g) })).filter((x) => x.f.length).sort((a, b) => b.f.filter((x) => x.level === 'high').length - a.f.filter((x) => x.level === 'high').length);
  const since = addDays(today, -60);
  const cross = [
    ...prospects.filter((p) => (p.tglPenawaran || p.createdAt || '').slice(0, 10) >= since).map((p) => ({ kind: 'Prospek', id: p.id, no: '', tgl: (p.tglPenawaran || p.createdAt).slice(0, 10), cabang: p.cabang, customer: p.customer })),
    ...rfqs.filter((r) => (r.tglRfq || r.createdAt || '').slice(0, 10) >= since).map((r) => ({ kind: 'RFQ', id: r.id, no: r.noRfq || '', tgl: (r.tglRfq || r.createdAt).slice(0, 10), cabang: r.cabang, customer: r.customer || '' })),
  ]
    .map((x) => ({ ...x, g: groupForCustomer(stats.idx, x.customer) }))
    .filter((x) => x.g && x.g.homeCabang && x.cabang && x.cabang.toUpperCase() !== x.g.homeCabang.toUpperCase())
    .sort((a, b) => b.tgl.localeCompare(a.tgl))
    .slice(0, 12);
  const reviews = groups.filter((g) => isKeyTier(g.tier) && g.reviewNext && g.reviewNext <= addDays(today, 21)).sort((a, b) => (a.reviewNext || '').localeCompare(b.reviewNext || ''));

  if (!groups.length) return <div className="empty-state">{tr("Belum ada grup Key Account. Buka tab Daftar Grup untuk menambah atau mengimpor dari Excel analisa KAM.")}</div>;

  return (
    <>
      <div className="kpi-grid">
        {KAM_TIERS.map((t) => {
          const list = groups.filter((g) => g.tier === t.key);
          const l12 = list.reduce((s, g) => s + (g.l12m || 0), 0);
          return (
            <div key={t.key} className="kpi" style={{ borderLeftColor: t.color }}>
              <div className="label">{isKeyTier(t.key) ? '★ ' : ''}{t.label}</div>
              <div className="value">{list.length} {tr("akun")}</div>
              <div className="foot">
                {rpJt(l12)} · {totalL12 ? Math.round((l12 / totalL12) * 100) : 0}{tr("% L12M grup ·")} {t.rule}
              </div>
            </div>
          );
        })}
      </div>

      <div className="kam-grid">
        <Sec title={`Sinyal risiko — Strategic & Key (${risky.length})`} note={tr("YTD ≤ −30%, margin < 25%, tanpa transaksi ≥3 bulan, L12M < 50% rata-rata 3 th, kontak melewati batas tier")}>
          {risky.length === 0 ? (
            <div className="field-note">{tr("Tidak ada sinyal risiko.")}</div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr><th>{tr("Grup")}</th><th>{tr("Tier")}</th><th>{tr("Sinyal")}</th><th>{tr("Ketua tim")}</th></tr>
                </thead>
                <tbody>
                  {risky.map(({ g, f }) => (
                    <tr key={g.id} className="if-row" onClick={() => openProfile(g.id)}>
                      <td><b>{g.name}</b></td>
                      <td><TierBadge tier={g.tier} /></td>
                      <td><Flags flags={f} /></td>
                      <td style={{ fontSize: 12.5 }}>{userName(g.ketuaId) || <span className="badge rust">{tr("belum ada")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sec>
        <div>
          <Sec title={`Penawaran / RFQ lintas cabang — 60 hari (${cross.length})`} note={tr("Dibuat cabang di luar home cabang grup; ketua tim mendapat notifikasi")}>
            {cross.length === 0 ? (
              <div className="field-note">{tr("Tidak ada.")}</div>
            ) : (
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr><th>{tr("Dokumen")}</th><th>{tr("Customer")}</th><th>{tr("Dari → home")}</th><th>{tr("Ketua tim")}</th></tr>
                  </thead>
                  <tbody>
                    {cross.map((x) => (
                      <tr key={x.kind + x.id} className="if-row" onClick={() => openProfile(x.g!.id)}>
                        <td style={{ whiteSpace: 'nowrap' }}>{x.kind} {x.no}<div className="field-note" style={{ margin: 0 }}>{formatDateID(x.tgl)}</div></td>
                        <td>{x.customer}<div className="field-note" style={{ margin: 0 }}>{x.g!.name}</div></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{x.cabang} → <b>{x.g!.homeCabang}</b></td>
                        <td style={{ fontSize: 12.5 }}>{userName(x.g!.ketuaId) || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Sec>
          <Sec title={`Review jatuh tempo — 3 minggu (${reviews.length})`}>
            {reviews.length === 0 ? (
              <div className="field-note">{tr("Tidak ada review terjadwal dalam 3 minggu.")}</div>
            ) : (
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <tbody>
                    {reviews.map((g) => (
                      <tr key={g.id} className="if-row" onClick={() => openProfile(g.id)}>
                        <td><b>{g.name}</b></td>
                        <td>{formatDateID(g.reviewNext)}{g.reviewNext! < today && <span className="badge rust" style={{ marginLeft: 6 }}>{tr("lewat")}</span>}</td>
                        <td style={{ fontSize: 12.5 }}>{userName(g.ketuaId) || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Sec>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

const IMPORT_HEADERS = ['Grup', 'Tier', 'Skor', 'Pola', 'Segmen', 'Home cabang', 'Cabang pendukung', 'Omzet L12M (Rp jt)', 'Growth YTD', 'Margin', 'Rata-rata 3 th (Rp jt)', 'Transaksi terakhir (YYYY-MM)', 'Target (Rp jt)', 'Sponsor', 'Entitas'];
const HEADER_MAP: [RegExp, string][] = [
  [/^(grup|customer ?\/ ?grup|customer|nama)/i, 'name'],
  [/^tier/i, 'tier'],
  [/^skor/i, 'skor'],
  [/^pola/i, 'pola'],
  [/^segmen|vertikal/i, 'segmen'],
  [/^home/i, 'homeCabang'],
  [/pendukung|cabang yang melayani|support/i, 'supportCabang'],
  [/l12m|omzet l12/i, 'l12m'],
  [/growth|ytd/i, 'growthYtd'],
  [/^margin/i, 'margin'],
  [/rata.?rata|3 ?th/i, 'avg3y'],
  [/terakhir|last/i, 'lastTrx'],
  [/^target/i, 'target'],
  [/^sponsor/i, 'sponsor'],
  [/entitas|anggota grup/i, 'entities'],
];

function Daftar({
  groups, manager, tierFilter, setTierFilter, q, setQ, onlyRisk, setOnlyRisk, flagsOf, daysSince, userName, openProfile, onImported, onCreated,
}: {
  groups: CustomerGroup[];
  manager: boolean;
  tierFilter: '' | KamTier;
  setTierFilter: (t: '' | KamTier) => void;
  q: string;
  setQ: (s: string) => void;
  onlyRisk: boolean;
  setOnlyRisk: (b: boolean) => void;
  flagsOf: (g: CustomerGroup) => KamFlag[];
  daysSince: (g: CustomerGroup) => number | null;
  userName: (id: string | null | undefined) => string;
  openProfile: (id: string) => void;
  onImported: (g: CustomerGroup[]) => void;
  onCreated: (g: CustomerGroup) => void;
}) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [importing, setImporting] = useState(false);
  const [newName, setNewName] = useState('');
  const ql = q.trim().toLowerCase();
  const list = groups
    .filter((g) => !tierFilter || g.tier === tierFilter)
    .filter((g) => !ql || [g.name, g.homeCabang, userName(g.ketuaId), ...(g.entities || []), ...(g.supportCabang || [])].join(' ').toLowerCase().includes(ql))
    .filter((g) => !onlyRisk || flagsOf(g).length > 0)
    .sort((a, b) => KAM_TIERS.findIndex((t) => t.key === a.tier) - KAM_TIERS.findIndex((t) => t.key === b.tier) || (b.skor || 0) - (a.skor || 0));

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      IMPORT_HEADERS,
      ['PLN GROUP', 'Strategic', 95.9, 'A', 'Power Plant', 'SEMARANG', 'SBY-1; BANDUNG; CILEGON', 22440, '9%', '36%', 23367, '2026-08', '', 'GM', 'PLN (PERSERO); PLN NUSANTARA POWER; INDONESIA POWER'],
      ['UNITED TRACTORS GROUP', 'Key', 49.2, 'C', 'Mining', 'BALIKPAPAN', 'JKT-1', 908, '-67%', '35%', 5000, '2026-08', '', 'RM', 'UNITED TRACTORS; SANGGAR SARANA BAJA'],
    ]);
    ws['!cols'] = IMPORT_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Key Account');
    XLSX.writeFile(wb, 'Template_Impor_Key_Account.xlsx');
  }

  async function onFile(file: File) {
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer());
      const sheetName = wb.SheetNames.find((n) => /kandidat|key account|kam/i.test(n)) || wb.SheetNames[0];
      // raw:false keeps "36%" / "-70%" as typed, so percentages are read as percent points.
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { raw: false, defval: '' });
      const rows = raw
        .map((r) => {
          const o: Record<string, unknown> = {};
          Object.entries(r).forEach(([h, v]) => {
            const hit = HEADER_MAP.find(([re]) => re.test(h.trim()));
            if (hit && o[hit[1]] === undefined) o[hit[1]] = v;
          });
          return o;
        })
        .filter((o) => String(o.name || '').trim());
      if (!rows.length) {
        toast(`Tidak ada baris dengan kolom "Grup" di sheet ${sheetName}`, 'error');
        return;
      }
      const r = await api.post<{ created: number; updated: number; tierMoves: number; groups: CustomerGroup[] }>('/api/customer-groups/import', { rows, source: `Impor ${file.name}` });
      onImported(r.groups);
      toast(`Impor ${sheetName}: ${r.created} grup baru, ${r.updated} diperbarui, ${r.tierMoves} perubahan tier`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengimpor', 'error');
    } finally {
      setImporting(false);
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const { group } = await api.post<{ group: CustomerGroup }>('/api/customer-groups', { name: name.toUpperCase(), tier: 'key', tierReason: 'Ditambahkan manual' });
      setNewName('');
      onCreated(group);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menambah grup', 'error');
    }
  }

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {(['', 'strategic', 'key', 'development', 'monitor'] as const).map((t) => (
          <button key={t || 'all'} type="button" className={`btn btn-sm ${tierFilter === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTierFilter(t)}>
            {t ? `${isKeyTier(t) ? '★ ' : ''}${KAM_TIER_META[t].label} (${groups.filter((g) => g.tier === t).length})` : `Semua (${groups.length})`}
          </button>
        ))}
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Cari grup / entitas / ketua / cabang")} style={{ maxWidth: 260 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 13 }}>
          <input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} /> {tr("Hanya yang berisiko")}
        </label>
      </div>
      {manager && (
        <div className="toolbar-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={tr("Nama grup baru, cth. PUPUK INDONESIA GROUP")} style={{ maxWidth: 300 }} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button type="button" className="btn btn-primary btn-sm" onClick={create} disabled={!newName.trim()}>
            <IconPlus /> {tr("Grup baru")}
          </button>
          <label className="btn btn-outline btn-sm" style={{ margin: 0, cursor: 'pointer' }}>
            {importing ? tr("Mengimpor…") : tr("Impor dari Excel KAM")}
            <input type="file" accept=".xlsx,.xls" hidden disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
          </label>
          {canNow('kam', 'x') && (
            <button type="button" className="btn btn-outline btn-sm" onClick={downloadTemplate}>
              <IconDownload /> {tr("Template")}
            </button>
          )}
          <span className="field-note" style={{ margin: 0 }}>{tr("Impor mencocokkan nama grup; tim (ketua/sekretaris/anggota) tidak ditimpa.")}</span>
        </div>
      )}
      {list.length === 0 ? (
        <div className="empty-state">{groups.length ? tr("Tidak ada grup pada filter ini.") : tr("Belum ada grup Key Account.")}</div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table if-nowrap" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th>{tr("Grup")}</th><th>{tr("Tier")}</th><th style={{ textAlign: 'right' }}>{tr("Skor")}</th><th>{tr("Pola")}</th><th>{tr("Segmen")}</th><th>{tr("Ketua tim")}</th><th>{tr("Home · cabang")}</th>
                <th style={{ textAlign: 'right' }}>L12M</th><th style={{ textAlign: 'right' }}>YTD</th><th style={{ textAlign: 'right' }}>{tr("Margin")}</th><th>{tr("Kontak terakhir")}</th><th>{tr("Review")}</th><th>{tr("Sinyal")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const d = daysSince(g);
                const lim = KAM_TIER_META[g.tier].contactDays;
                return (
                  <tr key={g.id} className="if-row" onClick={() => openProfile(g.id)}>
                    <td><b>{g.name}</b>{g.entities?.length ? <div className="field-note" style={{ margin: 0 }}>{g.entities.length} {tr("entitas")}</div> : null}</td>
                    <td><TierBadge tier={g.tier} /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{g.skor == null ? '-' : g.skor.toLocaleString('id-ID')}</td>
                    <td><b>{g.pola || '-'}</b></td>
                    <td style={{ fontSize: 12.5 }}>{g.segmen || '-'}</td>
                    <td style={{ fontSize: 12.5 }}>{userName(g.ketuaId) || (isKeyTier(g.tier) ? <span className="badge rust">{tr("belum ada")}</span> : '-')}</td>
                    <td style={{ fontSize: 12.5 }}>{g.homeCabang || '-'} · {1 + (g.supportCabang?.length || 0)} {tr("cab")}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{rpJt(g.l12m)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: g.growthYtd == null ? undefined : g.growthYtd <= -30 ? 'var(--rust-600)' : g.growthYtd >= 0 ? 'var(--green-600)' : 'var(--amber-600)' }}>{pctTxt(g.growthYtd, true)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: g.margin != null && g.margin < 25 ? 'var(--rust-600)' : undefined }}>{pctTxt(g.margin)}</td>
                    <td><span className={`badge ${d == null ? 'slate' : d > lim ? 'rust' : d > lim * 0.7 ? 'amber' : 'green'}`}>{d == null ? tr("belum ada") : d === 0 ? tr("hari ini") : `${d} hari lalu`}</span></td>
                    <td style={{ fontSize: 12.5 }}>{g.reviewNext ? formatDateID(g.reviewNext) : '-'}</td>
                    <td><Flags flags={flagsOf(g).filter((f) => f.key !== 'contact')} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="field-note" style={{ marginTop: 8 }}>
        {tr("Tier, skor, L12M, YTD dan margin dari analisa KAM (impor Excel). Kontak terakhir dari Aktivitas Harian; batas kontak: Strategic")} {KAM_TIER_META.strategic.contactDays} {tr("hari, Key")} {KAM_TIER_META.key.contactDays} {tr("hari.")}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Profil({
  g, groups, setSelId, manager, isKetua, canDelete, stat, flags, daysSince, userName, busy, saveGroup, goStruktur, onDeleted,
}: {
  g: CustomerGroup;
  groups: CustomerGroup[];
  setSelId: (id: string) => void;
  manager: boolean;
  isKetua: boolean;
  canDelete: boolean;
  stat: Stats['m'] extends Map<string, infer V> ? V | undefined : never;
  flags: KamFlag[];
  daysSince: number | null;
  userName: (id: string | null | undefined) => string;
  busy: boolean;
  saveGroup: (id: string, patch: Record<string, unknown>, ok?: string) => Promise<boolean>;
  goStruktur: () => void;
  onDeleted: (id: string) => void;
}) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [tierReason, setTierReason] = useState('');
  const [actions, setActions] = useState<KamAction[]>(g.actions || []);
  const [actionsDirty, setActionsDirty] = useState(false);
  const canPlan = manager || isKetua;

  useEffect(() => {
    setActions(g.actions || []);
    setActionsDirty(false);
  }, [g.actions]);

  function startEdit() {
    setF({
      name: g.name, tier: g.tier, skor: g.skor == null ? '' : String(g.skor), pola: g.pola || '', segmen: g.segmen || '', homeCabang: g.homeCabang || '',
      supportCabang: (g.supportCabang || []).join(', '), sponsor: g.sponsor || '', l12m: g.l12m == null ? '' : String(g.l12m), growthYtd: g.growthYtd == null ? '' : String(g.growthYtd),
      margin: g.margin == null ? '' : String(g.margin), avg3y: g.avg3y == null ? '' : String(g.avg3y), lastTrx: g.lastTrx || '', target: g.target == null ? '' : String(g.target),
      reviewNext: g.reviewNext || '', entities: (g.entities || []).join('\n'), notes: g.notes || '',
    });
    setTierReason('');
    setEdit(true);
  }
  async function saveEdit() {
    if (f.tier !== g.tier && !tierReason.trim()) return toast('Isi alasan perubahan tier', 'error');
    const ok = await saveGroup(g.id, { ...f, supportCabang: f.supportCabang.split(/[,;\n]+/), entities: f.entities.split(/\n+/), tierReason }, 'Profil grup disimpan');
    if (ok) setEdit(false);
  }
  async function del() {
    if (!window.confirm(`Hapus grup "${g.name}"? Riwayat tier dan rencana aksi ikut terhapus.`)) return;
    try {
      await api.del(`/api/customer-groups/${g.id}`);
      onDeleted(g.id);
      toast('Grup dihapus', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    }
  }
  const setAct = (i: number, patch: Partial<KamAction>) => {
    setActions((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
    setActionsDirty(true);
  };

  // CRM pipeline per entity (prospects whose customer maps to this group).
  const byCustomer = new Map<string, { open: number; openValue: number; won: number; cabangs: Set<string> }>();
  (stat?.prospects || []).forEach((p) => {
    const k = p.customer.trim().toUpperCase();
    const e = byCustomer.get(k) || { open: 0, openValue: 0, won: 0, cabangs: new Set<string>() };
    if (OPEN(p)) {
      e.open++;
      e.openValue += num(p.value);
    }
    if (WON(p)) e.won += num(p.value);
    if (p.cabang) e.cabangs.add(p.cabang.toUpperCase());
    byCustomer.set(k, e);
  });
  const meta = KAM_TIER_META[g.tier];
  const multi = (g.supportCabang?.length || 0) > 0;

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={g.id} onChange={(e) => setSelId(e.target.value)} style={{ maxWidth: 320 }} aria-label={tr("Pilih grup")}>
          {KAM_TIERS.map((t) => (
            <optgroup key={t.key} label={t.label}>
              {groups.filter((x) => x.tier === t.key).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={goStruktur}>{tr("Atur tim")}</button>
        {manager && !edit && <button type="button" className="btn btn-primary btn-sm" onClick={startEdit}>{tr("Ubah profil / tier")}</button>}
        {canDelete && !edit && (
          <button type="button" className="btn btn-outline btn-sm" onClick={del} title={tr("Hapus grup")}>
            <IconTrash />
          </button>
        )}
      </div>

      {edit ? (
        <div className="if-panel" style={{ borderColor: 'var(--steel-500)' }}>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {[
              ['name', tr("Nama grup")], ['skor', tr("Skor (0–100)")], ['segmen', tr("Segmen / vertikal")], ['homeCabang', tr("Home cabang")], ['supportCabang', tr("Cabang pendukung (koma)")], ['sponsor', tr("Sponsor (GM / RM)")],
              ['l12m', tr("Omzet L12M (Rp jt)")], ['growthYtd', tr("Growth YTD (%)")], ['margin', tr("Margin (%)")], ['avg3y', tr("Rata-rata 3 th (Rp jt)")], ['lastTrx', tr("Transaksi terakhir (YYYY-MM)")], ['target', tr("Target tahun ini (Rp jt)")],
            ].map(([k, l]) => (
              <div key={k}>
                <label>{l}</label>
                <input type="text" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </div>
            ))}
            <div>
              <label>{tr("Tier")}</label>
              <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
                {KAM_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label>{tr("Pola")}</label>
              <select value={f.pola} onChange={(e) => setF({ ...f, pola: e.target.value })}>
                <option value="">-</option>
                {(['A', 'B', 'C'] as const).map((p) => <option key={p} value={p}>{p} · {KAM_POLA[p]}</option>)}
              </select>
            </div>
            <div>
              <label>{tr("Review berikutnya")}</label>
              <input type="date" value={f.reviewNext} onChange={(e) => setF({ ...f, reviewNext: e.target.value })} />
            </div>
            {f.tier !== g.tier && (
              <div className="full">
                <label>{tr("Alasan perubahan tier (")}{KAM_TIER_META[g.tier].label} → {KAM_TIER_META[f.tier as KamTier]?.label}) *</label>
                <input type="text" value={tierReason} onChange={(e) => setTierReason(e.target.value)} placeholder={tr("cth. Omzet L12M turun di bawah ambang Rp 570 jt")} />
              </div>
            )}
            <div className="full">
              <label>{tr("Entitas / nama customer anggota grup (satu per baris — dicocokkan ke prospek, aktivitas & RFQ)")}</label>
              <textarea rows={5} value={f.entities} onChange={(e) => setF({ ...f, entities: e.target.value })} />
            </div>
            <div className="full">
              <label>{tr("Catatan")}</label>
              <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </div>
          </div>
          <div className="if-panel-foot">
            <span />
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(false)}>{tr("Batal")}</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveEdit}>{tr("Simpan")}</button>
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="kam-head">
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span className="kam-title">{g.name}</span>
                <TierBadge tier={g.tier} />
                {g.pola && <span className="badge slate">{tr("Pola")} {g.pola} · {KAM_POLA[g.pola]}</span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 4 }}>
                {tr("Segmen")} <b>{g.segmen || '-'}</b> {tr("· Sponsor")} <b>{g.sponsor || '-'}</b> {tr("· Ketua")} <b>{userName(g.ketuaId) || '—'}</b> {tr("· Sekretaris")} <b>{userName(g.sekretarisId) || '—'}</b> {tr("· PIC")} {(g.anggotaIds || []).map(userName).filter(Boolean).join(', ') || '—'}
              </div>
            </div>
            <Flags flags={flags} />
          </div>
          <div className="kpi-grid">
            <div className="kpi"><div className="label">{tr("Omzet L12M")}</div><div className="value">{rpJt(g.l12m)}</div><div className="foot">{tr("Skor KAM")} {g.skor ?? '-'} · {meta.rule}</div></div>
            <div className={`kpi ${g.growthYtd != null && g.growthYtd <= -30 ? 'lost' : 'won'}`}><div className="label">{tr("Growth YTD")}</div><div className="value">{pctTxt(g.growthYtd, true)}</div><div className="foot">{tr("Rata-rata 3 th")} {rpJt(g.avg3y)}</div></div>
            <div className={`kpi ${g.margin != null && g.margin < 25 ? 'lost' : ''}`}><div className="label">{tr("Margin")}</div><div className="value">{pctTxt(g.margin)}</div><div className="foot">{tr("Transaksi terakhir")} {g.lastTrx || '-'}</div></div>
            <div className="kpi aktif"><div className="label">{tr("Target")}</div><div className="value">{rpJt(g.target)}</div><div className="foot">{tr("Won di CRM tahun ini")} {formatRupiah(stat?.wonYear || 0)}</div></div>
            <div className="kpi"><div className="label">{tr("Pipeline aktif (CRM)")}</div><div className="value">{stat?.open || 0} {tr("prospek")}</div><div className="foot">{formatRupiah(stat?.openValue || 0)} {tr("· kontak")} {daysSince == null ? tr("belum ada") : `${daysSince} hari lalu`}</div></div>
          </div>
          <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 14 }}>
            {multi ? (
              <>
                <b>{tr("Aturan multi-cabang:")}</b> {tr("ketua tim (")}{userName(g.ketuaId) || tr("belum dipilih")}{tr(") menentukan harga & term. Prospek/RFQ dari")} {g.supportCabang.join(', ')} {tr("memberi notifikasi ke ketua tim. Omzet tetap dicatat di cabang pengirim (split credit). Review")} {meta.review}.
              </>
            ) : (
              <>
                {tr("Home cabang")} <b>{g.homeCabang || '-'}</b>{tr(". Prospek/RFQ dari cabang lain memberi notifikasi ke ketua grup (")}{userName(g.ketuaId) || tr("belum dipilih")}{tr("). Review")} {meta.review}.
              </>
            )}
            {g.notes && <div style={{ marginTop: 6 }}>{g.notes}</div>}
          </div>
        </>
      )}

      <div className="kam-grid">
        <Sec title={`Entitas (${g.entities?.length || 0})`} note={tr("Pipeline & won dari data CRM; omzet dari analisa KAM")}>
          {(g.entities || []).length === 0 ? (
            <div className="field-note">{tr("Belum ada entitas. Isi lewat “Ubah profil” atau impor Excel — nama yang sama dengan nama customer di prospek/aktivitas.")}</div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr><th>{tr("Entitas")}</th><th style={{ textAlign: 'right' }}>{tr("Prospek aktif")}</th><th style={{ textAlign: 'right' }}>{tr("Pipeline")}</th><th style={{ textAlign: 'right' }}>{tr("Won (CRM)")}</th><th>{tr("Cabang")}</th></tr>
                </thead>
                <tbody>
                  {(g.entities || []).map((e) => {
                    const hits = Array.from(byCustomer.entries()).filter(([k]) => buildGroupIndex([{ ...g, entities: [e] }]).has(k.replace(/[.,&()'"/\\-]+/g, ' ').replace(/\b(PT|CV|TBK|PERSERO)\b/g, ' ').replace(/\s+/g, ' ').trim()) || k.includes(e.toUpperCase()));
                    const s = hits.reduce((a, [, v]) => ({ open: a.open + v.open, openValue: a.openValue + v.openValue, won: a.won + v.won, cab: new Set([...a.cab, ...v.cabangs]) }), { open: 0, openValue: 0, won: 0, cab: new Set<string>() });
                    return (
                      <tr key={e}>
                        <td>{e}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{s.open}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{s.openValue ? formatRupiah(s.openValue) : '-'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{s.won ? formatRupiah(s.won) : '-'}</td>
                        <td style={{ fontSize: 12 }}>{Array.from(s.cab).join(', ') || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Sec>

        <Sec title={tr("Rencana aksi")} note={`Review ${meta.review}${g.reviewNext ? ` · berikutnya ${formatDateID(g.reviewNext)}` : ''}`}>
          {actions.length === 0 && <div className="field-note">{tr("Belum ada rencana aksi.")}</div>}
          {actions.map((a, i) => (
            <div key={a.id} className="kam-action">
              {canPlan ? (
                <>
                  <input type="text" value={a.text} onChange={(e) => setAct(i, { text: e.target.value })} placeholder={tr("Aksi")} />
                  <input type="text" value={a.pic} onChange={(e) => setAct(i, { pic: e.target.value })} placeholder="PIC" style={{ maxWidth: 150 }} />
                  <input type="date" value={a.due} onChange={(e) => setAct(i, { due: e.target.value })} style={{ maxWidth: 150 }} />
                  <select value={a.status} onChange={(e) => setAct(i, { status: e.target.value as KamAction['status'] })} style={{ maxWidth: 120 }}>
                    {Object.entries(KAM_ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <button type="button" className="icon-btn danger" title={tr("Hapus aksi")} onClick={() => { setActions((x) => x.filter((_, k) => k !== i)); setActionsDirty(true); }}>
                    <IconTrash />
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }}>{a.text}<span className="field-note" style={{ display: 'block', margin: 0 }}>{a.pic || '-'} {tr("· tenggat")} {a.due ? formatDateID(a.due) : '-'}</span></span>
                  <span className={`badge ${a.status !== 'selesai' && a.due && a.due < localToday() ? 'rust' : KAM_ACTION_STATUS[a.status].badge}`}>{a.status !== 'selesai' && a.due && a.due < localToday() ? tr("Terlambat") : KAM_ACTION_STATUS[a.status].label}</span>
                </>
              )}
            </div>
          ))}
          {canPlan && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setActions((x) => [...x, { id: `a${Date.now().toString(36)}`, text: '', pic: userName(g.ketuaId), due: '', status: 'belum' }]); setActionsDirty(true); }}>
                <IconPlus /> {tr("Tambah aksi")}
              </button>
              {actionsDirty && (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await saveGroup(g.id, { actions }, 'Rencana aksi disimpan')) setActionsDirty(false); }}>
                  {tr("Simpan rencana aksi")}
                </button>
              )}
            </div>
          )}
        </Sec>
      </div>

      <Sec title={tr("Riwayat tier")}>
        {(g.tierHistory || []).length === 0 ? (
          <div className="field-note">-</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {g.tierHistory.map((h, i) => (
              <li key={i}>
                <b>{formatDateID(h.at.slice(0, 10))}</b> · {h.from ? `${KAM_TIER_META[h.from]?.label} → ` : ''}{KAM_TIER_META[h.to]?.label} · {h.reason} <span className="field-note" style={{ display: 'inline' }}>({h.by})</span>
              </li>
            ))}
          </ul>
        )}
      </Sec>
    </>
  );
}

/* ------------------------------------------------------------------ */

function UserSelect({ value, onChange, roster, userLabel, placeholder = '— pilih —', disabled, width = 240 }: { value: string | null; onChange: (v: string) => void; roster: RosterUser[]; userLabel: (u: RosterUser) => string; placeholder?: string; disabled?: boolean; width?: number }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ width, maxWidth: '100%' }}>
      <option value="">{placeholder}</option>
      {roster.map((u) => (
        <option key={u.id} value={u.id}>{userLabel(u)}</option>
      ))}
    </select>
  );
}

function Chips({ ids, userName, onRemove, disabled }: { ids: string[]; userName: (id: string) => string; onRemove: (id: string) => void; disabled?: boolean }) {
  return (
    <>
      {ids.map((id) => (
        <span key={id} className="kam-chip">
          {userName(id)}
          {!disabled && (
            <button type="button" aria-label={`Hapus ${userName(id)}`} onClick={() => onRemove(id)}>
              ×
            </button>
          )}
        </span>
      ))}
    </>
  );
}

function Struktur({
  groups, roster, userLabel, userName, team, setTeam, teamDirty, manager, canDelete, currentUserId, busy, saveTeam, saveGroup, openProfile, prospects, customerNames, today, createGroup, deleteGroup,
}: {
  groups: CustomerGroup[];
  roster: RosterUser[];
  userLabel: (u: RosterUser) => string;
  userName: (id: string | null | undefined) => string;
  team: KamTeam;
  setTeam: (t: KamTeam) => void;
  teamDirty: boolean;
  manager: boolean;
  canDelete: boolean;
  currentUserId: string;
  busy: boolean;
  saveTeam: () => void;
  saveGroup: (id: string, patch: Record<string, unknown>, ok?: string) => Promise<boolean>;
  openProfile: (id: string) => void;
  prospects: Prospect[];
  customerNames: string[];
  today: string;
  createGroup: (name: string) => Promise<boolean>;
  deleteGroup: (g: CustomerGroup) => void;
}) {
  const tr = useT();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const omzet = useMemo(() => groupOmzetYtd(groups, prospects, today), [groups, prospects, today]);
  const ytdOf = (g: CustomerGroup) => omzet.per.get(g.id)?.ytd || 0;
  const rows = [...groups].sort((a, b) => ytdOf(b) - ytdOf(a) || a.name.localeCompare(b.name));
  const total = groups.reduce((s, g) => s + ytdOf(g), 0);
  const nComp = groups.reduce((s, g) => s + (g.entities || []).length, 0);
  const max = Math.max(1, ...rows.map(ytdOf));
  const missing = groups.filter((g) => !g.ketuaId);
  const share = (v: number) => (omzet.nasional > 0 ? `${((v / omzet.nasional) * 100).toFixed(1).replace('.', ',')}%` : '-');
  const owner = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g) => [g.name, ...(g.entities || [])].forEach((n) => {
      const k = normalizeCustomerName(n);
      if (k && !m.has(k)) m.set(k, g.name);
    }));
    return m;
  }, [groups]);
  const year = today.slice(0, 4);
  const periodTxt = `Jan–${formatDateID(today).split(' ').slice(1).join(' ') || year}`;

  return (
    <>
      <Sec title={tr("Tim KAM Nasional")} note={manager ? 'Dipilih dari user CRM' : 'Hanya GM / RM / Admin yang dapat mengubah'}>
        <div className="kam-org">
          <div className="kam-node sponsor">
            <span className="kam-role">SPONSOR</span>
            <UserSelect value={team.sponsorId} onChange={(v) => setTeam({ ...team, sponsorId: v || null })} roster={roster} userLabel={userLabel} disabled={!manager} />
          </div>
          <span className="kam-line" aria-hidden="true" />
          <div className="kam-node ketua">
            <span className="kam-role">KETUA</span>
            <UserSelect value={team.ketuaId} onChange={(v) => setTeam({ ...team, ketuaId: v || null })} roster={roster} userLabel={userLabel} disabled={!manager} />
          </div>
          <span className="kam-line" aria-hidden="true" />
          <div className="kam-node sek">
            <span className="kam-role">SEKRETARIS</span>
            <UserSelect value={team.sekretarisId} onChange={(v) => setTeam({ ...team, sekretarisId: v || null })} roster={roster} userLabel={userLabel} disabled={!manager} />
          </div>
          {manager && (
            <button type="button" className="btn btn-primary btn-sm" disabled={!teamDirty || busy} onClick={saveTeam} style={{ marginTop: 10 }}>
              {tr("Simpan tim nasional")}
            </button>
          )}
          <span className="kam-line" aria-hidden="true" />
          <span className="kam-branch" aria-hidden="true" />
        </div>
      </Sec>

      <Sec title={`Grup · ${groups.length} grup`} note={`Urut omzet YTD terbesar · DO terfaktur ${periodTxt}`}>
        <div className="kam-gsum">
          <div><span className="kam-role">GRUP</span><b className="mono">{groups.length}</b></div>
          <div><span className="kam-role">{tr("OMZET YTD SEMUA GRUP")}</span><b className="mono">{formatRupiah(total)}</b></div>
          <div><span className="kam-role">{tr("PORSI DARI OMZET NASIONAL")}</span><b className="mono">{share(total)}</b></div>
          <div><span className="kam-role">{tr("PERUSAHAAN DALAM GRUP")}</span><b className="mono">{nComp}</b></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
          {manager &&
            (creating ? (
              <form
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  if (await createGroup(newName.trim())) {
                    setNewName('');
                    setCreating(false);
                  }
                }}
              >
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={tr("Nama grup, cth. Grup Wilayah 1")} style={{ width: 260 }} autoFocus maxLength={120} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !newName.trim()}>{tr("Buat")}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setCreating(false)}>{tr("Batal")}</button>
              </form>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                <IconPlus /> {tr("Buat grup")}
              </button>
            ))}
        </div>
        {missing.length > 0 && <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 10 }}><b>{missing.length} {tr("grup belum punya ketua grup:")}</b> {missing.map((g) => g.name).join(', ')}</div>}
        {rows.length === 0 ? (
          <div className="field-note">{tr("Belum ada grup.")}{manager ? tr(" Klik \"Buat grup\", lalu isi perusahaan, ketua grup, sekretaris dan PIC.") : ''}</div>
        ) : (
          <div className="kam-gcards">
            {rows.map((g) => (
              <GroupCard
                key={g.id}
                g={g}
                o={omzet.per.get(g.id)}
                max={max}
                share={share}
                year={year}
                roster={roster}
                userLabel={userLabel}
                userName={userName}
                manager={manager}
                canEdit={manager || (!!currentUserId && g.ketuaId === currentUserId)}
                canDelete={canDelete}
                busy={busy}
                saveGroup={saveGroup}
                openProfile={openProfile}
                deleteGroup={deleteGroup}
                customerNames={customerNames}
                owner={owner}
              />
            ))}
          </div>
        )}
        {omzet.ungrouped.length > 0 && (
          <div className="field-note" style={{ marginTop: 10 }}>
            {tr("Perusahaan belum masuk grup (omzet YTD terbesar):")} <b>{omzet.ungrouped.slice(0, 5).map((u) => `${u.name} (${formatRupiah(u.ytd)})`).join(', ')}</b>
          </div>
        )}
        <div className="kam-roles">
          <div><b>{tr("Ketua grup")}</b> {tr("— penanggung jawab akun: menentukan harga & term, menerima notifikasi prospek/RFQ grup dari cabang lain; mengatur perusahaan, sekretaris dan PIC grupnya.")}</div>
          <div><b>{tr("Sekretaris grup")}</b> {tr("— merapikan data grup & perusahaan, mencatat rencana aksi dan hasil review akun.")}</div>
          <div><b>PIC</b> {tr("— Sales / PIC cabang pendukung yang menangani perusahaan grup di cabangnya.")}</div>
        </div>
      </Sec>
    </>
  );
}

function GroupCard({
  g, o, max, share, year, roster, userLabel, userName, manager, canEdit, canDelete, busy, saveGroup, openProfile, deleteGroup, customerNames, owner,
}: {
  g: CustomerGroup;
  o: GroupOmzet | undefined;
  max: number;
  share: (v: number) => string;
  year: string;
  roster: RosterUser[];
  userLabel: (u: RosterUser) => string;
  userName: (id: string | null | undefined) => string;
  manager: boolean;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  saveGroup: (id: string, patch: Record<string, unknown>, ok?: string) => Promise<boolean>;
  openProfile: (id: string) => void;
  deleteGroup: (g: CustomerGroup) => void;
  customerNames: string[];
  owner: Map<string, string>;
}) {
  const tr = useT();
  const [comp, setComp] = useState('');
  const ents = g.entities || [];
  const pics = g.anggotaIds || [];
  const ytd = o?.ytd || 0;
  const all = ytd + (o?.git || 0);
  const growth = o && o.lastYtd > 0 ? Math.round(((all - o.lastYtd) / o.lastYtd) * 100) : null;
  const listId = `kam-cust-${g.id}`;
  const notIn = (ids: (string | null)[]) => roster.filter((u) => !ids.includes(u.id));
  const sortedEnts = [...ents].sort((a, b) => (o?.byEntity.get(b) || 0) - (o?.byEntity.get(a) || 0));

  async function addComp() {
    const name = comp.trim();
    if (!name) return;
    const k = normalizeCustomerName(name);
    const own = owner.get(k);
    if (ents.some((e) => normalizeCustomerName(e) === k)) return setComp('');
    if (own && own !== g.name) return; // satu perusahaan hanya di satu grup
    if (await saveGroup(g.id, { entities: [...ents, name] }, `${name} masuk ${g.name}`)) setComp('');
  }
  const compOwner = comp.trim() ? owner.get(normalizeCustomerName(comp)) : undefined;
  const compClash = !!compOwner && compOwner !== g.name;

  return (
    <div className="kam-gcard">
      <div className="kam-gcard-head">
        <div style={{ minWidth: 0 }}>
          <button type="button" className="link-btn" style={{ fontWeight: 700, fontSize: 14.5, textDecoration: 'none', color: 'inherit', textAlign: 'left' }} onClick={() => openProfile(g.id)} title={tr("Buka profil & account plan")}>
            {g.name}
          </button>
          {isKeyTier(g.tier) && <TierBadge tier={g.tier} />}
        </div>
        {canDelete && (
          <button type="button" className="icon-btn danger" title={tr("Hapus grup")} disabled={busy} onClick={() => deleteGroup(g)}>
            <IconTrash />
          </button>
        )}
      </div>

      <div className="kam-gomzet">
        <span className="kam-role">{tr("OMZET YTD (TERFAKTUR)")}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <b className="mono" style={{ fontSize: 18 }}>{formatRupiah(ytd)}</b>
          {growth === null ? (
            <span className="badge">{o && all > 0 ? 'baru' : '–'}</span>
          ) : (
            <span className={`badge ${growth >= 0 ? 'green' : 'rust'}`} title={`DO ${year} (terfaktur + GIT) dibanding periode yang sama ${Number(year) - 1}`}>
              {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}{tr("% vs")} {Number(year) - 1}
            </span>
          )}
        </div>
        <div className="field-note" style={{ margin: 0 }}>{tr("+ GIT belum faktur")} {formatRupiah(o?.git || 0)} · {share(ytd)} {tr("dari omzet nasional")}</div>
        <div className="kam-gbar"><span style={{ width: `${Math.round((ytd / max) * 100)}%` }} /></div>
      </div>

      <div className="kam-gsec">
        <span className="kam-role">{tr("PERUSAHAAN ·")} {ents.length}</span>
        {sortedEnts.length === 0 && <span className="field-note" style={{ margin: 0 }}>{tr("Belum ada perusahaan.")}</span>}
        {sortedEnts.map((e) => (
          <div key={e} className="kam-gcomp">
            <span className="kam-gcomp-name" title={e}>{e}</span>
            <span className="mono">{formatRupiah(o?.byEntity.get(e) || 0)}</span>
            {canEdit && (
              <button type="button" aria-label={`Keluarkan ${e}`} title={tr("Keluarkan dari grup")} disabled={busy} onClick={() => saveGroup(g.id, { entities: ents.filter((x) => x !== e) }, `${e} dikeluarkan dari ${g.name}`)}>
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="text" list={listId} value={comp} onChange={(e) => setComp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addComp(); } }} placeholder={tr("+ Tambah perusahaan…")} style={{ flex: 1, minWidth: 0, height: 32, fontSize: 12.5 }} />
              <button type="button" className="btn btn-outline btn-sm" disabled={busy || !comp.trim() || compClash} onClick={() => void addComp()}>{tr("Tambah")}</button>
            </div>
            {compClash && <span className="field-note" style={{ margin: 0, color: 'var(--rust-600)' }}>{tr("Sudah di grup")} {compOwner}.</span>}
            <datalist id={listId}>
              {customerNames.filter((n) => !owner.has(normalizeCustomerName(n))).map((n) => <option key={n} value={n} />)}
            </datalist>
          </>
        )}
      </div>

      <label className="kam-gsec">
        <span className="kam-role">{tr("HOME CABANG")}</span>
        <select value={g.homeCabang || ''} disabled={!manager || busy} onChange={(e) => saveGroup(g.id, { homeCabang: e.target.value || null }, `Home cabang ${g.name}: ${e.target.value || '-'}`)}>
          <option value="">{tr("— semua cabang —")}</option>
          {CABANG_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="field-note" style={{ margin: 0 }}>
          {g.homeCabang ? `Prospek/RFQ dari cabang selain ${g.homeCabang} dinotifikasi ke ketua grup.` : tr("Belum dipilih: setiap prospek/RFQ perusahaan grup dinotifikasi ke ketua grup.")}
        </span>
      </label>
      <label className="kam-gsec">
        <span className="kam-role">{tr("KETUA GRUP")}</span>
        <UserSelect value={g.ketuaId} onChange={(v) => saveGroup(g.id, { ketuaId: v || null }, `Ketua grup ${g.name} disimpan`)} roster={roster} userLabel={userLabel} placeholder={tr("— pilih ketua grup —")} disabled={!manager || busy} width={400} />
      </label>
      <label className="kam-gsec">
        <span className="kam-role">{tr("SEKRETARIS GRUP")}</span>
        <UserSelect value={g.sekretarisId} onChange={(v) => saveGroup(g.id, { sekretarisId: v || null }, `Sekretaris ${g.name} disimpan`)} roster={roster} userLabel={userLabel} placeholder={tr("— tidak ada —")} disabled={!canEdit || busy} width={400} />
      </label>
      <div className="kam-gsec">
        <span className="kam-role">{tr("PIC ·")} {pics.length} ORANG</span>
        <div className="kam-chips" style={{ justifyContent: 'flex-start' }}>
          <Chips ids={pics} userName={(id) => userName(id)} disabled={!canEdit || busy} onRemove={(id) => saveGroup(g.id, { anggotaIds: pics.filter((x) => x !== id) }, 'PIC dihapus')} />
        </div>
        {canEdit && (
          <select value="" disabled={busy} onChange={(e) => e.target.value && saveGroup(g.id, { anggotaIds: [...pics, e.target.value] }, 'PIC ditambahkan')} style={{ height: 32, fontSize: 12.5 }}>
            <option value="">{tr("+ Tambah PIC…")}</option>
            {notIn([...pics, g.ketuaId, g.sekretarisId]).map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function Sec({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, margin: '4px 0 6px' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}
