'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import {
  ESKALASI_ATAS_HARI,
  ESKALASI_BM_HARI,
  HASIL_META,
  ISSUE_CATS,
  ISSUE_STATUS_META,
  daysSince,
  isOpenIssue,
  issueCatLabel,
  issueSuggestions,
  urgensiLabel,
  type IssueSuggestion,
  type PipelineIssue,
} from '@/lib/issues';
import { localToday } from '@/lib/sales-activity';
import { canNow } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { IssueDetail, IssueForm, issueAgeText, nameOf, useRoster } from './shared';

type StFilter = 'aktif' | 'usulan' | 'selesai' | 'semua';
const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();
const PURCH_CATS = ['stok', 'leadtime'];

/** SLA: belum ditangani > 2 hari, atau belum selesai > 4 hari. */
export function lewatSla(i: PipelineIssue, today: string): boolean {
  if (!isOpenIssue(i)) return false;
  const d = daysSince(i.dilaporAt || i.createdAt, today);
  return (i.status === 'open' && d > ESKALASI_BM_HARI) || d > ESKALASI_ATAS_HARI;
}

const avgDays = (list: PipelineIssue[]) => {
  const xs = list.filter((i) => i.selesaiAt).map((i) => (new Date(i.selesaiAt!).getTime() - new Date(i.dilaporAt || i.createdAt).getTime()) / 86400000);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const dayTxt = (n: number | null) => (n == null ? '-' : `${n.toFixed(1).replace('.', ',')} hari`);

/**
 * Papan Masalah Pipeline (variant "board", dibuka dari CRM) atau tab ⚑ Masalah
 * di halaman Purchasing (variant "purchasing": daftar + detail saja).
 */
export function IssueBoard({ variant }: { variant: 'board' | 'purchasing' }) {
  const me = useDataStore((s) => s.currentUser);
  const issues = useDataStore((s) => s.issues);
  const prospects = useDataStore((s) => s.prospects);
  const rfqs = useDataStore((s) => s.rfqs);
  const toast = useDataStore((s) => s.toast);
  const roster = useRoster();
  const today = localToday();
  const thisMonth = today.slice(0, 7);
  const prevMonth = (() => {
    const d = new Date(`${thisMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const purch = variant === 'purchasing';
  const [st, setSt] = useState<StFilter>('aktif');
  const [mine, setMine] = useState(purch);
  const [purchCat, setPurchCat] = useState(false);
  const [cat, setCat] = useState('');
  const [cabang, setCabang] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [lapor, setLapor] = useState<IssueSuggestion | null>(null);

  // Dibuka dari notifikasi / Edit Prospek: langsung ke masalah itu.
  const focus = useUiStore((s) => s.issueFocus);
  useEffect(() => {
    if (!focus) return;
    const i = useDataStore.getState().issues.find((x) => x.id === focus.id);
    if (i) {
      setSelId(i.id);
      setSt(isOpenIssue(i) ? 'aktif' : i.status === 'usulan' ? 'usulan' : 'semua');
      setMine(false);
      setPurchCat(false);
      setCat('');
    } else {
      toast('Masalah tidak ditemukan atau di luar cakupan Anda', 'error');
    }
    useUiStore.setState({ issueFocus: null });
  }, [focus, toast]);

  const valueOf = useMemo(() => {
    const m = new Map(prospects.map((p) => [p.id, Number(p.value) || 0]));
    return (i: PipelineIssue) => m.get(i.prospectId) || 0;
  }, [prospects]);

  const real = issues.filter((i) => i.status !== 'diabaikan');
  const cabangs = Array.from(new Set(real.map((i) => up(i.cabang)).filter(Boolean))).sort();
  const scoped = real.filter((i) => !cabang || up(i.cabang) === cabang);
  const open = scoped.filter(isOpenIssue);
  const usulan = scoped.filter((i) => i.status === 'usulan');
  const doneMonth = scoped.filter((i) => i.status === 'selesai' && (i.selesaiAt || '').slice(0, 7) === thisMonth);
  const donePrev = scoped.filter((i) => i.status === 'selesai' && (i.selesaiAt || '').slice(0, 7) === prevMonth);

  const list = scoped
    .filter((i) => (st === 'aktif' ? isOpenIssue(i) : st === 'usulan' ? i.status === 'usulan' : st === 'selesai' ? i.status === 'selesai' || i.status === 'ditolak' : true))
    .filter((i) => !mine || (me && i.pjIds.includes(me.id)))
    .filter((i) => !purchCat || PURCH_CATS.includes(i.kategori))
    .filter((i) => !cat || i.kategori === cat)
    .sort((a, b) => Number(lewatSla(b, today)) - Number(lewatSla(a, today)) || daysSince(b.dilaporAt || b.createdAt, today) - daysSince(a.dilaporAt || a.createdAt, today));
  const sel = issues.find((i) => i.id === selId) || null;

  const pareto = ISSUE_CATS.map((c) => {
    const xs = open.filter((i) => i.kategori === c.key);
    return { key: c.key, label: c.label, n: xs.length, v: xs.reduce((s, i) => s + valueOf(i), 0) };
  })
    .filter((p) => p.n)
    .sort((a, b) => b.v - a.v || b.n - a.n);
  const maxV = Math.max(1, ...pareto.map((p) => p.v));

  const pjIds = Array.from(new Set(open.flatMap((i) => i.pjIds)));
  const recentDone = scoped.filter((i) => i.status === 'selesai' && daysSince(i.selesaiAt, today) <= 90);
  const byPj = pjIds
    .map((id) => {
      const xs = open.filter((i) => i.pjIds.includes(id));
      return { id, open: xs.length, late: xs.filter((i) => lewatSla(i, today)).length, avg: avgDays(recentDone.filter((i) => i.pjIds.includes(id))) };
    })
    .sort((a, b) => b.open - a.open || b.late - a.late);

  const isBmLike = me?.role === 'bm' || me?.role === 'admin';
  const isSales = me?.role === 'sales';
  const suggestions = purch || !(isBmLike || isSales) ? [] : issueSuggestions(prospects, rfqs, issues, today).filter((s) => !cabang || up(s.prospect.cabang) === cabang);

  async function abaikan(s: IssueSuggestion) {
    try {
      const r = await api.post<{ issue: PipelineIssue }>('/api/pipeline-issues', { mode: 'abaikan', prospectId: s.prospect.id, saran: s.saran });
      useDataStore.getState().upsertIssue(r.issue);
      toast('Saran diabaikan (tidak muncul lagi 30 hari)', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    }
  }

  async function exportExcel() {
    if (!list.length) return toast('Tidak ada masalah pada filter ini', 'error');
    const XLSX = await import('xlsx');
    const rows = list.map((i) => ({
      Customer: i.customer,
      SE: i.se || '',
      Cabang: i.cabang || '',
      'Nilai prospek': valueOf(i),
      Kategori: issueCatLabel(i.kategori),
      Urgensi: urgensiLabel(i.urgensi),
      Status: ISSUE_STATUS_META[i.status].label,
      'Penanggung jawab': i.pjIds.map((id) => nameOf(roster, id)).join(', '),
      Keterangan: i.keterangan,
      'Diajukan oleh': i.diajukanNama || '',
      'Dilaporkan oleh': i.dilaporNama || '',
      'Tgl lapor': (i.dilaporAt || i.createdAt).slice(0, 10),
      'Umur (hari)': daysSince(i.dilaporAt || i.createdAt, i.selesaiAt ? i.selesaiAt.slice(0, 10) : today),
      'Target selesai': i.targetDate || '',
      Eskalasi: i.eskalasi >= 2 ? 'RM & GM' : i.eskalasi === 1 ? 'BM' : '',
      Solusi: i.solusi || i.alasanTolak || '',
      Hasil: i.hasil ? HASIL_META[i.hasil] : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Masalah Pipeline');
    XLSX.writeFile(wb, `CRM_Masalah_Pipeline_${today}.xlsx`);
  }

  const chips: [StFilter, string, number][] = [
    ['aktif', 'Aktif', open.length],
    ...(purch ? [] : ([['usulan', 'Usulan ke BM', usulan.length]] as [StFilter, string, number][])),
    ['selesai', 'Selesai / ditolak', scoped.filter((i) => i.status === 'selesai' || i.status === 'ditolak').length],
    ['semua', 'Semua', scoped.length],
  ];

  return (
    <div className="issue-board">
      {!purch && (
        <>
          <div className="issue-tiles">
            <div className="t rust"><span className="kam-role">MASALAH TERBUKA</span><b className="mono">{open.length}</b><span>{open.filter((i) => i.status === 'open').length} belum ditangani{usulan.length ? ` · ${usulan.length} usulan menunggu BM` : ''}</span></div>
            <div className="t amber"><span className="kam-role">NILAI TERTAHAN</span><b className="mono">{formatRupiah(open.reduce((s, i) => s + valueOf(i), 0))}</b><span>nilai prospek bermasalah</span></div>
            <div className="t rust2"><span className="kam-role">LEWAT SLA</span><b className="mono">{open.filter((i) => lewatSla(i, today)).length}</b><span>&gt;{ESKALASI_BM_HARI} hr belum ditangani / &gt;{ESKALASI_ATAS_HARI} hr belum selesai</span></div>
            <div className="t green"><span className="kam-role">SELESAI BULAN INI</span><b className="mono">{doneMonth.length}</b><span>{doneMonth.filter((i) => i.hasil === 'deal').length} Done/Deal · {doneMonth.filter((i) => i.hasil === 'lose').length} Lose</span></div>
            <div className="t steel"><span className="kam-role">RATA² PENYELESAIAN</span><b className="mono">{dayTxt(avgDays(doneMonth))}</b><span>bulan lalu {dayTxt(avgDays(donePrev))}</span></div>
          </div>

          <div className="issue-two">
            <div>
              <div className="issue-sub"><b>Pareto kategori — nilai tertahan</b><span className="field-note" style={{ margin: 0 }}>klik untuk menyaring daftar</span></div>
              {pareto.length === 0 && <div className="field-note">Tidak ada masalah terbuka.</div>}
              {pareto.map((p) => (
                <button key={p.key} type="button" className={`issue-pareto${cat === p.key ? ' on' : ''}`} onClick={() => setCat(cat === p.key ? '' : p.key)}>
                  <span className="l">{p.label}</span>
                  <span className="bar"><span style={{ width: `${Math.max(3, Math.round((p.v / maxV) * 100))}%` }} /></span>
                  <span className="mono v">{formatRupiah(p.v)}</span>
                  <span className="n">{p.n} kasus</span>
                </button>
              ))}
            </div>
            <div>
              <div className="issue-sub"><b>Per penanggung jawab (user)</b></div>
              <table className="simple-table">
                <thead><tr><th>PJ</th><th>Terbuka</th><th>&gt; SLA</th><th>Rata² selesai (90 hr)</th></tr></thead>
                <tbody>
                  {byPj.length === 0 ? (
                    <tr><td colSpan={4} className="field-note">-</td></tr>
                  ) : (
                    byPj.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{nameOf(roster, r.id)}</td>
                        <td className="mono">{r.open}</td>
                        <td><span className={`badge ${r.late ? 'rust' : 'slate'}`}>{r.late}</span></td>
                        <td className="mono">{dayTxt(r.avg)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="issue-toolbar">
        <div className="sa-pills">
          {chips.map(([k, l, n]) => (
            <button key={k} type="button" className={st === k ? 'on' : ''} onClick={() => setSt(k)}>
              {l} · {n}
            </button>
          ))}
        </div>
        <label className="issue-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Ditugaskan ke saya</label>
        {purch && <label className="issue-check"><input type="checkbox" checked={purchCat} onChange={(e) => setPurchCat(e.target.checked)} /> Hanya stok &amp; lead time</label>}
        {cat && <button type="button" className="btn btn-outline btn-sm" onClick={() => setCat('')}>Kategori: {issueCatLabel(cat)} ×</button>}
        {!purch && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ width: 160 }}>
            <option value="">Semua cabang</option>
            {cabangs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {canNow('masalah', 'x') && (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel}>
            Export Excel
          </button>
        )}
      </div>

      <div className={`issue-split${sel || lapor ? ' has-detail' : ''}`}>
        <div className="issue-list">
          {list.length === 0 && <div className="field-note" style={{ padding: 12 }}>Tidak ada masalah pada filter ini.</div>}
          {list.map((i) => {
            const late = lewatSla(i, today);
            const meta = ISSUE_STATUS_META[i.status];
            return (
              <button key={i.id} type="button" className={`issue-item${i.id === selId ? ' on' : ''}`} onClick={() => { setSelId(i.id); setLapor(null); }}>
                <div className="r1"><b>{i.customer}</b><span className={`badge ${meta.badge}`}>{meta.label}</span></div>
                <div className="r2">{issueCatLabel(i.kategori)} · {i.se || '-'} · {i.cabang || '-'} · <span className="mono">{formatRupiah(valueOf(i))}</span></div>
                <div className="r3">
                  <span>PJ: {i.pjIds.length ? i.pjIds.map((id, k) => `${nameOf(roster, id)}${k === 0 && i.pjIds.length > 1 ? '*' : ''}`).join(', ') : i.status === 'usulan' ? `menunggu BM (dari ${i.diajukanNama || 'Sales'})` : '-'}</span>
                  <span className={late ? 'late' : ''}>{issueAgeText(i, today)}{i.eskalasi ? ` · ↑ ${i.eskalasi >= 2 ? 'RM & GM' : 'BM'}` : ''}</span>
                </div>
                {i.status === 'selesai' && <div className="r2 ok">✓ {i.solusi} · {i.hasil ? HASIL_META[i.hasil] : ''}</div>}
              </button>
            );
          })}
        </div>
        {(sel || lapor) && (
          <div className="issue-side">
            <div className="issue-side-close">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setSelId(null); setLapor(null); }}>Tutup panel</button>
            </div>
            {lapor ? (
              <div className="issue-card">
                <IssueForm
                  mode={isBmLike ? 'lapor' : 'usulan'}
                  prospect={lapor.prospect}
                  kategoriAwal={lapor.kategori}
                  saran={lapor.saran}
                  onDone={(i) => { setLapor(null); setSelId(i.id); setSt(i.status === 'usulan' ? 'usulan' : 'aktif'); }}
                  onCancel={() => setLapor(null)}
                />
              </div>
            ) : (
              sel && <IssueDetail key={sel.id} issue={sel} />
            )}
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="issue-sug">
          <div className="issue-sub"><b>Saran CRM — prospek berpotensi bermasalah</b><span className="field-note" style={{ margin: 0 }}>{suggestions.length} prospek · dideteksi otomatis</span></div>
          {suggestions.slice(0, 15).map((s) => (
            <div key={s.key} className="issue-sug-row">
              <span className="txt"><b>{s.prospect.customer}</b> · {s.prospect.se || '-'} · <span className="mono">{formatRupiah(Number(s.prospect.value) || 0)}</span> — {s.why}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setLapor(s); setSelId(null); }}>
                ⚑ {isBmLike ? 'Laporkan' : 'Ajukan ke BM'}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => abaikan(s)}>Abaikan</button>
            </div>
          ))}
          {suggestions.length > 15 && <div className="field-note">+{suggestions.length - 15} saran lain.</div>}
        </div>
      )}
    </div>
  );
}
