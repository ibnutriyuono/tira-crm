'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { ALLOC_META, allocStatus, seKey, splitEven } from '@/lib/se-target';
import type { RosterUser, SafeUser, SeTarget } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const label = (p: string) => `${BLN[Number(p.slice(5, 7)) - 1] || ''} ${p.slice(0, 4)}`;
const dots = (n: number) => (n ? Math.round(n).toLocaleString('id-ID') : '');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');

export interface CabangAlloc {
  cabang: string;
  target: number;
  allocated: number;
  ses: string[];
  missing: string[];
  status: ReturnType<typeof allocStatus>;
}

/** Status pembagian target per cabang untuk periode ini. */
export function buildAllocations(cabangTargets: { cabang: string; target: number }[], seTargets: SeTarget[], roster: RosterUser[], periode: string): CabangAlloc[] {
  return cabangTargets.map(({ cabang, target }) => {
    const cb = cabang.toUpperCase();
    const rows = seTargets.filter((t) => t.periode === periode && t.cabang.toUpperCase() === cb && t.amount > 0);
    const rosterSe = roster.filter((u) => u.role === 'sales' && (u.cabang || '').toUpperCase() === cb && u.se).map((u) => seKey(u.se));
    const ses = Array.from(new Set([...rosterSe, ...rows.map((t) => seKey(t.se))])).sort();
    const has = new Set(rows.map((t) => seKey(t.se)));
    const missing = rosterSe.filter((s) => !has.has(s));
    const allocated = rows.reduce((s, t) => s + t.amount, 0);
    return { cabang: cb, target, allocated, ses, missing, status: allocStatus(target, allocated, missing.length) };
  });
}

/**
 * Forecast & Pipeline > Target per Sales.
 * Alur: pusat menetapkan target cabang (top-down) -> BM wajib membagi target
 * cabang ke tiap Sales di sini -> Sales menerima notifikasi target -> RM/GM
 * memantau status pembagian per cabang.
 */
