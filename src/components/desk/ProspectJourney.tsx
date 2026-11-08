'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatDateID, formatDateTimeID, formatRupiah, getProspectMaterials, num } from '@/lib/format';
import { EVENT_META, type EventType, type ItemEventLine } from '@/lib/item-flow';
import { MARGIN_LEVEL_LABEL, asLevel } from '@/lib/margin-tier';
import type { Fupa, Prospect, Rfq } from '@/lib/types';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';
import { ACTIVITY_TYPES, ROLE_LABELS } from '@/lib/constants';
import { HASIL_LABEL, KANAL_LABEL, type Hasil, type Kanal } from '@/lib/activity-contact';
import { WORKFLOW_META, fupaAsWorkflowDoc, rfqAsWorkflowDoc, workflowStage } from '@/lib/purchasing-workflow';

interface JEvent { id: string; type: EventType; tgl: string | null; docNo: string | null; title: string; items: ItemEventLine[]; actorName: string; createdAt: string }
interface JStatus { at: string; by: string; action: string; summary: string }
interface JApproval { id: string; nomor: string | null; status: string; level: string; requestedByName: string; decidedByName: string | null; decidedAt: string | null; createdAt: string; lowestMargin: number | null; basis?: string; maxDiscount?: number | null }
interface JMarginLine { idx: number; margin: number | null; below: boolean; discount?: number | null; hpp?: number | null; price?: number | null; ref?: number | null; uom?: string; rfqNo: string; kg: number; nilai: number }
interface JMargin { level: 'margin' | 'full'; minMargin: number; discSe?: number; lines: JMarginLine[]; total: { margin: number | null; checked: number; hpp?: number | null; nilai?: number | null; laba?: number | null } }
interface JMsg { id: string; entity: 'prospect' | 'rfq' | 'fupa'; entityId: string; thread: string; author: string; role: string | null; text: string; createdAt: string }
interface JAct { id: string; tanggal: string; tipe: string; kanal: string | null; hasil: string | null; keterangan: string | null; langkah: string | null; status: string; sumber: string | null; se: string; createdBy: string | null; createdAt: string }
interface Journey { events: JEvent[]; status: JStatus[]; approvals: JApproval[]; margin: JMargin | null; discussions: JMsg[]; activities: JAct[] }

