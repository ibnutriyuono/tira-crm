'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CUSTOMER_APLIKASI_LABEL, PIC_PERAN, PIC_PERAN_LABEL, STATUS_META } from '@/lib/constants';
import { buildTimeline } from '@/lib/customer-contact';
import {
  CUST_STATUS_META,
  benchValue,
  crossSell,
  crossSellFromBench,
  handoverChecklist,
  nextStep,
  rpShort,
  scoreColor,
  scoreLabel,
  seasonNote,
  sePeriods,
  tenderBreakdown,
  wonDate,
  ymLabel,
  type BenchKey,
  type CustomerFacts,
  type SegmentBenchmark,
  type SePeriod,
} from '@/lib/customer-profile';
import { classify, formatDateID, formatRupiah, num } from '@/lib/format';
import { KAM_TIER_META } from '@/lib/kam';
import { customerKey } from '@/lib/reports';
import { activityOwner } from '@/lib/sales-activity';
import type { CustomerPic } from '@/lib/types';
import { useCustomerProfiles } from '@/hooks/useCustomerProfiles';
import { canNow } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

import { useT } from '@/store/useLangStore';
type Tab = 'ringkasan' | 'pembelian' | 'tender' | 'kontak' | 'banding' | 'timeline';
const PALETTE = ['#345170', '#C9822E', '#2F7A55', '#7060AD', '#2A8888', '#BC5083'];
const pctTxt = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v)}%`);
const sgnTxt = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);
const d1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('id-ID');

function Bar({ w, color, h = 8 }: { w: number; color: string; h?: number }) {
  return (
    <div className="cp-bar" style={{ height: h }}>
      <div style={{ width: `${Math.max(0, Math.min(100, w))}%`, background: color, height: h }} />
    </div>
  );
}

export function CustomerProfileModal() {
  const tr = useT();
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'customerProfile';
  const name = useUiStore((s) => s.profileCustomer);
  const returnTo = useUiStore((s) => s.profileReturnTo);
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const { index, loaded, activities, today, benchmarks } = useCustomerProfiles(show, true);

  const [tab, setTab] = useState<Tab>('ringkasan');
  const [mode, setMode] = useState<'customer' | 'se'>('customer');
  const [seg, setSeg] = useState<string | null>(null);
  const [peers, setPeers] = useState<string[] | null>(null);
  const [peerQ, setPeerQ] = useState('');
  const [sePick, setSePick] = useState<number[] | null>(null);
  useEffect(() => {
    setTab('ringkasan');
    setSeg(null);
    setPeers(null);
    setPeerQ('');
    setSePick(null);
  }, [name]);

  const key = name ? customerKey(name) : '';
  const f = key ? index.get(key) : undefined;
  const all = [...index.values()];
  const segPeers = f?.segmen ? all.filter((x) => x.segmen === f.segmen) : [];

  function close() {
    closeModal();
    if (returnTo) openModal(returnTo);
  }
  if (!show) return null;
  if (!f) {
    return (
      <Modal show={show} onClose={close} title={tr("Profil Customer")} xwide footer={<button type="button" className="btn btn-outline" onClick={close}>{tr("Tutup")}</button>}>
        <div className="empty-state" style={{ padding: '34px 10px' }}><h3>{tr("Customer tidak ditemukan")}</h3><p>{tr("Data customer ini tidak ada dalam cakupan Anda.")}</p></div>
      </Modal>
    );
  }

  const st = CUST_STATUS_META[f.status];
  const kam = f.group ? KAM_TIER_META[f.group.tier] : null;
  const canEdit = !!f.customer && canNow('customer', 'e');
  const canLog = !!currentUser && activityOwner(currentUser) !== null && canNow('aktivitas', 'e');
  const apl = (f.customer?.aplikasi || []).map((k) => CUSTOMER_APLIKASI_LABEL[k] || k);
  const pics = (f.customer?.pics || []) as CustomerPic[];

  function editProfile() {
    if (!f?.customer) return;
    useUiStore.setState({ customerEditId: f.customer.id, customerFormReturnTo: 'customerProfile' });
    openModal('customerForm');
  }
  function logActivity() {
    if (!f) return;
    useUiStore.setState({ activityPrefill: { customer: f.name, tipe: 'kunjungan', keterangan: '', returnTo: 'customerProfile' } });
    openModal('salesActivity');
  }
  function sendWa() {
    if (!f?.customer) return;
    useUiStore.setState({ followUpCtx: { type: 'customer', id: f.customer.id } });
    openModal('followUp');
  }

  const TABS: [Tab, string][] = [
    ['ringkasan', 'Ringkasan'],
    ['pembelian', 'Pembelian'],
    ['tender', 'Tender'],
    ['kontak', `Kontak (${pics.length})`],
    ['banding', 'Bandingkan'],
    ['timeline', 'Timeline'],
  ];

  return (
    <Modal
      show={show}
      onClose={close}
      title={`Profil Customer — ${f.name}`}
      xwide
      stickyHead
      footer={
        <>
          {f.customer && <button type="button" className="btn btn-outline" onClick={sendWa}>{tr("WhatsApp")}</button>}
          {canLog && <button type="button" className="btn btn-outline" onClick={logActivity}>{tr("Catat aktivitas")}</button>}
          {canEdit && <button type="button" className="btn btn-outline" onClick={editProfile}>{tr("Edit profil")}</button>}
          <button type="button" className="btn btn-primary" onClick={close}>{returnTo ? tr("← Kembali") : tr("Tutup")}</button>
        </>
      }
    >
      <div className="cp-head">
        <span className={`badge ${st.color}`} title={st.hint}>{st.label}</span>
        <span>{f.segmen || <i className="cp-muted">{tr("segmen belum diisi")}</i>}</span>
        {apl.length > 0 && <span>· {apl.join(', ')}</span>}
        {f.cabang && <span>{tr("· Cabang")} {f.cabang}</span>}
        {f.se && <span>{tr("· SE")} {f.se}</span>}
        {kam && f.group && <span className="badge steel" title={`Key Account · ${f.group.name}`}>{kam.label} · {f.group.name}</span>}
        {!f.customer && <span className="field-note" style={{ margin: 0 }}>{tr("Belum ada di Kelola Customer — segmen, potensi & peran PIC bisa diisi setelah customer ditambahkan.")}</span>}
      </div>

      <div className="cp-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'ringkasan' && <Ringkasan f={f} peers={segPeers} bench={benchmarks.find((b) => b.segmen === f.segmen)} today={today} loaded={loaded} canEdit={canEdit} onEdit={editProfile} />}
      {tab === 'pembelian' && <Pembelian f={f} />}
      {tab === 'tender' && <Tender f={f} />}
      {tab === 'kontak' && <Kontak f={f} pics={pics} today={today} canEdit={canEdit} onEdit={editProfile} />}
      {tab === 'banding' && (
        <>
          <div className="cp-mode">
            <button type="button" className={mode === 'customer' ? 'on' : ''} onClick={() => setMode('customer')}>{tr("Antar customer sejenis")}</button>
            <button type="button" className={mode === 'se' ? 'on' : ''} onClick={() => setMode('se')}>{tr("Antar SE yang menangani")}</button>
          </div>
          {mode === 'customer' ? (
            <BandingCustomer f={f} all={all} benchmarks={benchmarks} seg={seg} setSeg={setSeg} peers={peers} setPeers={setPeers} q={peerQ} setQ={setPeerQ} />
          ) : (
            <BandingSe f={f} today={today} pick={sePick} setPick={setSePick} />
          )}
        </>
      )}
      {tab === 'timeline' && <Timeline f={f} activities={activities} />}
    </Modal>
  );
}

// ================================================================ Ringkasan

function Ringkasan({ f, peers, bench, today, loaded, canEdit, onEdit }: { f: CustomerFacts; peers: CustomerFacts[]; bench?: SegmentBenchmark; today: string; loaded: boolean; canEdit: boolean; onEdit: () => void }) {
  const tr = useT();
  const next = nextStep(f, today);
  const localCross = crossSell(f, peers);
  const cross = localCross.length ? localCross : crossSellFromBench(f, bench);
  const sc = scoreColor(f.score);
  const aktifVal = f.aktif.reduce((s, r) => s + num(r.value), 0);
  const late = f.status === 'jarang' || f.status === 'tidur' || f.status === 'hilang';
  return (
    <div className="cp-grid3">
      <div className="cp-box cp-soft">
        <div className="cp-lbl">{tr("Skor kesehatan")}</div>
        <div className="cp-score-big">
          <b className={`cp-c-${sc}`}>{loaded ? f.score : '…'}</b>
          <span>/ 100 · {scoreLabel(f.score)}</span>
        </div>
        <Bar w={f.score} color={`var(--${sc === 'rust' ? 'rust' : sc}-500)`} h={10} />
        <div className="cp-reasons">
          {f.reasons.map((r, i) => (
            <div key={i}>
              <b className={r.v > 0 ? 'cp-c-green' : 'cp-c-rust'}>{r.v > 0 ? `+${r.v}` : r.v}</b>
              <span>{r.t}</span>
            </div>
          ))}
          {f.reasons.length === 0 && <span className="cp-muted">{tr("Belum ada data order atau kontak.")}</span>}
        </div>
        <div className="field-note" style={{ marginTop: 8 }}>{tr("Mulai dari 50, ditambah/dikurangi tiap sinyal di atas.")}</div>
      </div>

      <div className="cp-col">
        <div className="cp-kpis">
          <div className="cp-box">
            <div className="cp-lbl">{tr("Omzet 12 bulan")}</div>
            <div className="cp-val">{rpShort(f.omzet12)}</div>
            <div className={`cp-foot ${f.yoy == null ? '' : f.yoy >= 0 ? 'cp-c-green' : 'cp-c-rust'}`}>{f.yoy == null ? tr("belum ada pembanding tahun lalu") : `${sgnTxt(f.yoy)} vs 12 bulan sebelumnya`}</div>
          </div>
          <div className="cp-box">
            <div className="cp-lbl">{tr("Win rate 12 bulan")}</div>
            <div className="cp-val">{pctTxt(f.winRate12)}</div>
            <div className="cp-foot">{f.wins12} {tr("menang ·")} {f.losses12} {tr("kalah")}</div>
          </div>
          <div className="cp-box">
            <div className="cp-lbl">{tr("Prospek aktif")}</div>
            <div className="cp-val">{rpShort(aktifVal)}</div>
            <div className={`cp-foot ${f.mangkrak.length ? 'cp-c-rust' : ''}`}>{f.aktif.length} {tr("prospek")}{f.mangkrak.length ? ` · ${f.mangkrak.length} mangkrak` : ''}</div>
          </div>
          <div className="cp-box">
            <div className="cp-lbl">{tr("Masalah terbuka")}</div>
            <div className="cp-val">{f.openIssues.length}</div>
            <div className={`cp-foot ${f.gitOld.length ? 'cp-c-rust' : ''}`}>{f.gitOld.length ? `GIT > 30 hari ${rpShort(f.gitOldValue)}` : tr("tidak ada GIT tertahan")}</div>
          </div>
        </div>
        <div className="cp-box">
          <div className="cp-lbl">{tr("Pangsa kita (share of wallet)")}</div>
          {f.potensi ? (
            <>
              <Bar w={f.share || 0} color="var(--steel-500)" h={12} />
              <div className="cp-foot">{rpShort(f.omzet12)} {tr("dari estimasi potensi")} {rpShort(f.potensi)} {tr("per tahun (")}{f.share}%)</div>
            </>
          ) : (
            <div className="cp-foot">
              {tr("Estimasi potensi per tahun belum diisi.")}{' '}
              {canEdit && <button type="button" className="link-btn" onClick={onEdit}>{tr("Isi di Edit profil")}</button>}
            </div>
          )}
        </div>
      </div>

      <div className="cp-col">
        <div className={`cp-box ${late ? 'cp-bad' : f.cycleDays ? 'cp-good' : 'cp-soft'}`}>
          <div className="cp-lbl">{tr("Siklus order")}</div>
          <b>{f.cycleDays ? `Biasanya order tiap ±${f.cycleDays} hari` : f.wonAll.length ? tr("Order belum cukup untuk menghitung siklus") : tr("Belum pernah order")}</b>
          <div className="cp-foot">
            {f.lastOrder ? `Terakhir ${formatDateID(f.lastOrder)} (${f.daysSinceOrder} hari lalu)` : tr("Masih tahap prospek")}
            {f.nextOrderDate ? (f.nextOrderDate >= today ? ` · perkiraan berikutnya ${formatDateID(f.nextOrderDate)}` : ` · lewat ${Math.round((Date.parse(today) - Date.parse(f.nextOrderDate)) / 86400000)} hari dari perkiraan`) : ''}
          </div>
        </div>
        <div className="cp-box cp-next">
          <div className="cp-lbl">{tr("Langkah berikutnya")}</div>
          <b>{next.title}</b>
          <div className="cp-foot">{next.why}</div>
        </div>
        <div className="cp-box">
          <div className="cp-lbl">{tr("Peluang cross-sell")}</div>
          {!f.segmen ? (
            <div className="cp-foot">{tr("Isi segmen customer agar bisa dibandingkan dengan customer sejenis.")}</div>
          ) : cross.length === 0 ? (
            <div className="cp-foot">{tr("Belum ada produk yang umum dibeli customer")} {f.segmen} {tr("lain tetapi belum di sini.")}</div>
          ) : (
            cross.map((c) => (
              <div key={c.label} style={{ fontSize: 13, marginTop: 4 }}>
                <b>{c.label}</b> {tr("— dibeli")} {c.n} {tr("dari")} {c.of} {tr("customer")} {f.segmen} {tr("lain")}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ================================================================ Pembelian

function Pembelian({ f }: { f: CustomerFacts }) {
  const tr = useT();
  const mx = Math.max(1, ...f.months12.map((m) => m.nilai));
  const pmx = Math.max(1, ...f.products.map((p) => p.nilai));
  return (
    <div className="cp-grid2">
      <div>
        <div className="cp-lbl">{tr("Omzet 12 bulan terakhir")}</div>
        <div className="cp-chart">
          {f.months12.map((m, i) => (
            <div key={m.ym} title={`${ymLabel(m.ym, true)}: ${formatRupiah(m.nilai)} · ${m.orders} order`}>
              <span>{m.nilai ? rpShort(m.nilai).replace('Rp ', '') : ''}</span>
              <i style={{ height: `${(m.nilai / mx) * 100}%`, background: i >= 9 ? 'var(--amber-500)' : 'var(--steel-500)' }} />
            </div>
          ))}
        </div>
        <div className="cp-chart-x">{f.months12.map((m) => <span key={m.ym}>{ymLabel(m.ym)}</span>)}</div>
        <p className="cp-foot" style={{ marginTop: 8 }}>{seasonNote(f)}</p>
      </div>
      <div>
        <div className="cp-lbl">{tr("Produk yang paling sering dibeli")}</div>
        {f.products.length === 0 && <p className="cp-foot">{tr("Belum ada order.")}</p>}
        {f.products.slice(0, 6).map((p) => (
          <div key={p.label} className="cp-prod">
            <div><b>{p.label}</b><span className="mono">{rpShort(p.nilai)}</span></div>
            <Bar w={(p.nilai / pmx) * 100} color="var(--steel-500)" />
            <span className="cp-foot">{p.orders} {tr("order · terakhir")} {formatDateID(p.lastDate)}</span>
          </div>
        ))}
        <div className="cp-kpis" style={{ marginTop: 10 }}>
          <div className="cp-box cp-soft"><div className="cp-lbl">{tr("Rata-rata per order")}</div><div className="cp-val">{rpShort(f.avgOrder12)}</div><div className="cp-foot">{tr("12 bulan")}</div></div>
          <div className="cp-box cp-soft"><div className="cp-lbl">{tr("Order 12 bulan")}</div><div className="cp-val">{f.orders12}×</div><div className="cp-foot">{tr("total histori")} {f.wonAll.length}×</div></div>
        </div>
      </div>
    </div>
  );
}

// ================================================================ Tender

function Tender({ f }: { f: CustomerFacts }) {
  const tr = useT();
  const t = tenderBreakdown(f);
  const lmx = Math.max(1, ...t.lostReasons.map((x) => x.n));
  const wmx = Math.max(1, ...t.wonReasons.map((x) => x.n));
  const decided = f.wins12 + f.losses12;
  return (
    <div className="cp-grid3">
      <div className="cp-col">
        <div className="cp-lbl">{tr("Menang / kalah 12 bulan")}</div>
        <div className="cp-score-big"><b>{pctTxt(f.winRate12)}</b><span>{tr("win rate ·")} {f.wins12} {tr("menang ·")} {f.losses12} {tr("kalah")}</span></div>
        {decided > 0 && (
          <div className="cp-wl"><i style={{ width: `${(f.wins12 / decided) * 100}%` }} /></div>
        )}
        <div className="cp-kpis">
          <div className="cp-box cp-soft"><div className="cp-lbl">{tr("Lama keputusan")}</div><div className="cp-val">{f.decideDays != null ? `${Math.round(f.decideDays)} hari` : '–'}</div><div className="cp-foot">{tr("penawaran → PO (median)")}</div></div>
          <div className="cp-box cp-soft"><div className="cp-lbl">{tr("Total deal")}</div><div className="cp-val">{f.records.filter((r) => classify(r) !== 'Activity').length}</div><div className="cp-foot">{tr("semua histori prospek")}</div></div>
        </div>
      </div>
      <div className="cp-col">
        <div className="cp-lbl">{tr("Alasan kalah (QCD)")}</div>
        {t.lostReasons.length === 0 && <p className="cp-foot">{t.lostTotal ? `${t.lostTotal} deal kalah belum diisi faktor QCD.` : tr("Belum ada deal kalah.")}</p>}
        {t.lostReasons.map((x) => (
          <div key={x.key} className="cp-prod">
            <div><b>{x.label}</b><span className="mono">{x.n}×</span></div>
            <Bar w={(x.n / lmx) * 100} color="var(--rust-500)" />
          </div>
        ))}
        <div className="cp-lbl" style={{ marginTop: 12 }}>{tr("Faktor menang")}</div>
        {t.wonReasons.length === 0 && <p className="cp-foot">{tr("Belum ada faktor menang tercatat.")}</p>}
        {t.wonReasons.map((x) => (
          <div key={x.key} className="cp-prod">
            <div><b>{x.label}</b><span className="mono">{x.n}×</span></div>
            <Bar w={(x.n / wmx) * 100} color="var(--green-500)" />
          </div>
        ))}
      </div>
      <div className="cp-col">
        <div className="cp-lbl">{tr("Kompetitor di customer ini")}</div>
        {f.customer?.kompetitor && <div className="cp-box cp-soft" style={{ fontSize: 13 }}>{tr("Dicatat Sales:")} <b>{f.customer.kompetitor}</b></div>}
        {t.competitors.length === 0 && <p className="cp-foot">{tr("Belum ada kompetitor tercatat di QCD deal kalah.")}</p>}
        {t.competitors.map((c) => (
          <div key={c.name} className="cp-box" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
            <span><b>{c.name}</b><br /><span className="cp-foot">{tr("menang")} {c.n}× · {rpShort(c.nilai)} {tr("· terakhir")} {formatDateID(c.last)}</span></span>
            <span className="mono cp-c-rust">{c.n}×</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================================================================ Kontak

function Kontak({ f, pics, today, canEdit, onEdit }: { f: CustomerFacts; pics: CustomerPic[]; today: string; canEdit: boolean; onEdit: () => void }) {
  const tr = useT();
  const lastWith = (nama: string) => f.acts.find((a) => (Array.isArray(a.pics) ? a.pics : []).some((p) => String(p.nama || '').trim().toLowerCase() === nama.trim().toLowerCase()));
  const hasDm = pics.some((p) => p.peran === 'dm');
  const ses = Array.from(new Set(f.acts.filter((a) => a.tanggal >= new Date(Date.parse(today) - 90 * 86400000).toISOString().slice(0, 10)).map((a) => a.se)));
  return (
    <div className="cp-col">
      {pics.length > 0 && !hasDm && (
        <div className="cp-box cp-warn">
          {tr("Belum ada PIC berperan")} <b>{tr("pengambil keputusan")}</b>{tr(". Semua kontak lewat")} {pics.map((p) => `${p.nama}${p.peran ? ` (${PIC_PERAN_LABEL[p.peran].toLowerCase()})` : ''}`).join(', ')} {tr("— berisiko bila PIC pindah. Minta dikenalkan ke atasan saat kunjungan berikutnya.")}
          {canEdit && <> <button type="button" className="link-btn" onClick={onEdit}>{tr("Atur peran PIC")}</button></>}
        </div>
      )}
      <div className="cp-foot">{tr("Kontak 90 hari:")} <b>{f.contacts90}</b> ({f.visits90} {tr("kunjungan)")}{ses.length ? ` · oleh ${ses.join(', ')}` : ''}{f.lastContact ? ` · terakhir ${formatDateID(f.lastContact.tanggal)}` : ''}</div>
      {pics.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 10px' }}><p>{tr("Belum ada PIC di Kelola Customer.")}</p></div>
      ) : (
        <div className="cp-pics">
          {pics.map((p) => {
            const meta = PIC_PERAN.find((r) => r.key === p.peran);
            const last = lastWith(p.nama);
            return (
              <div key={p.id} className="cp-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b>{p.nama}{p.isPrimary ? tr(" · utama") : ''}</b>
                  <span className={`badge ${meta?.color || 'slate'}`} style={{ whiteSpace: 'nowrap', alignSelf: 'flex-start', flexShrink: 0 }}>{meta?.label || tr("peran belum diisi")}</span>
                </div>
                <div className="cp-foot">{p.jabatan || '-'}</div>
                <div className="mono" style={{ fontSize: 12.5 }}>{p.phone || '-'}{p.email ? ` · ${p.email}` : ''}</div>
                <div className="cp-foot">{tr("Kontak terakhir:")} {last ? `${formatDateID(last.tanggal)} · ${last.se}` : tr("belum tercatat")}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ================================================================ Bandingkan: customer

type Metric = { k: BenchKey; l: string; hint: string; fmt: (v: number) => string; better: 'hi' | 'lo' };
const METRICS: Metric[] = [
  { k: 'omzet12', l: 'Omzet 12 bulan', hint: 'nilai PO/DO', fmt: rpShort, better: 'hi' },
  { k: 'yoy', l: 'Tren YoY', hint: 'vs 12 bulan sebelumnya', fmt: (v) => sgnTxt(v), better: 'hi' },
  { k: 'orders12', l: 'Order 12 bulan', hint: 'jumlah PO', fmt: (v) => `${d1(v)}×`, better: 'hi' },
  { k: 'avgOrder12', l: 'Rata-rata per order', hint: '', fmt: rpShort, better: 'hi' },
  { k: 'winRate12', l: 'Win rate', hint: 'penawaran → PO, 12 bulan', fmt: (v) => pctTxt(v), better: 'hi' },
  { k: 'decideDays', l: 'Lama keputusan', hint: 'penawaran → PO (median)', fmt: (v) => `${Math.round(v)} hari`, better: 'lo' },
  { k: 'contacts90', l: 'Kontak 90 hari', hint: 'Aktivitas Harian', fmt: (v) => d1(v), better: 'hi' },
  { k: 'score', l: 'Skor kesehatan', hint: '0–100', fmt: (v) => String(Math.round(v)), better: 'hi' },
  { k: 'share', l: 'Pangsa kita', hint: 'dari estimasi potensi', fmt: (v) => pctTxt(v), better: 'hi' },
];
const avgOf = (list: CustomerFacts[], k: BenchKey) => {
  const v = list.map((x) => benchValue(x, k)).filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

function BandingCustomer({ f, all, benchmarks, seg, setSeg, peers, setPeers, q, setQ }: {
  f: CustomerFacts; all: CustomerFacts[]; benchmarks: SegmentBenchmark[]; seg: string | null; setSeg: (s: string | null) => void; peers: string[] | null; setPeers: (p: string[] | null) => void; q: string; setQ: (s: string) => void;
}) {
  const tr = useT();
  const segAktif = seg ?? f.segmen ?? '__all';
  const segs = Array.from(new Set([...all.map((x) => x.segmen), ...benchmarks.map((b) => b.segmen)].filter((x) => x && x !== '__all'))) as string[];
  const bench = benchmarks.find((b) => b.segmen === segAktif);
  const inSeg = (x: CustomerFacts) => segAktif === '__all' || x.segmen === segAktif;
  const pool = all.filter((x) => inSeg(x) && x.records.length > 0);
  const cands = pool.filter((x) => x.key !== f.key).sort((a, b) => b.omzet12 - a.omzet12);
  const picked = (peers ?? cands.slice(0, 2).map((x) => x.key)).filter((k) => cands.some((c) => c.key === k));
  const cols = [f, ...picked.map((k) => cands.find((c) => c.key === k) as CustomerFacts)];
  const shown = cands.filter((c) => picked.includes(c.key) || !q || c.name.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 30 : 12);
  const toggle = (k: string) => {
    if (picked.includes(k)) setPeers(picked.filter((x) => x !== k));
    else if (picked.length < 3) setPeers([...picked, k]);
  };
  const segLabel = segAktif === '__all' ? 'semua segmen' : segAktif;
  // Rata-rata nasional (agregat server) bila ada; selain itu rata-rata customer dalam cakupan.
  const avgFor = (k: BenchKey) => (bench ? bench.avg[k] : avgOf(pool, k));
  const avgLabel = bench ? `nasional · ${segLabel} · ${bench.n} customer` : `${segLabel} · ${pool.length} customer`;

  const insight = (l: string, k: BenchKey, fmt: (v: number) => string, better: 'hi' | 'lo', unit: string) => {
    const me = benchValue(f, k);
    const avg = avgFor(k);
    if (me == null || avg == null) return { l, h: me == null ? 'belum ada data' : `${fmt(me)}`, s: 'rata-rata segmen belum bisa dihitung', cls: 'cp-soft' };
    const d = me - avg;
    const good = better === 'hi' ? d >= 0 : d <= 0;
    const dv = unit ? `${d > 0 ? '+' : ''}${d1(d)}${unit}` : `${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}`;
    return { l, h: `${fmt(me)} vs ${fmt(avg)}`, s: `${good ? 'Lebih baik' : 'Lebih buruk'} dari rata-rata ${bench ? 'nasional ' : ''}${segLabel} (${dv})`, cls: good ? 'cp-good' : 'cp-bad' };
  };
  const insights = [
    insight('Win rate', 'winRate12', (v) => pctTxt(v), 'hi', ' poin'),
    insight('Lama keputusan', 'decideDays', (v) => `${Math.round(v)} hr`, 'lo', ' hari'),
    insight('Tren omzet YoY', 'yoy', (v) => sgnTxt(v), 'hi', ' poin'),
    f.potensi ? insight('Pangsa kita', 'share', (v) => pctTxt(v), 'hi', ' poin') : insight('Kontak 90 hari', 'contacts90', (v) => d1(v), 'hi', ''),
  ];

  const prodSet = new Map<string, number>();
  pool.forEach((x) => new Set(x.products.map((p) => p.label)).forEach((l) => prodSet.set(l, (prodSet.get(l) || 0) + 1)));
  const localBuyers = pool.filter((x) => x.products.length).length || 1;
  const prods: { label: string; pct: number; note: string }[] = bench
    ? bench.products.slice(0, 8).map((p) => ({ label: p.label, pct: p.pct, note: `${p.buyers} dari ${bench.buyers} customer segmen membeli` }))
    : [...prodSet.entries()].filter(([l]) => l !== '-').sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, n]) => ({ label, pct: Math.round((n / localBuyers) * 100), note: `${n} dari ${localBuyers} customer membeli` }));
  const grid = { gridTemplateColumns: `200px repeat(${cols.length + 1}, minmax(0, 1fr))` };

  return (
    <div className="cp-col">
      <div className="cp-chiprow">
        <span className="cp-lbl">{tr("Segmen")}</span>
        {segs.map((s) => (
          <button key={s} type="button" className={`cf-chip${segAktif === s ? ' on' : ''}`} onClick={() => { setSeg(s); setPeers(null); }}>
            {s}{s === f.segmen ? tr(" (segmen ini)") : ''}
          </button>
        ))}
        <button type="button" className={`cf-chip${segAktif === '__all' ? ' on' : ''}`} onClick={() => { setSeg('__all'); setPeers(null); }}>{tr("Semua segmen")}</button>
      </div>
      {!f.segmen && <div className="cp-box cp-warn">{tr("Segmen customer ini belum diisi — pembanding memakai semua segmen. Isi segmen di Edit profil agar dibandingkan dengan customer sejenis.")}</div>}
      <div className="cp-chiprow">
        <span className="cp-lbl">{tr("Bandingkan dengan (maks. 3)")}</span>
        <input type="search" className="btn-sm" placeholder={tr("Cari customer…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
        {shown.map((c) => {
          const on = picked.includes(c.key);
          const dis = !on && picked.length >= 3;
          return (
            <button key={c.key} type="button" className={`cf-chip${on ? ' on' : ''}`} disabled={dis} onClick={() => toggle(c.key)} title={`${rpShort(c.omzet12)} omzet 12 bulan`}>
              {on ? '✓' : '+'} {c.name}
            </button>
          );
        })}
        {cands.length === 0 && <span className="cp-foot">{tr("Belum ada customer lain di segmen ini dalam cakupan Anda.")}</span>}
      </div>

      <div className="cp-kpis cp-kpis4">
        {insights.map((x) => (
          <div key={x.l} className={`cp-box ${x.cls}`}>
            <div className="cp-lbl">{x.l}</div>
            <b>{x.h}</b>
            <div className="cp-foot">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="cp-table">
        <div className="cp-tr cp-th" style={grid}>
          <span>{tr("Metrik 12 bulan")}</span>
          {cols.map((c, i) => <span key={c.key} className={i === 0 ? 'cp-me' : ''}>{c.name}<em>{i === 0 ? 'dibuka' : c.segmen || '-'}</em></span>)}
          <span>{tr("Rata-rata")}<em>{avgLabel}</em></span>
        </div>
        {METRICS.map((m) => {
          const vals = cols.map((c) => benchValue(c, m.k));
          const avg = avgFor(m.k);
          const all2 = [...vals, avg].filter((v): v is number => v != null);
          const mx = Math.max(1, ...all2.map((v) => Math.abs(v)));
          const known = vals.filter((v): v is number => v != null);
          const best = known.length > 1 ? (m.better === 'hi' ? Math.max(...known) : Math.min(...known)) : null;
          return (
            <div key={m.l} className="cp-tr" style={grid}>
              <span><b>{m.l}</b><em>{m.hint}</em></span>
              {[...vals, avg].map((v, i) => (
                <div key={i} className={i === 0 ? 'cp-me' : ''}>
                  <span className={`mono ${v != null && v === best && i < vals.length ? 'cp-best' : ''}`}>{v == null ? '–' : m.fmt(v)}</span>
                  <Bar w={v == null ? 0 : (Math.abs(v) / mx) * 100} color={i === vals.length ? 'var(--slate-300)' : i === 0 ? 'var(--amber-500)' : 'var(--steel-500)'} h={5} />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="cp-table">
        <div className="cp-tr cp-th" style={grid}>
          <span>{tr("Produk yang dibeli")}</span>
          {cols.map((c, i) => <span key={c.key} className={i === 0 ? 'cp-me' : ''}>{c.name}</span>)}
          <span>{tr("% segmen")}{bench ? tr(" nasional") : ''}</span>
        </div>
        {prods.length === 0 && <div className="cp-tr"><span className="cp-foot">{tr("Belum ada data pembelian di segmen ini.")}</span></div>}
        {prods.map(({ label, pct, note }) => {
          const has = cols.map((c) => c.products.some((p) => p.label === label));
          const gap = !has[0] && (has.slice(1).some(Boolean) || pct >= 30);
          return (
            <div key={label} className={`cp-tr ${gap ? 'cp-gap' : ''}`} style={grid}>
              <span><b>{label}</b><em>{gap ? `Peluang: belum dibeli di sini · ${note}` : note}</em></span>
              {has.map((h, i) => <span key={i} className={`${i === 0 ? 'cp-me ' : ''}${h ? 'cp-c-green' : 'cp-muted'}`} style={{ fontWeight: 700 }}>{h ? '✓' : '—'}</span>)}
              <span className="mono">{pct}%</span>
            </div>
          );
        })}
      </div>
      <p className="cp-foot">{tr("Kolom kuning = customer yang sedang dibuka · hijau tebal = terbaik di baris itu · baris oranye = peluang cross-sell. Pembanding per customer mengikuti cakupan role Anda; rata-rata & persentase segmen dihitung dari seluruh data nasional tanpa nama customer.")}</p>
    </div>
  );
}

// ================================================================ Bandingkan: SE

type SeMetric = { l: string; hint: string; get: (p: SePeriod) => number | null; fmt: (v: number) => string; better: 'hi' | 'lo' | null };
const SE_METRICS: SeMetric[] = [
  { l: 'Lama menangani', hint: 'bulan', get: (p) => p.months, fmt: (v) => `${v} bln`, better: null },
  { l: 'Omzet / bulan', hint: 'order customer selama periode', get: (p) => p.omzetPerBulan, fmt: rpShort, better: 'hi' },
  { l: 'Order / bulan', hint: 'PO masuk', get: (p) => p.orderPerBulan, fmt: (v) => d1(v), better: 'hi' },
  { l: 'Win rate', hint: 'deal diputuskan selama periode', get: (p) => p.winRate, fmt: (v) => pctTxt(v), better: 'hi' },
  { l: 'Penawaran / bulan', hint: 'dibuat SE ini', get: (p) => p.penawaranPerBulan, fmt: (v) => d1(v), better: 'hi' },
  { l: 'Kunjungan / bulan', hint: 'Aktivitas Harian SE ini', get: (p) => p.kunjunganPerBulan, fmt: (v) => d1(v), better: 'hi' },
  { l: 'Kontak / bulan', hint: 'semua jenis kontak', get: (p) => p.kontakPerBulan, fmt: (v) => d1(v), better: 'hi' },
  { l: 'Jeda antar-kontak', hint: 'rata-rata hari', get: (p) => p.jedaKontak, fmt: (v) => `${d1(v)} hr`, better: 'lo' },
  { l: 'Produk baru dibuka', hint: 'pertama kali dibeli', get: (p) => p.produkBaru, fmt: (v) => String(v), better: 'hi' },
];

function BandingSe({ f, today, pick, setPick }: { f: CustomerFacts; today: string; pick: number[] | null; setPick: (p: number[] | null) => void }) {
  const tr = useT();
  const periods = useMemo(() => sePeriods(f, today), [f, today]);
  const check = useMemo(() => handoverChecklist(f, periods), [f, periods]);
  if (periods.length === 0) return <div className="empty-state" style={{ padding: '24px 10px' }}><p>{tr("Belum ada aktivitas atau prospek dalam 24 bulan terakhir.")}</p></div>;
  const sel = (pick ?? periods.map((_, i) => i)).filter((i) => i < periods.length);
  const cur = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const isNew = !!prev && cur.months <= 6;
  const tot = periods.reduce((s, p) => s + p.months, 0) || 1;
  const toggle = (i: number) => {
    const n = sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort((a, b) => a - b);
    if (n.length) setPick(n);
  };
  const grid = { gridTemplateColumns: `200px repeat(${sel.length}, minmax(0, 1fr))` };
  const months24 = (() => {
    const out: { ym: string; v: number; p: number }[] = [];
    periods.forEach((p, pi) => {
      const [y0, m0] = p.startYm.split('-').map(Number);
      for (let k = 0; k < p.months; k++) {
        const d = new Date(Date.UTC(y0, m0 - 1 + k, 1));
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        out.push({ ym, v: f.wonAll.filter((r) => wonDate(r).startsWith(ym)).reduce((s, r) => s + num(r.value), 0), p: pi });
      }
    });
    return out;
  })();
  const bmx = Math.max(1, ...months24.map((m) => m.v));
  const cmp = (l: string, a: number | null, b: number | null, fmt: (v: number) => string, better: 'hi' | 'lo', unit: string) => {
    if (a == null || b == null) return { l, h: a == null ? '–' : fmt(a), s: 'belum bisa dibandingkan', cls: 'cp-soft' };
    const d = a - b;
    const good = better === 'hi' ? d >= 0 : d <= 0;
    const dv = unit ? `${d > 0 ? '+' : ''}${d1(d)}${unit}` : `${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}`;
    return { l, h: `${fmt(a)} vs ${fmt(b)}`, s: `${cur.se} ${good ? 'lebih baik' : 'lebih buruk'} dari ${prev?.se} (${dv})`, cls: good ? 'cp-good' : 'cp-bad' };
  };

  return (
    <div className="cp-col">
      <div>
        <div className="cp-lbl">{tr("SE yang menangani · 24 bulan terakhir")}</div>
        <div className="cp-strip">
          {periods.map((p, i) => (
            <div key={i} style={{ flex: p.months / tot, background: PALETTE[i % PALETTE.length] }} title={`${p.se} · ${ymLabel(p.startYm, true)} – ${p.current ? 'sekarang' : ymLabel(p.endYm, true)}`}>
              {p.se} · {p.months} {tr("bln")}
            </div>
          ))}
        </div>
        <div className="cp-foot" style={{ marginTop: 4 }}>
          {periods.slice(1).map((p, i) => (
            <span key={i} style={{ marginRight: 14 }}><b className="mono">{ymLabel(p.startYm, true)}</b> {tr("· serah terima")} {periods[i].se} → {p.se}</span>
          ))}
          {periods.length === 1 && tr("Ditentukan dari SE dengan aktivitas, prospek & order terbanyak tiap bulan.")}
        </div>
      </div>

      {periods.length === 1 ? (
        <div className="cp-box cp-soft">{tr("Customer ini hanya ditangani")} <b>{cur.se}</b> {tr("selama 24 bulan terakhir, jadi belum ada pembanding antar SE. Perbandingan muncul otomatis begitu SE lain mengambil alih.")}</div>
      ) : (
        <>
          {isNew && (
            <div className="cp-box cp-next cp-grid2" style={{ gap: 16 }}>
              <div>
                <div className="cp-lbl">{tr("SE baru ·")} {cur.months} {tr("bulan menangani")}</div>
                <b>{cur.se} {tr("mengambil alih dari")} {prev.se}</b>
                <div className="cp-foot">{tr("Masa penanganan masih pendek, jadi angka per bulan bisa belum stabil. Pantau checklist serah terima.")}</div>
              </div>
              <div>
                <div className="cp-lbl">{tr("Checklist serah terima ·")} {check.filter((c) => c.ok).length} {tr("dari")} {check.length}</div>
                {check.map((c) => (
                  <div key={c.t} style={{ fontSize: 13, display: 'flex', gap: 8 }}>
                    <b className={c.ok ? 'cp-c-green' : 'cp-c-rust'} style={{ width: 14 }}>{c.ok ? '✓' : '!'}</b>
                    <span><b>{c.t}</b> <span className="cp-muted">· {c.s}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="cp-chiprow">
            <span className="cp-lbl">{tr("Periode yang dibandingkan")}</span>
            {periods.map((p, i) => (
              <button key={i} type="button" className={`cf-chip${sel.includes(i) ? ' on' : ''}`} onClick={() => toggle(i)}>
                <i className="cp-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {p.se} · {ymLabel(p.startYm, true)} – {p.current ? 'sekarang' : ymLabel(p.endYm, true)}
              </button>
            ))}
          </div>
          <div className="cp-kpis cp-kpis4">
            {[
              cmp('Omzet / bulan', cur.omzetPerBulan, prev.omzetPerBulan, rpShort, 'hi', ''),
              cmp('Win rate', cur.winRate, prev.winRate, (v) => pctTxt(v), 'hi', ' poin'),
              cmp('Kunjungan / bulan', cur.kunjunganPerBulan, prev.kunjunganPerBulan, d1, 'hi', ''),
              cmp('Jeda antar-kontak', cur.jedaKontak, prev.jedaKontak, (v) => `${d1(v)} hr`, 'lo', ' hari'),
            ].map((x) => (
              <div key={x.l} className={`cp-box ${x.cls}`}>
                <div className="cp-lbl">{x.l}</div>
                <b>{x.h}</b>
                <div className="cp-foot">{x.s}</div>
              </div>
            ))}
          </div>
          <div className="cp-table">
            <div className="cp-tr cp-th" style={grid}>
              <span>{tr("Metrik per bulan menangani")}</span>
              {sel.map((i) => {
                const p = periods[i];
                return (
                  <span key={i}>
                    <i className="cp-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                    {p.se}{p.current && isNew ? <span className="badge amber" style={{ marginLeft: 6 }}>{tr("SE baru")}</span> : null}
                    <em>{ymLabel(p.startYm, true)} – {p.current ? 'sekarang' : ymLabel(p.endYm, true)}</em>
                  </span>
                );
              })}
            </div>
            {SE_METRICS.map((m) => {
              const vals = sel.map((i) => m.get(periods[i]));
              const known = vals.filter((v): v is number => v != null);
              const mx = Math.max(1e-9, ...known.map((v) => Math.abs(v)));
              const best = m.better && known.length > 1 ? (m.better === 'hi' ? Math.max(...known) : Math.min(...known)) : null;
              return (
                <div key={m.l} className="cp-tr" style={grid}>
                  <span><b>{m.l}</b><em>{m.hint}</em></span>
                  {vals.map((v, k) => (
                    <div key={k}>
                      <span className={`mono ${v != null && v === best ? 'cp-best' : ''}`}>{v == null ? '–' : m.fmt(v)}</span>
                      <Bar w={v == null ? 0 : (Math.abs(v) / mx) * 100} color={PALETTE[sel[k] % PALETTE.length]} h={5} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div>
            <div className="cp-lbl">{tr("Omzet per bulan · warna = SE yang menangani")}</div>
            <div className="cp-chart cp-chart-sm">
              {months24.map((m) => (
                <div key={m.ym} title={`${ymLabel(m.ym, true)} · ${periods[m.p].se} · ${formatRupiah(m.v)}`}>
                  <i style={{ height: `${(m.v / bmx) * 100}%`, background: PALETTE[m.p % PALETTE.length], opacity: sel.includes(m.p) ? 1 : 0.25 }} />
                </div>
              ))}
            </div>
            <div className="cp-chart-x">{months24.map((m, i) => <span key={m.ym}>{i % 3 === 0 ? ymLabel(m.ym) : ''}</span>)}</div>
          </div>
          <p className="cp-foot">{tr("Semua angka dibagi lama penanganan (per bulan) karena tiap SE menangani dengan durasi berbeda. SE per bulan ditentukan dari aktivitas, prospek dibuat dan order terbanyak.")}</p>
        </>
      )}
    </div>
  );
}

// ================================================================ Timeline

function Timeline({ f, activities }: { f: CustomerFacts; activities: import('@/lib/types').SalesActivity[] }) {
  const tr = useT();
  const [sub, setSub] = useState<'timeline' | 'transaksi'>('timeline');
  const acts = activities.filter((a) => customerKey(a.customer || '') === f.key);
  const timeline = buildTimeline(f.records, acts);
  const history = f.records.slice().sort((a, b) => (b.tglPO || b.tglPenawaran || '').localeCompare(a.tglPO || a.tglPenawaran || ''));
  return (
    <>
      <div className="toolbar-row" style={{ marginTop: 0 }}>
        <div className="seg">
          <button type="button" className={`btn btn-sm ${sub === 'timeline' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSub('timeline')}>{tr("Timeline Interaksi (")}{timeline.length})</button>
          <button type="button" className={`btn btn-sm ${sub === 'transaksi' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSub('transaksi')}>{tr("Riwayat Transaksi (")}{history.length})</button>
        </div>
      </div>
      {sub === 'timeline' ? (
        timeline.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 10px' }}><p>{tr("Belum ada interaksi tercatat.")}</p></div>
        ) : (
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table" style={{ minWidth: 960 }}>
              <thead><tr><th>{tr("Tanggal")}</th><th>{tr("Jenis")}</th><th>SE</th><th>{tr("Uraian / Keterangan")}</th><th>PIC</th><th>{tr("Nilai")}</th></tr></thead>
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
            <thead><tr><th>{tr("Uraian")}</th><th>{tr("Cabang")}</th><th>SE</th><th>{tr("Tgl Penawaran")}</th><th>{tr("Tgl PO")}</th><th>{tr("Nilai")}</th><th>{tr("Status")}</th><th>{tr("Klasifikasi")}</th></tr></thead>
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
    </>
  );
}