export function SeTargetSection({
  periode,
  cabangTargets,
  seWon,
  canEdit,
  currentUser,
  roster,
}: {
  periode: string;
  cabangTargets: { cabang: string; target: number }[];
  seWon: Map<string, number>;
  canEdit: (cabang: string) => boolean;
  currentUser: SafeUser | null;
  roster: RosterUser[];
}) {
  const seTargets = useDataStore((s) => s.seTargets);
  const upsertSeTargets = useDataStore((s) => s.upsertSeTargets);
  const removeSeTargets = useDataStore((s) => s.removeSeTargets);
  const toast = useDataStore((s) => s.toast);
  const role = currentUser?.role;

  const allocs = useMemo(() => buildAllocations(cabangTargets, seTargets, roster, periode), [cabangTargets, seTargets, roster, periode]);
  const visible = allocs.filter((a) => a.target > 0 || a.allocated > 0);
  const own = (currentUser?.cabang || '').toUpperCase();
  const [sel, setSel] = useState<string>(role === 'bm' || role === 'salesadmin' ? own : '');
  const cur = allocs.find((a) => a.cabang === sel) || null;

  // ---- editor state (per cabang + periode)
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [applyRest, setApplyRest] = useState(true);
  const [busy, setBusy] = useState(false);
  const draftKey = `${sel}|${periode}|${cur?.ses.join(',')}`;
  const [loadedKey, setLoadedKey] = useState('');
  if (cur && loadedKey !== draftKey) {
    setLoadedKey(draftKey);
    const d: Record<string, string> = {};
    cur.ses.forEach((se) => {
      const t = seTargets.find((x) => seKey(x.se) === se && x.periode === periode);
      d[se] = dots(t?.amount || 0);
    });
    setDraft(d);
    setExtra([]);
  }

  if (role === 'sales') {
    const me = seKey(currentUser?.se);
    const t = seTargets.find((x) => seKey(x.se) === me && x.periode === periode)?.amount || 0;
    const won = seWon.get(me) || 0;
    return (
      <div className="kpi-grid" style={{ marginTop: 4 }}>
        <div className="kpi"><div className="label">Target Anda {label(periode)}</div><div className="value">{t ? formatRupiah(t) : '-'}</div><div className="foot">{t ? 'ditetapkan BM cabang' : 'belum dibagi oleh BM cabang'}</div></div>
        <div className="kpi won"><div className="label">Realisasi (Won)</div><div className="value">{formatRupiah(won)}</div><div className="foot">bulan ini</div></div>
        <div className="kpi rate"><div className="label">Achievement</div><div className="value">{pct(won, t)}</div><div className="foot">realisasi / target Anda</div></div>
      </div>
    );
  }

  const ses = cur ? [...cur.ses, ...extra] : [];
  const val = (se: string) => Number((draft[se] || '').replace(/\D/g, '')) || 0;
  const total = ses.reduce((s, se) => s + val(se), 0);
  const draftStatus = cur ? allocStatus(cur.target, total, ses.filter((se) => cur.missing.includes(se) && !val(se)).length) : 'noTarget';
  const editable = !!cur && canEdit(cur.cabang);
  const addable = roster.filter((u) => u.role === 'sales' && u.se && !ses.includes(seKey(u.se)));
  const nameOf = (se: string) => roster.find((u) => seKey(u.se) === se)?.name || '';

  async function save() {
    if (!cur) return;
    setBusy(true);
    try {
      const res = await api.put<{ seTargets: SeTarget[]; removedIds: string[] }>('/api/se-targets', {
        cabang: cur.cabang,
        periode,
        applyRest,
        rows: ses.map((se) => ({ se, amount: val(se) })),
      });
      upsertSeTargets(res.seTargets);
      removeSeTargets(res.removedIds);
      setLoadedKey('');
      toast(`Target Sales ${cur.cabang} ${label(periode)} disimpan${applyRest ? ' (proporsi berlaku s.d. Desember)' : ''}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan target Sales', 'error');
    } finally {
      setBusy(false);
    }
  }

  const multi = role !== 'bm' && role !== 'salesadmin';
  const incomplete = visible.filter((a) => a.status === 'empty' || a.status === 'short');

  return (
    <>
      {multi && (
        <>
          {incomplete.length > 0 && (
            <div className="import-summary if-warn" style={{ marginTop: 0, marginBottom: 8 }}>
              <b>{incomplete.length} cabang belum selesai membagi target {label(periode)} ke Sales:</b> {incomplete.map((a) => a.cabang).join(', ')}
            </div>
          )}
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table">
              <thead>
                <tr><th>Cabang</th><th>Target cabang</th><th>Dibagi ke Sales</th><th>Selisih</th><th>Sales bertarget</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={7} className="field-note">Belum ada target cabang pada periode ini.</td></tr>}
                {visible.map((a) => (
                  <tr key={a.cabang} style={sel === a.cabang ? { background: 'var(--steel-100)' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{a.cabang}</td>
                    <td className="mono">{formatRupiah(a.target)}</td>
                    <td className="mono">{formatRupiah(a.allocated)} <span className="field-note" style={{ margin: 0 }}>({pct(a.allocated, a.target)})</span></td>
                    <td className="mono">{a.target ? formatRupiah(a.target - a.allocated) : '-'}</td>
                    <td className="center">{a.ses.length - a.missing.length}/{a.ses.length || 0}</td>
                    <td><span className={`badge ${ALLOC_META[a.status].badge}`}>{ALLOC_META[a.status].label}</span></td>
                    <td>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setSel(sel === a.cabang ? '' : a.cabang)}>
                        {sel === a.cabang ? 'Tutup' : canEdit(a.cabang) ? 'Bagi target' : 'Lihat'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cur && (
        <div className="se-alloc">
          <div className="se-alloc-head">
            <b>Pembagian target {cur.cabang} · {label(periode)}</b>
            <span>Target cabang <b className="mono">{formatRupiah(cur.target)}</b></span>
            <span className={`badge ${ALLOC_META[draftStatus].badge}`}>{ALLOC_META[draftStatus].label}</span>
          </div>
          {!(cur.target > 0) ? (
            <div className="field-note">Target cabang {label(periode)} belum ditetapkan pusat. Pembagian ke Sales bisa dilakukan setelah target cabang ada.</div>
          ) : (
            <>
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table">
                  <thead>
                    <tr><th>SE</th><th>Nama</th><th>Target {label(periode)}</th><th>Porsi</th><th>Realisasi (Won)</th><th>Ach.</th></tr>
                  </thead>
                  <tbody>
                    {ses.length === 0 && <tr><td colSpan={6} className="field-note">Belum ada user Sales terdaftar di cabang {cur.cabang}. Tambahkan Sales di bawah.</td></tr>}
                    {ses.map((se) => {
                      const v = val(se);
                      const won = seWon.get(se) || 0;
                      return (
                        <tr key={se}>
                          <td style={{ fontWeight: 600 }}>{se}</td>
                          <td>{nameOf(se) || <span className="field-note" style={{ margin: 0 }}>(bukan user cabang ini)</span>}</td>
                          <td>
                            {editable ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                value={draft[se] || ''}
                                placeholder="0"
                                aria-label={`Target ${se}`}
                                onChange={(e) => {
                                  const d = e.target.value.replace(/\D/g, '');
                                  setDraft({ ...draft, [se]: d ? Number(d).toLocaleString('id-ID') : '' });
                                }}
                                style={{ maxWidth: 170, textAlign: 'right', fontFamily: 'var(--font-ibm-plex-mono), monospace', borderColor: !v ? 'var(--rust-500)' : undefined }}
                              />
                            ) : (
                              <span className="mono">{v ? formatRupiah(v) : '-'}</span>
                            )}
                          </td>
                          <td className="mono">{pct(v, cur.target)}</td>
                          <td className="mono">{formatRupiah(won)}</td>
                          <td className="center">{v ? <span className={`badge ${won >= v ? 'green' : won >= v * 0.6 ? 'amber' : 'rust'}`}>{pct(won, v)}</span> : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700, background: 'var(--steel-100)' }}>
                      <td colSpan={2}>Total dibagi</td>
                      <td className="mono">{formatRupiah(total)}</td>
                      <td className="mono">{pct(total, cur.target)}</td>
                      <td colSpan={2} className="mono">{total === cur.target ? 'Pas dengan target cabang' : total < cur.target ? `Kurang ${formatRupiah(cur.target - total)}` : `Lebih ${formatRupiah(total - cur.target)}`}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {editable && (
                <div className="se-alloc-actions">
                  <button type="button" className="btn btn-outline btn-sm" disabled={!ses.length} onClick={() => {
                    const parts = splitEven(cur.target, ses.length);
                    const d: Record<string, string> = {};
                    ses.forEach((se, i) => (d[se] = dots(parts[i])));
                    setDraft(d);
                  }}>
                    Bagi rata
                  </button>
                  {addable.length > 0 && (
                    <select value="" onChange={(e) => e.target.value && setExtra([...extra, e.target.value])} style={{ maxWidth: 240 }} aria-label="Tambah Sales">
                      <option value="">+ Tambah Sales…</option>
                      {addable.map((u) => <option key={u.id} value={seKey(u.se)}>{seKey(u.se)} · {u.name}{u.cabang ? ` (${u.cabang})` : ''}</option>)}
                    </select>
                  )}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={applyRest} onChange={(e) => setApplyRest(e.target.checked)} /> Terapkan porsi yang sama s.d. Desember
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={busy || !ses.length} onClick={save}>
                    {busy ? 'Menyimpan…' : 'Simpan target Sales'}
                  </button>
                </div>
              )}
              <div className="field-note" style={{ marginTop: 6 }}>
                Wajib: jumlah target Sales = target cabang, dan setiap Sales di cabang punya target. Mengosongkan target satu Sales menghapusnya. &quot;Terapkan porsi
                yang sama&quot; mengisi bulan berikutnya s.d. Desember dengan persentase yang sama dari target cabang bulan itu. Sales menerima notifikasi targetnya.
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
