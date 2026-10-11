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
  isKeyTier,
  kamFlags,
  type KamFlag,
} from '@/lib/kam';
import { localToday } from '@/lib/sales-activity';

/** 'YYYY-MM-DD' + n days (UTC math on a date-only value, no timezone drift). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
import type { CustomerGroup, KamAction, KamTeam, KamTier, Prospect, SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

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
 * account plan, struktur organisasi (tim nasional + tim per akun). Tier,
 * skor dan angka omzet/margin berasal dari analisa KAM (impor Excel); kontak
 * terakhir dan pipeline dihitung dari data CRM.
 */
export function KeyAccountModal() {
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

  const manager = canManageKam(currentUser?.role);
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
      title="Key Account Management"
      xwide
      footer={
        <button type="button" className="btn btn-outline" onClick={closeModal}>
          Tutup
        </button>
      }
    >
      <div className="ea-tabs" role="tablist">
        {(
          [
            ['ringkasan', 'Ringkasan'],
            ['daftar', 'Daftar Grup'],
            ['profil', 'Profil & Account Plan'],
            ['struktur', 'Struktur Organisasi'],
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
            isKetua={!!currentUser && sel.ketuaId === currentUser.id}
            canDelete={currentUser?.role === 'gm' || currentUser?.role === 'admin'}
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
          <div className="empty-state">Belum ada grup. Tambahkan grup atau impor dari Excel analisa KAM di tab Daftar Grup.</div>
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
          currentUserId={currentUser?.id || ''}
          busy={busy}
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
  const totalL12 = groups.reduce((s, g) => s + (g.l12m || 0), 0);
  const risky = groups.filter((g) => isKeyTier(g.tier)).map((g) => ({ g, f: flagsOf(g) })).filter((x) => x.f.length).sort((a, b) => b.f.filter((x) => x.level === 'high').length - a.f.filter((x) => x.level === 'high').length);
  const since = addDays(today, -60);
  const cross = [
    ...prospects.filter((p) => (p.tglPenawaran || p.createdAt || '').slice(0, 10) >= since).map((p) => ({ kind: 'Prospek', id: p.id, no: '', tgl: (p.tglPenawaran || p.createdAt).slice(0, 10), cabang: p.cabang, customer: p.customer })),
    ...rfqs.filter((r) => (r.tglRfq || r.createdAt || '').slice(0, 10) >= since).map((r) => ({ kind: 'RFQ', id: r.id, no: r.noRfq || '', tgl: (r.tglRfq || r.createdAt).slice(0, 10), cabang: r.cabang, customer: r.customer || '' })),
  ]
    .map((x) => ({ ...x, g: groupForCustomer(stats.idx, x.customer) }))
    .filter((x) => x.g && isKeyTier(x.g.tier) && x.g.homeCabang && x.cabang && x.cabang.toUpperCase() !== x.g.homeCabang.toUpperCase())
    .sort((a, b) => b.tgl.localeCompare(a.tgl))
    .slice(0, 12);
  const reviews = groups.filter((g) => isKeyTier(g.tier) && g.reviewNext && g.reviewNext <= addDays(today, 21)).sort((a, b) => (a.reviewNext || '').localeCompare(b.reviewNext || ''));

  if (!groups.length) return <div className="empty-state">Belum ada grup Key Account. Buka tab Daftar Grup untuk menambah atau mengimpor dari Excel analisa KAM.</div>;

  return (
    <>
      <div className="kpi-grid">
        {KAM_TIERS.map((t) => {
          const list = groups.filter((g) => g.tier === t.key);
          const l12 = list.reduce((s, g) => s + (g.l12m || 0), 0);
          return (
            <div key={t.key} className="kpi" style={{ borderLeftColor: t.color }}>
              <div className="label">{isKeyTier(t.key) ? '★ ' : ''}{t.label}</div>
              <div className="value">{list.length} akun</div>
              <div className="foot">
                {rpJt(l12)} · {totalL12 ? Math.round((l12 / totalL12) * 100) : 0}% L12M grup · {t.rule}
              </div>
            </div>
          );
        })}
      </div>

      <div className="kam-grid">
        <Sec title={`Sinyal risiko — Strategic & Key (${risky.length})`} note="YTD ≤ −30%, margin < 25%, tanpa transaksi ≥3 bulan, L12M < 50% rata-rata 3 th, kontak melewati batas tier">
          {risky.length === 0 ? (
            <div className="field-note">Tidak ada sinyal risiko.</div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr><th>Grup</th><th>Tier</th><th>Sinyal</th><th>Ketua tim</th></tr>
                </thead>
                <tbody>
                  {risky.map(({ g, f }) => (
                    <tr key={g.id} className="if-row" onClick={() => openProfile(g.id)}>
                      <td><b>{g.name}</b></td>
                      <td><TierBadge tier={g.tier} /></td>
                      <td><Flags flags={f} /></td>
                      <td style={{ fontSize: 12.5 }}>{userName(g.ketuaId) || <span className="badge rust">belum ada</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sec>
        <div>
          <Sec title={`Penawaran / RFQ lintas cabang — 60 hari (${cross.length})`} note="Dibuat cabang di luar home cabang grup; ketua tim mendapat notifikasi">
            {cross.length === 0 ? (
              <div className="field-note">Tidak ada.</div>
            ) : (
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr><th>Dokumen</th><th>Customer</th><th>Dari → home</th><th>Ketua tim</th></tr>
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
              <div className="field-note">Tidak ada review terjadwal dalam 3 minggu.</div>
            ) : (
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table" style={{ minWidth: 0 }}>
                  <tbody>
                    {reviews.map((g) => (
                      <tr key={g.id} className="if-row" onClick={() => openProfile(g.id)}>
                        <td><b>{g.name}</b></td>
                        <td>{formatDateID(g.reviewNext)}{g.reviewNext! < today && <span className="badge rust" style={{ marginLeft: 6 }}>lewat</span>}</td>
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
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari grup / entitas / ketua / cabang" style={{ maxWidth: 260 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 13 }}>
          <input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} /> Hanya yang berisiko
        </label>
      </div>
      {manager && (
        <div className="toolbar-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama grup baru, cth. PUPUK INDONESIA GROUP" style={{ maxWidth: 300 }} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button type="button" className="btn btn-primary btn-sm" onClick={create} disabled={!newName.trim()}>
            <IconPlus /> Grup baru
          </button>
          <label className="btn btn-outline btn-sm" style={{ margin: 0, cursor: 'pointer' }}>
            {importing ? 'Mengimpor…' : 'Impor dari Excel KAM'}
            <input type="file" accept=".xlsx,.xls" hidden disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={downloadTemplate}>
            <IconDownload /> Template
          </button>
          <span className="field-note" style={{ margin: 0 }}>Impor mencocokkan nama grup; tim (ketua/sekretaris/anggota) tidak ditimpa.</span>
        </div>
      )}
      {list.length === 0 ? (
        <div className="empty-state">{groups.length ? 'Tidak ada grup pada filter ini.' : 'Belum ada grup Key Account.'}</div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table if-nowrap" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th>Grup</th><th>Tier</th><th style={{ textAlign: 'right' }}>Skor</th><th>Pola</th><th>Segmen</th><th>Ketua tim</th><th>Home · cabang</th>
                <th style={{ textAlign: 'right' }}>L12M</th><th style={{ textAlign: 'right' }}>YTD</th><th style={{ textAlign: 'right' }}>Margin</th><th>Kontak terakhir</th><th>Review</th><th>Sinyal</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const d = daysSince(g);
                const lim = KAM_TIER_META[g.tier].contactDays;
                return (
                  <tr key={g.id} className="if-row" onClick={() => openProfile(g.id)}>
                    <td><b>{g.name}</b>{g.entities?.length ? <div className="field-note" style={{ margin: 0 }}>{g.entities.length} entitas</div> : null}</td>
                    <td><TierBadge tier={g.tier} /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{g.skor == null ? '-' : g.skor.toLocaleString('id-ID')}</td>
                    <td><b>{g.pola || '-'}</b></td>
                    <td style={{ fontSize: 12.5 }}>{g.segmen || '-'}</td>
                    <td style={{ fontSize: 12.5 }}>{userName(g.ketuaId) || (isKeyTier(g.tier) ? <span className="badge rust">belum ada</span> : '-')}</td>
                    <td style={{ fontSize: 12.5 }}>{g.homeCabang || '-'} · {1 + (g.supportCabang?.length || 0)} cab</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{rpJt(g.l12m)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: g.growthYtd == null ? undefined : g.growthYtd <= -30 ? 'var(--rust-600)' : g.growthYtd >= 0 ? 'var(--green-600)' : 'var(--amber-600)' }}>{pctTxt(g.growthYtd, true)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: g.margin != null && g.margin < 25 ? 'var(--rust-600)' : undefined }}>{pctTxt(g.margin)}</td>
                    <td><span className={`badge ${d == null ? 'slate' : d > lim ? 'rust' : d > lim * 0.7 ? 'amber' : 'green'}`}>{d == null ? 'belum ada' : d === 0 ? 'hari ini' : `${d} hari lalu`}</span></td>
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
        Tier, skor, L12M, YTD dan margin dari analisa KAM (impor Excel). Kontak terakhir dari Aktivitas Harian; batas kontak: Strategic {KAM_TIER_META.strategic.contactDays} hari, Key {KAM_TIER_META.key.contactDays} hari.
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
        <select value={g.id} onChange={(e) => setSelId(e.target.value)} style={{ maxWidth: 320 }} aria-label="Pilih grup">
          {KAM_TIERS.map((t) => (
            <optgroup key={t.key} label={t.label}>
              {groups.filter((x) => x.tier === t.key).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={goStruktur}>Atur tim</button>
        {manager && !edit && <button type="button" className="btn btn-primary btn-sm" onClick={startEdit}>Ubah profil / tier</button>}
        {canDelete && !edit && (
          <button type="button" className="btn btn-outline btn-sm" onClick={del} title="Hapus grup">
            <IconTrash />
          </button>
        )}
      </div>

      {edit ? (
        <div className="if-panel" style={{ borderColor: 'var(--steel-500)' }}>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {[
              ['name', 'Nama grup'], ['skor', 'Skor (0–100)'], ['segmen', 'Segmen / vertikal'], ['homeCabang', 'Home cabang'], ['supportCabang', 'Cabang pendukung (koma)'], ['sponsor', 'Sponsor (GM / RM)'],
              ['l12m', 'Omzet L12M (Rp jt)'], ['growthYtd', 'Growth YTD (%)'], ['margin', 'Margin (%)'], ['avg3y', 'Rata-rata 3 th (Rp jt)'], ['lastTrx', 'Transaksi terakhir (YYYY-MM)'], ['target', 'Target tahun ini (Rp jt)'],
            ].map(([k, l]) => (
              <div key={k}>
                <label>{l}</label>
                <input type="text" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </div>
            ))}
            <div>
              <label>Tier</label>
              <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
                {KAM_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label>Pola</label>
              <select value={f.pola} onChange={(e) => setF({ ...f, pola: e.target.value })}>
                <option value="">-</option>
                {(['A', 'B', 'C'] as const).map((p) => <option key={p} value={p}>{p} · {KAM_POLA[p]}</option>)}
              </select>
            </div>
            <div>
              <label>Review berikutnya</label>
              <input type="date" value={f.reviewNext} onChange={(e) => setF({ ...f, reviewNext: e.target.value })} />
            </div>
            {f.tier !== g.tier && (
              <div className="full">
                <label>Alasan perubahan tier ({KAM_TIER_META[g.tier].label} → {KAM_TIER_META[f.tier as KamTier]?.label}) *</label>
                <input type="text" value={tierReason} onChange={(e) => setTierReason(e.target.value)} placeholder="cth. Omzet L12M turun di bawah ambang Rp 570 jt" />
              </div>
            )}
            <div className="full">
              <label>Entitas / nama customer anggota grup (satu per baris — dicocokkan ke prospek, aktivitas & RFQ)</label>
              <textarea rows={5} value={f.entities} onChange={(e) => setF({ ...f, entities: e.target.value })} />
            </div>
            <div className="full">
              <label>Catatan</label>
              <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </div>
          </div>
          <div className="if-panel-foot">
            <span />
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(false)}>Batal</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveEdit}>Simpan</button>
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
                {g.pola && <span className="badge slate">Pola {g.pola} · {KAM_POLA[g.pola]}</span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 4 }}>
                Segmen <b>{g.segmen || '-'}</b> · Sponsor <b>{g.sponsor || '-'}</b> · Ketua <b>{userName(g.ketuaId) || '—'}</b> · Sekretaris <b>{userName(g.sekretarisId) || '—'}</b> · Anggota {(g.anggotaIds || []).map(userName).filter(Boolean).join(', ') || '—'}
              </div>
            </div>
            <Flags flags={flags} />
          </div>
          <div className="kpi-grid">
            <div className="kpi"><div className="label">Omzet L12M</div><div className="value">{rpJt(g.l12m)}</div><div className="foot">Skor KAM {g.skor ?? '-'} · {meta.rule}</div></div>
            <div className={`kpi ${g.growthYtd != null && g.growthYtd <= -30 ? 'lost' : 'won'}`}><div className="label">Growth YTD</div><div className="value">{pctTxt(g.growthYtd, true)}</div><div className="foot">Rata-rata 3 th {rpJt(g.avg3y)}</div></div>
            <div className={`kpi ${g.margin != null && g.margin < 25 ? 'lost' : ''}`}><div className="label">Margin</div><div className="value">{pctTxt(g.margin)}</div><div className="foot">Transaksi terakhir {g.lastTrx || '-'}</div></div>
            <div className="kpi aktif"><div className="label">Target</div><div className="value">{rpJt(g.target)}</div><div className="foot">Won di CRM tahun ini {formatRupiah(stat?.wonYear || 0)}</div></div>
            <div className="kpi"><div className="label">Pipeline aktif (CRM)</div><div className="value">{stat?.open || 0} prospek</div><div className="foot">{formatRupiah(stat?.openValue || 0)} · kontak {daysSince == null ? 'belum ada' : `${daysSince} hari lalu`}</div></div>
          </div>
          <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 14 }}>
            {multi ? (
              <>
                <b>Aturan multi-cabang:</b> ketua tim ({userName(g.ketuaId) || 'belum dipilih'}) menentukan harga & term. Prospek/RFQ dari {g.supportCabang.join(', ')} memberi notifikasi ke ketua tim. Omzet tetap dicatat di cabang pengirim (split credit). Review {meta.review}.
              </>
            ) : (
              <>
                Home cabang <b>{g.homeCabang || '-'}</b>. Prospek/RFQ dari cabang lain memberi notifikasi ke ketua tim ({userName(g.ketuaId) || 'belum dipilih'}). Review {meta.review}.
              </>
            )}
            {g.notes && <div style={{ marginTop: 6 }}>{g.notes}</div>}
          </div>
        </>
      )}

      <div className="kam-grid">
        <Sec title={`Entitas (${g.entities?.length || 0})`} note="Pipeline & won dari data CRM; omzet dari analisa KAM">
          {(g.entities || []).length === 0 ? (
            <div className="field-note">Belum ada entitas. Isi lewat &ldquo;Ubah profil&rdquo; atau impor Excel — nama yang sama dengan nama customer di prospek/aktivitas.</div>
          ) : (
            <div className="table-wrap" style={{ borderTop: 'none' }}>
              <table className="simple-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr><th>Entitas</th><th style={{ textAlign: 'right' }}>Prospek aktif</th><th style={{ textAlign: 'right' }}>Pipeline</th><th style={{ textAlign: 'right' }}>Won (CRM)</th><th>Cabang</th></tr>
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

        <Sec title="Rencana aksi" note={`Review ${meta.review}${g.reviewNext ? ` · berikutnya ${formatDateID(g.reviewNext)}` : ''}`}>
          {actions.length === 0 && <div className="field-note">Belum ada rencana aksi.</div>}
          {actions.map((a, i) => (
            <div key={a.id} className="kam-action">
              {canPlan ? (
                <>
                  <input type="text" value={a.text} onChange={(e) => setAct(i, { text: e.target.value })} placeholder="Aksi" />
                  <input type="text" value={a.pic} onChange={(e) => setAct(i, { pic: e.target.value })} placeholder="PIC" style={{ maxWidth: 150 }} />
                  <input type="date" value={a.due} onChange={(e) => setAct(i, { due: e.target.value })} style={{ maxWidth: 150 }} />
                  <select value={a.status} onChange={(e) => setAct(i, { status: e.target.value as KamAction['status'] })} style={{ maxWidth: 120 }}>
                    {Object.entries(KAM_ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <button type="button" className="icon-btn danger" title="Hapus aksi" onClick={() => { setActions((x) => x.filter((_, k) => k !== i)); setActionsDirty(true); }}>
                    <IconTrash />
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }}>{a.text}<span className="field-note" style={{ display: 'block', margin: 0 }}>{a.pic || '-'} · tenggat {a.due ? formatDateID(a.due) : '-'}</span></span>
                  <span className={`badge ${a.status !== 'selesai' && a.due && a.due < localToday() ? 'rust' : KAM_ACTION_STATUS[a.status].badge}`}>{a.status !== 'selesai' && a.due && a.due < localToday() ? 'Terlambat' : KAM_ACTION_STATUS[a.status].label}</span>
                </>
              )}
            </div>
          ))}
          {canPlan && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setActions((x) => [...x, { id: `a${Date.now().toString(36)}`, text: '', pic: userName(g.ketuaId), due: '', status: 'belum' }]); setActionsDirty(true); }}>
                <IconPlus /> Tambah aksi
              </button>
              {actionsDirty && (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await saveGroup(g.id, { actions }, 'Rencana aksi disimpan')) setActionsDirty(false); }}>
                  Simpan rencana aksi
                </button>
              )}
            </div>
          )}
        </Sec>
      </div>

      <Sec title="Riwayat tier">
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
  groups, roster, userLabel, userName, team, setTeam, teamDirty, manager, currentUserId, busy, saveTeam, saveGroup, openProfile,
}: {
  groups: CustomerGroup[];
  roster: RosterUser[];
  userLabel: (u: RosterUser) => string;
  userName: (id: string | null | undefined) => string;
  team: KamTeam;
  setTeam: (t: KamTeam) => void;
  teamDirty: boolean;
  manager: boolean;
  currentUserId: string;
  busy: boolean;
  saveTeam: () => void;
  saveGroup: (id: string, patch: Record<string, unknown>, ok?: string) => Promise<boolean>;
  openProfile: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = groups.filter((g) => showAll || isKeyTier(g.tier)).sort((a, b) => KAM_TIERS.findIndex((t) => t.key === a.tier) - KAM_TIERS.findIndex((t) => t.key === b.tier) || (b.skor || 0) - (a.skor || 0));
  const missing = groups.filter((g) => isKeyTier(g.tier) && !g.ketuaId);
  const notIn = (ids: (string | null)[]) => roster.filter((u) => !ids.includes(u.id));

  return (
    <>
      <Sec title="Tim KAM Nasional" note={manager ? 'Dipilih dari user CRM' : 'Hanya GM / RM / Admin yang dapat mengubah'}>
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
          <span className="kam-line" aria-hidden="true" />
          <div className="kam-node anggota">
            <span className="kam-role">ANGGOTA · {team.anggotaIds.length} orang</span>
            <div className="kam-chips">
              <Chips ids={team.anggotaIds} userName={(id) => userName(id)} onRemove={(id) => setTeam({ ...team, anggotaIds: team.anggotaIds.filter((x) => x !== id) })} disabled={!manager} />
            </div>
            {manager && (
              <select value="" onChange={(e) => e.target.value && setTeam({ ...team, anggotaIds: [...team.anggotaIds, e.target.value] })} style={{ width: 260 }}>
                <option value="">+ Tambah anggota…</option>
                {notIn([...team.anggotaIds, team.ketuaId, team.sekretarisId]).map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
              </select>
            )}
          </div>
          {manager && (
            <button type="button" className="btn btn-primary btn-sm" disabled={!teamDirty || busy} onClick={saveTeam} style={{ marginTop: 10 }}>
              Simpan tim nasional
            </button>
          )}
        </div>
        <div className="kam-roles">
          <div><b>Ketua</b> — memimpin program KAM dan review kuartalan, memutuskan perubahan tier dan ketua tim akun.</div>
          <div><b>Sekretaris</b> — jadwal & notulen review, memantau rencana aksi, merapikan data grup dan impor bulanan.</div>
          <div><b>Anggota</b> — ketua tim akun dan perwakilan cabang/marketing yang hadir di review.</div>
        </div>
      </Sec>

      <Sec title="Tim per akun" note="Ketua tim = penanggung jawab akun: menentukan harga & term, menerima notifikasi prospek/RFQ dari cabang lain · Anggota = PIC cabang pendukung / SE">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 0 8px', fontSize: 13 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Tampilkan juga Development & Monitor
        </label>
        {missing.length > 0 && <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 8 }}><b>{missing.length} akun Strategic/Key belum punya ketua tim:</b> {missing.map((g) => g.name).join(', ')}</div>}
        {rows.length === 0 ? (
          <div className="field-note">Belum ada grup.</div>
        ) : (
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 1050 }}>
              <thead>
                <tr><th>Grup</th><th>Tier</th><th style={{ width: 250 }}>Ketua</th><th style={{ width: 250 }}>Sekretaris</th><th>Anggota</th></tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const canTeam = manager || g.ketuaId === currentUserId;
                  return (
                    <tr key={g.id} style={{ verticalAlign: 'top' }}>
                      <td>
                        <button type="button" className="link-btn" style={{ fontWeight: 700, textDecoration: 'none', color: 'inherit' }} onClick={() => openProfile(g.id)}>{g.name}</button>
                        <div className="field-note" style={{ margin: 0 }}>Home {g.homeCabang || '-'}{g.pola ? ` · pola ${g.pola}` : ''}</div>
                      </td>
                      <td><TierBadge tier={g.tier} /></td>
                      <td>
                        <UserSelect value={g.ketuaId} onChange={(v) => saveGroup(g.id, { ketuaId: v }, `Ketua tim ${g.name} disimpan`)} roster={roster} userLabel={userLabel} disabled={!manager || busy} />
                      </td>
                      <td>
                        <UserSelect value={g.sekretarisId} onChange={(v) => saveGroup(g.id, { sekretarisId: v }, `Sekretaris ${g.name} disimpan`)} roster={roster} userLabel={userLabel} placeholder="— tidak ada —" disabled={!canTeam || busy} />
                      </td>
                      <td>
                        <div className="kam-chips" style={{ justifyContent: 'flex-start' }}>
                          <Chips ids={g.anggotaIds || []} userName={(id) => userName(id)} disabled={!canTeam || busy} onRemove={(id) => saveGroup(g.id, { anggotaIds: (g.anggotaIds || []).filter((x) => x !== id) }, 'Anggota dihapus')} />
                          {canTeam && (
                            <select value="" disabled={busy} onChange={(e) => e.target.value && saveGroup(g.id, { anggotaIds: [...(g.anggotaIds || []), e.target.value] }, 'Anggota ditambahkan')} style={{ width: 170, height: 32, fontSize: 12.5 }}>
                              <option value="">+ Anggota…</option>
                              {notIn([...(g.anggotaIds || []), g.ketuaId]).map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Sec>
    </>
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