const pct = (n: number | null | undefined) => (n == null ? '–' : `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
const rp = (n: number | null | undefined) => (n == null ? '–' : `Rp ${Math.round(n).toLocaleString('id-ID')}`);
const realNo = (v: string | null | undefined) => {
  const s = String(v || '').trim();
  return s && s !== '0' && s !== '-' ? s : '';
};
const sumQty = (items: ItemEventLine[]) => items.reduce((s, it) => s + num(it.qty), 0);
const actLabel = (a: { tipe: string; kanal: string | null; sumber: string | null }) => {
  const base = a.sumber === 'followup' ? 'Follow-up' : ACTIVITY_TYPES.find((t) => t.key === a.tipe)?.short || a.tipe;
  return `${base}${a.kanal ? ` · ${KANAL_LABEL[a.kanal as Kanal] || a.kanal}` : ''}`;
};

/**
 * Bagian panel prospek: ringkasan nomor dokumen (penawaran → PO → DO →
 * faktur), margin sesuai role (BM: persen saja; RM/GM/VP/GM Operation/Admin:
 * HPP, harga, margin, laba kotor), dan perjalanan lengkap dari penawaran
 * sampai faktur dengan tanggal & pelaku.
 */
export function ProspectJourney({ p, rfqs, fupas }: { p: Prospect; rfqs: Rfq[]; fupas: Fupa[] }) {
  const tr = useT();
  const [j, setJ] = useState<Journey | null>(null);
  const [all, setAll] = useState(false);
  const [allAct, setAllAct] = useState(false);
  const [allMsg, setAllMsg] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<Journey>(`/api/prospects/${p.id}/journey`)
      .then((r) => alive && setJ(r))
      .catch(() => alive && setJ({ events: [], status: [], approvals: [], margin: null, discussions: [], activities: [] }));
    return () => {
      alive = false;
    };
  }, [p.id, p.updatedAt]);

  const mats = useMemo(() => getProspectMaterials(p), [p]);
  const myRfqs = rfqs.filter((r) => r.prospectId === p.id && !r.cancelledAt);
  const myFupas = fupas.filter((f) => f.prospectId === p.id);

  const docs = useMemo(() => {
    const ev = j?.events || [];
    const last = (types: string[]) => [...ev].reverse().find((e) => types.includes(e.type) && realNo(e.docNo));
    const tawar = last(['revisi', 'tawar']);
    const batal = new Set(ev.filter((e) => e.type === 'kirim-batal').map((e) => e.docNo));
    const dos = new Map<string, { tgl: string | null; qty: number }>();
    ev.filter((e) => e.type === 'kirim').forEach((e) => {
      const no = realNo(e.docNo) || tr('(tanpa No. DO)');
      if (batal.has(e.docNo)) return;
      const cur = dos.get(no);
      dos.set(no, { tgl: cur?.tgl || e.tgl, qty: (cur?.qty || 0) + sumQty(e.items) });
    });
    return { tawar, dos: [...dos.entries()] };
  }, [j, tr]);

  const timeline = useMemo(() => {
    type T = { at: string; title: string; sub?: string; who?: string; tone: string };
    const out: T[] = [];
    const push = (at: string | null | undefined, t: Omit<T, 'at'>) => at && out.push({ at: String(at), ...t });
    push(p.createdAt, { title: tr('Prospek dibuat'), who: j?.status.find((s) => s.action === 'create')?.by, tone: 'slate' });
    if (p.leadAt) push(p.leadAt, { title: tr('Lead dari Marketing'), who: p.leadBy || '', tone: 'violet' });
    myRfqs.forEach((r) => {
      push(r.sentToPurchasingAt, { title: `RFQ ${r.noRfq || ''} ${tr('dikirim ke Purchasing')}`, who: r.requestedBy || '', tone: 'steel' });
      push(r.openedByPurchasingAt, { title: `RFQ ${r.noRfq || ''} ${tr('diterima Purchasing')}`, who: r.openedByName || '', tone: 'steel' });
      push(r.jawabanRfqAt, { title: `RFQ ${r.noRfq || ''} ${tr('dijawab')}`, who: r.jawabanByName || '', tone: 'green' });
    });
    (j?.events || []).forEach((e) => {
      const meta = EVENT_META[e.type] || { label: e.type, color: 'slate' };
      const q = sumQty(e.items);
      const no = realNo(e.docNo);
      const label =
        e.type === 'kirim' ? `${tr('Kirim / DO')}${no ? ` ${no}` : ''}` : e.type === 'po' ? `PO${no ? ` ${no}` : ''}` : e.type === 'tawar' || e.type === 'revisi' ? `${tr(meta.label)}${no ? ` ${no}` : ''}` : tr(meta.label);
      push(e.tgl || e.createdAt, { title: label, sub: `${e.items.length} ${tr('item')}${q ? ` · ${q.toLocaleString('id-ID')} pcs` : ''}${e.title && !/^(Penawaran|PO|Kirim)/i.test(e.title) ? ` · ${e.title}` : ''}`, who: e.actorName, tone: meta.color });
    });
    if (!j?.events.some((e) => e.type === 'tawar') && p.tglPenawaran) push(p.tglPenawaran, { title: `${tr('Penawaran')} ${p.penawaranTerkirim ? tr('terkirim') : tr('(pending)')}`, tone: 'steel' });
    if (!j?.events.some((e) => e.type === 'po') && p.tglPO) push(p.tglPO, { title: `PO ${realNo(p.noPo)}`, tone: 'amber' });
    (j?.approvals || []).forEach((a) => {
      push(a.createdAt, { title: `${a.basis === 'diskon' ? tr('Pengajuan diskon') : tr('Pengajuan margin')} · ${tr('perlu')} ${MARGIN_LEVEL_LABEL[asLevel(a.level)]}`, sub: a.basis === 'diskon' ? (a.maxDiscount != null ? `${tr('diskon terbesar')} ${pct(a.maxDiscount)}` : undefined) : a.lowestMargin != null ? `${tr('margin terendah')} ${pct(a.lowestMargin)}` : undefined, who: a.requestedByName, tone: 'violet' });
      if (a.decidedAt) push(a.decidedAt, { title: a.status === 'disetujui' ? (a.basis === 'diskon' ? tr('Diskon disetujui') : tr('Margin disetujui')) : a.basis === 'diskon' ? tr('Diskon ditolak') : tr('Margin ditolak'), who: a.decidedByName || '', tone: a.status === 'disetujui' ? 'green' : 'rust' });
    });
    myFupas.forEach((f) => {
      push(f.sentToPurchasingAt || (f.status !== 'Draft' ? f.updatedAt : null), { title: `FUP A ${f.noFupa || ''} ${tr('dikirim ke Purchasing')}`, who: f.requestedBy || '', tone: 'amber' });
      push(f.jawabanFupaAt, { title: `FUP A ${f.noFupa || ''} ${tr('dijawab')}`, who: f.jawabanByName || '', tone: 'green' });
    });
    (j?.activities || []).filter((a) => a.status !== 'rencana').forEach((a) => {
      push(a.tanggal, { title: `${actLabel(a)}`, sub: [a.hasil ? HASIL_LABEL[a.hasil as Hasil] || a.hasil : '', a.keterangan || ''].filter(Boolean).join(' · ').slice(0, 90) || undefined, who: a.createdBy || a.se, tone: 'steel' });
    });
    if (p.terfaktur || realNo(p.noFaktur)) push(p.tglFaktur || p.updatedAt, { title: `${tr('Faktur')} ${realNo(p.noFaktur)}`, tone: 'green' });
    (j?.status || []).filter((s) => s.action === 'status_change').forEach((s) => {
      const m = s.summary.match(/ke "([^"]+)"/);
      push(s.at, { title: `${tr('Status')} → ${m ? tr(m[1]) : '-'}`, who: s.by, tone: 'slate' });
    });
    const key = (t: T) => (t.at.length === 10 ? `${t.at}T23:59:59` : t.at);
    return out.sort((a, b) => key(a).localeCompare(key(b)));
  }, [p, j, myRfqs, myFupas, tr]);

  const m = j?.margin;
  const acts = j?.activities || [];
  const msgs = j?.discussions || [];
  const set = useUiStore.setState;
  const openThread = (x: JMsg) => {
    if (x.entity === 'rfq') set({ rfqCtx: { prospectId: p.id, rfqId: x.entityId } });
    else if (x.entity === 'fupa') set({ fupaCtx: { fupaId: x.entityId, sourceRfqId: null, prospectId: p.id } });
    else set({ editProspectId: p.id });
    useUiStore.getState().openModal(x.entity === 'rfq' ? 'rfq' : x.entity === 'fupa' ? 'fupa' : 'prospectForm');
  };
  const purchDocs = [
    ...myRfqs.map((r) => ({ jenis: 'RFQ' as const, id: r.id, no: r.noRfq, draft: r.status === 'Draft', stage: workflowStage(rfqAsWorkflowDoc(r)), sentAt: r.sentToPurchasingAt, openedBy: r.openedByName, answeredBy: r.jawabanByName, answeredAt: r.jawabanRfqAt, items: r.items || [], jawaban: r.purchJawaban })),
    ...myFupas.map((f) => ({ jenis: 'FUP A' as const, id: f.id, no: f.noFupa, draft: f.status === 'Draft', stage: workflowStage(fupaAsWorkflowDoc(f)), sentAt: f.sentToPurchasingAt, openedBy: f.openedByName, answeredBy: f.jawabanByName, answeredAt: f.jawabanFupaAt, items: f.items || [], jawaban: f.purchJawaban })),
  ];
  const shown = all ? timeline : timeline.slice(-8);

  return (
    <>
      <section className="dk-sec">
        <h4>{tr('Dokumen')}</h4>
        <div className="dk-kv"><span>{tr('Penawaran')}</span><b>{docs.tawar ? `${docs.tawar.docNo} · ${formatDateID(docs.tawar.tgl)}` : p.tglPenawaran ? formatDateID(p.tglPenawaran) : '-'}</b></div>
        <div className="dk-kv"><span>{tr('PO customer')}</span><b>{realNo(p.noPo) ? `${p.noPo}${p.tglPO ? ` · ${formatDateID(p.tglPO)}` : ''}` : p.tglPO ? `${tr('(no. belum diisi)')} · ${formatDateID(p.tglPO)}` : '-'}</b></div>
        <div className="dk-kv">
          <span>{tr('DO / kirim')}</span>
          <b style={{ textAlign: 'right' }}>
            {docs.dos.length ? docs.dos.map(([no, d]) => <div key={no}>{no}{d.tgl ? ` · ${formatDateID(d.tgl)}` : ''}{d.qty ? ` · ${d.qty.toLocaleString('id-ID')} pcs` : ''}</div>) : '-'}
          </b>
        </div>
        <div className="dk-kv">
          <span>{tr('Faktur')}</span>
          <b>{realNo(p.noFaktur) ? `${p.noFaktur}${p.tglFaktur ? ` · ${formatDateID(p.tglFaktur)}` : ''}` : p.terfaktur ? tr('Terfaktur (no. belum diisi)') : num(p.status) === 5 ? <span className="badge amber">{tr('Belum terfaktur')}</span> : '-'}</b>
        </div>
      </section>

      {m && (
        <section className="dk-sec">
          <h4>{m.level === 'full' ? tr('HPP & margin') : tr('Margin')} <small className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>· {tr('dari jawaban RFQ')} · {tr('target')} {m.minMargin}% · {tr('diskon Sales maks.')} {m.discSe ?? 5}%</small></h4>
          {m.total.checked === 0 ? (
            <div className="muted">{tr('Belum ada HPP dari jawaban RFQ yang cocok dengan item prospek ini.')}</div>
          ) : (
            <>
              <div className="dk-mg-sum">
                <div><small>{tr('Margin')}</small><b className={m.total.margin != null && m.total.margin < m.minMargin ? 'dk-bad' : ''}>{pct(m.total.margin)}</b></div>
                {m.level === 'full' && (
                  <>
                    <div><small>{tr('Total HPP')}</small><b>{rp(m.total.hpp)}</b></div>
                    <div><small>{tr('Nilai jual')}</small><b>{rp(m.total.nilai)}</b></div>
                    <div><small>{tr('Laba kotor')}</small><b className={(m.total.laba || 0) < 0 ? 'dk-bad' : ''}>{rp(m.total.laba)}</b></div>
                  </>
                )}
              </div>
              <table className="dk-items">
                <tbody>
                  {m.lines.map((l) => (
                    <tr key={l.idx}>
                      <td>{mats[l.idx]?.uraian || `Item ${l.idx + 1}`}{l.rfqNo && <small className="muted" style={{ display: 'block' }}>{l.rfqNo}</small>}</td>
                      {m.level === 'full' && (
                        <td className="r mono" title={tr('HPP / harga jual per satuan')}>
                          {l.hpp ? rp(l.hpp) : '–'}
                          <small className="muted" style={{ display: 'block' }}>{l.price ? `${tr('jual')} ${rp(l.price)}` : ''}{l.uom ? `/${l.uom.toLowerCase()}` : ''}</small>
                        </td>
                      )}
                      <td className={`r mono${l.margin != null && l.margin < m.minMargin ? ' dk-bad' : ''}`}>
                        {pct(l.margin)}
                        {l.discount != null && l.discount > 0 && <small className={l.below ? 'dk-bad' : 'muted'} style={{ display: 'block' }}>{tr('diskon')} {pct(l.discount)}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.total.checked < m.lines.length && <small className="muted">{m.lines.length - m.total.checked} {tr('item belum punya HPP pembanding')}</small>}
            </>
          )}
        </section>
      )}

      {acts.length > 0 && (
        <section className="dk-sec">
          <h4>{tr('Riwayat follow-up & aktivitas')} · {acts.length}</h4>
          {(allAct ? acts : acts.slice(0, 4)).map((a) => (
            <div key={a.id} className={`dk-act${a.status === 'rencana' ? ' plan' : ''}`}>
              <div className="dk-act-h">
                <b>{actLabel(a)}</b>
                {a.status === 'rencana' && <span className="badge amber">{tr('rencana')}</span>}
                {a.hasil && <span className={`badge ${a.hasil === 'tersambung' ? 'green' : 'slate'}`}>{tr(HASIL_LABEL[a.hasil as Hasil] || a.hasil)}</span>}
                <span className="muted">{formatDateID(a.tanggal)} · {a.createdBy || a.se}</span>
              </div>
              {a.keterangan && <div className="dk-act-t">{a.keterangan}</div>}
              {a.langkah && <div className="dk-act-t muted">→ {a.langkah}</div>}
            </div>
          ))}
          {acts.length > 4 && <button type="button" className="link-btn" onClick={() => setAllAct(!allAct)}>{allAct ? tr('Tampilkan ringkas') : `${tr('Tampilkan semua')} (${acts.length})`}</button>}
        </section>
      )}

      {purchDocs.length > 0 && (
        <section className="dk-sec">
          <h4>{tr('Informasi RFQ & FUP A')} · {purchDocs.length}</h4>
          {purchDocs.map((d) => {
            const priced = d.items.filter((it) => num(it.hargaPurchasing) > 0 || it.noQuote).length;
            return (
              <div key={d.id} className="dk-rfq">
                <button
                  type="button"
                  className="dk-doc"
                  onClick={() => {
                    if (d.jenis === 'RFQ') set({ rfqCtx: { prospectId: p.id, rfqId: d.id } });
                    else set({ fupaCtx: { fupaId: d.id, sourceRfqId: null, prospectId: p.id } });
                    useUiStore.getState().openModal(d.jenis === 'RFQ' ? 'rfq' : 'fupa');
                  }}
                >
                  <span><b>{d.jenis} {d.no || tr('(draft)')}</b></span>
                  <span className={`badge ${d.draft ? 'slate' : WORKFLOW_META[d.stage].color}`}>{d.draft ? tr('Draft — belum dikirim') : tr(WORKFLOW_META[d.stage].label)}</span>
                </button>
                {!d.draft && (
                  <div className="dk-rfq-m">
                    {d.sentAt && <span>{tr('Dikirim')} {formatDateID(d.sentAt)}</span>}
                    {d.openedBy && <span>{tr('Dibuka')} {d.openedBy}</span>}
                    {d.answeredBy && <span>{tr('Dijawab')} {d.answeredBy}{d.answeredAt ? ` · ${formatDateID(d.answeredAt)}` : ''}</span>}
                    {d.items.length > 0 && <span>{priced}/{d.items.length} {tr('item terjawab')}</span>}
                  </div>
                )}
                {d.items.some((it) => num(it.hargaPurchasing) > 0 || it.noQuote) && (
                  <table className="dk-items">
                    <tbody>
                      {d.items.map((it, k) => (
                        <tr key={k}>
                          <td>{[it.grade, it.material].filter(Boolean).join(' · ') || `Item ${k + 1}`}{(it.coo || it.deliveryTime) && <small className="muted" style={{ display: 'block' }}>{[it.coo, it.deliveryTime].filter(Boolean).join(' · ')}</small>}</td>
                          <td className={`r mono${it.noQuote ? ' dk-bad' : ''}`}>{it.noQuote ? 'No Quote' : num(it.hargaPurchasing) > 0 ? `${it.currency && it.currency !== 'IDR' ? `${it.currency} ` : 'Rp '}${Math.round(num(it.hargaPurchasing)).toLocaleString('id-ID')}${it.uom ? `/${String(it.uom).toLowerCase()}` : ''}` : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {d.jawaban && <p className="dk-note" style={{ margin: '4px 0 0' }}>{d.jawaban}</p>}
              </div>
            );
          })}
        </section>
      )}

      {msgs.length > 0 && (
        <section className="dk-sec">
          <h4>{tr('Diskusi')} · {msgs.length}</h4>
          {(allMsg ? msgs : msgs.slice(0, 4)).map((x) => (
            <button key={x.id} type="button" className="dk-msg" onClick={() => openThread(x)} title={tr('Buka diskusi')}>
              <div className="dk-msg-h"><b>{x.author}</b>{x.role ? <span className="muted"> · {ROLE_LABELS[x.role] || x.role}</span> : null}<span className="muted dk-msg-at">{formatDateTimeID(x.createdAt)}</span></div>
              <div className="dk-msg-t">{x.text}</div>
              <small className="muted">{x.thread}</small>
            </button>
          ))}
          {msgs.length > 4 && <button type="button" className="link-btn" onClick={() => setAllMsg(!allMsg)}>{allMsg ? tr('Tampilkan ringkas') : `${tr('Tampilkan semua')} (${msgs.length})`}</button>}
        </section>
      )}

      <section className="dk-sec">
        <h4>{tr('Perjalanan')} · {timeline.length}</h4>
        {!j && <div className="muted">{tr('Memuat…')}</div>}
        <ol className="dk-tl">
          {shown.map((t, i) => (
            <li key={i} className={t.tone}>
              <div className="dk-tl-t">{t.title}</div>
              <div className="dk-tl-s">
                {t.at.length === 10 ? formatDateID(t.at) : formatDateTimeID(t.at)}
                {t.who ? ` · ${t.who}` : ''}
                {t.sub ? ` · ${t.sub}` : ''}
              </div>
            </li>
          ))}
        </ol>
        {timeline.length > 8 && (
          <button type="button" className="link-btn" onClick={() => setAll(!all)}>
            {all ? tr('Tampilkan ringkas') : `${tr('Tampilkan semua')} (${timeline.length})`}
          </button>
        )}
      </section>
    </>
  );
}
