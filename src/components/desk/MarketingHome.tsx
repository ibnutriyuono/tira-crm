'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { needsSegment } from '@/lib/customer-segments';
import { buildCustomerAnalysis } from '@/lib/exec-more';
import { classify, formatDateID, num } from '@/lib/format';
import { LEAD_STAGE_META, LEAD_STALE_DAYS, isLead, leadSourceLabel, leadStage } from '@/lib/leads';
import { QCD_FAKTOR_LABEL } from '@/lib/qcd';
import { lostDateOf } from '@/lib/lose-date';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';
import { rpShort } from '../analisa/ui';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00`).getTime()) / 86400000);
let segSeq = 0;

function Tile({ label, value, foot, tone = '', onClick }: { label: string; value: ReactNode; foot?: ReactNode; tone?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`dk-tile ${tone}`} onClick={onClick}>
      <span className="l">{label}</span>
      <b className="v mono">{value}</b>
      {foot && <small>{foot}</small>}
    </Tag>
  );
}

/**
 * Beranda Product & Marketing: lead yang dimasukkan & perkembangannya,
 * customer yang perlu dilengkapi segmennya, customer mulai hilang (bahan
 * kampanye reaktivasi), dan alasan kalah / kompetitor 90 hari terakhir.
 * Tanpa HPP / margin — data yang dipakai sama dengan yang terlihat Sales.
 */
export function MarketingHome({ onPage }: { onPage: (p: 'pipeline') => void }) {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const prospects = useDataStore((s) => s.prospects);
  const staleDays = useDataStore((s) => s.opsRules.leadTugasHari) || LEAD_STALE_DAYS;
  const customers = useDataStore((s) => s.customers);
  const groups = useDataStore((s) => s.customerGroups);
  const [today] = useState(() => ymd(new Date()));
  const [mine, setMine] = useState(true);
  const ym = today.slice(0, 7);
  const open = useUiStore.getState().openModal;
  const openPanel = (id: string) => {
    onPage('pipeline');
    useUiStore.setState({ deskPanelId: id });
  };
  const newLead = (prefill?: { customer: string; cabang: string; source: string }) => {
    useUiStore.setState({ leadPrefill: prefill || null });
    open('leadForm');
  };

  const leads = useMemo(() => prospects.filter((p) => isLead(p)).sort((a, b) => String(b.leadAt || b.createdAt).localeCompare(String(a.leadAt || a.createdAt))), [prospects]);
  const shown = mine ? leads.filter((p) => p.leadById === me?.id) : leads;
  const staleOf = (p: Prospect) => leadStage(p) === 'baru' && daysBetween(String(p.leadAt || p.createdAt), today) > staleDays;
  const thisMonth = leads.filter((p) => String(p.leadAt || p.createdAt).slice(0, 7) === ym);
  const recent = leads.filter((p) => daysBetween(String(p.leadAt || p.createdAt), today) <= 90);
  const reached = recent.filter((p) => (num(p.status) >= 2 && num(p.status) <= 5) || (num(p.status) === 6 && p.penawaranTerkirim));
  const won = recent.filter((p) => num(p.status) >= 4 && num(p.status) <= 5);
  const stale = leads.filter(staleOf);
  const wonValue = won.reduce((s, p) => s + num(p.value), 0);

  const segTodo = customers.filter((c) => needsSegment(c));
  const lapsed = useMemo(() => buildCustomerAnalysis({ prospects, groups, range: { months: [ym], today } }).lapsed.slice(0, 8), [prospects, groups, ym, today]);

  // Alasan kalah & kompetitor, 90 hari terakhir (nasional).
  const lost = useMemo(() => prospects.filter((p) => classify(p) === 'Lost' && daysBetween(lostDateOf(p) || p.updatedAt, today) <= 90), [prospects, today]);
  const faktor = useMemo(() => {
    const m = new Map<string, { n: number; v: number }>();
    lost.forEach((p) => {
      const k = p.qcdFaktor || '';
      if (!k) return;
      const x = m.get(k) || { n: 0, v: 0 };
      x.n++;
      x.v += num(p.value);
      m.set(k, x);
    });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  }, [lost]);
  const kompetitor = useMemo(() => {
    const m = new Map<string, number>();
    lost.forEach((p) => {
      const k = (p.qcdKompetitor || '').trim();
      if (k) m.set(k.toUpperCase(), (m.get(k.toUpperCase()) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [lost]);
  const lostNoReason = lost.filter((p) => !p.qcdFaktor).length;

  const hour = new Date().getHours();
  const greet = hour < 11 ? tr('Selamat pagi') : hour < 15 ? tr('Selamat siang') : hour < 18 ? tr('Selamat sore') : tr('Selamat malam');

  return (
    <div className="dk-home">
      <div className="dk-hello">
        <div>
          <small>{tr('Product & Marketing')} · {tr('Nasional')}</small>
          <h2>{greet}, {me?.name?.split(' ')[0]}</h2>
          <p>
            {stale.length > 0 ? (
              <>
                <b className="dk-bad">{stale.length} {tr('lead')}</b> {tr('belum ditunjuk Sales lebih dari')} {staleDays} {tr('hari')}.{' '}
              </>
            ) : null}
            {segTodo.length > 0 && (
              <>
                <b>{segTodo.length}</b> {tr('customer belum jelas segmennya')}.
              </>
            )}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => newLead()}>
          + {tr('Tambah Lead')}
        </button>
      </div>

      <div className="dk-tiles">
        <Tile label={tr('Lead bulan ini')} value={thisMonth.length} foot={`${thisMonth.filter((p) => p.leadById === me?.id).length} ${tr('dari Anda')} · ${leads.length} ${tr('total')}`} />
        <Tile
          onClick={() => open('leadResults')}
          label={tr('Konversi lead (90 hari)')}
          value={recent.length ? `${Math.round((reached.length / recent.length) * 100)}%` : '–'}
          foot={`${reached.length}/${recent.length} ${tr('sampai penawaran')} · ${won.length} PO/DO ${rpShort(wonValue)}`}
        />
        <Tile label={tr('Menunggu BM')} value={stale.length} tone={stale.length ? 'bad' : ''} foot={`${tr('belum ada Sales')} > ${staleDays} ${tr('hari')}`} onClick={() => setMine(false)} />
        <Tile
          label={tr('Segmen perlu dilengkapi')}
          value={segTodo.length}
          tone={segTodo.length ? 'warn' : ''}
          foot={`${customers.length ? Math.round(((customers.length - segTodo.length) / customers.length) * 100) : 0}% ${tr('customer sudah bersegmen')}`}
          onClick={() => {
            useUiStore.setState({ customersSegFocus: `m${++segSeq}` });
            open('customers');
          }}
        />
      </div>

      <div className="dk-cols">
        <section className="dk-card">
          <div className="dk-card-h">
            <b>{mine ? tr('Lead saya') : tr('Semua lead')}</b>
            <span className="seg-switch">
              <button type="button" className={`btn btn-sm ${mine ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMine(true)}>{tr('Saya')}</button>
              <button type="button" className={`btn btn-sm ${!mine ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMine(false)}>{tr('Semua')}</button>
            </span>
          </div>
          {shown.length === 0 && <div className="dk-empty">{tr('Belum ada lead. Masukkan permintaan dari Indotrading, website, pameran, atau telepon ke kantor lewat Tambah Lead.')}</div>}
          <ul className="dk-todo">
            {shown.slice(0, 30).map((p) => {
              const st = leadStage(p);
              const late = staleOf(p);
              const age = daysBetween(String(p.leadAt || p.createdAt), today);
              return (
                <li key={p.id} className={late ? 'late' : ''}>
                  <span className={`dk-kind ${LEAD_STAGE_META[st].badge}`}>{tr(LEAD_STAGE_META[st].label)}</span>
                  <div className="dk-todo-t">
                    <b>{p.customer}</b>
                    <small>
                      {p.cabang || '-'} · {p.se ? `SE ${p.se}` : tr('belum ada Sales')} · {leadSourceLabel(p.leadSource)}
                      {!mine && p.leadBy ? ` · ${p.leadBy}` : ''}
                      {p.uraian ? ` · ${p.uraian}` : ''}
                    </small>
                  </div>
                  <span className={`dk-when${late ? ' dk-bad' : ''}`}>{age === 0 ? tr('hari ini') : `${age} ${tr('hari')}`}</span>
                  <div className="dk-todo-a">
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => openPanel(p.id)}>{tr('Lihat')}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="dk-side">
          {lapsed.length > 0 && (
            <section className="dk-card">
              <div className="dk-card-h"><b>{tr('Customer mulai hilang')}</b><button type="button" className="dk-link" onClick={() => open('campaign')}>{tr('Kampanye')} →</button></div>
              {lapsed.map((c) => (
                <div key={c.name} className="dk-deal mk-lapsed">
                  <button type="button" className="mk-lapsed-n" onClick={() => { useUiStore.setState({ profileCustomer: c.name, profileReturnTo: null }); open('customerProfile'); }}>
                    <b>{c.name}</b>
                    <small>{c.cabang} · {tr('order terakhir')} {formatDateID(c.last)} ({c.days} {tr('hari')}) · {rpShort(c.hist)}</small>
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" title={tr('Masukkan lead reaktivasi ke cabangnya')} onClick={() => newLead({ customer: c.name, cabang: c.cabang, source: 'kampanye' })}>
                    {tr('Lead')}
                  </button>
                </div>
              ))}
            </section>
          )}

          <section className="dk-card">
            <div className="dk-card-h"><b>{tr('Kenapa kalah (90 hari)')}</b><button type="button" className="dk-link" onClick={() => open('qcdRecap')}>{tr('Hasil QCD')} →</button></div>
            {lost.length === 0 && <div className="dk-empty">{tr('Tidak ada prospek kalah 90 hari terakhir.')}</div>}
            {faktor.map(([k, x]) => (
              <div key={k} className="mk-row">
                <span>{QCD_FAKTOR_LABEL[k] || k}</span>
                <span className="mk-bar"><i style={{ width: `${Math.round((x.n / Math.max(1, faktor[0][1].n)) * 100)}%` }} /></span>
                <b className="mono">{x.n}</b>
              </div>
            ))}
            {lostNoReason > 0 && <small className="field-note" style={{ margin: '6px 0 0' }}>{lostNoReason} {tr('dari')} {lost.length} {tr('prospek kalah belum diisi faktor QCD')}</small>}
            {kompetitor.length > 0 && (
              <>
                <div className="dk-card-h" style={{ marginTop: 10 }}><b>{tr('Kompetitor pemenang')}</b><button type="button" className="dk-link" onClick={() => open('competitorLog')}>{tr('Log')} →</button></div>
                {kompetitor.map(([k, n]) => (
                  <div key={k} className="mk-row">
                    <span>{k}</span>
                    <span className="mk-bar"><i style={{ width: `${Math.round((n / Math.max(1, kompetitor[0][1])) * 100)}%` }} /></span>
                    <b className="mono">{n}</b>
                  </div>
                ))}
              </>
            )}
          </section>

          <section className="dk-card">
            <div className="dk-card-h"><b>{tr('Analisa')}</b></div>
            <div className="mk-links">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => open('leadResults')}>{tr('Hasil Lead')} — {tr('sumber & respons cabang')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => open('campaign')}>{tr('Kampanye')} — {tr('email & hasilnya')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => open('productInsight')}>{tr('Insight Produk')} — {tr('grade, kalah & stok')}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => open('gmAnalysis')}>{tr('Analisa Eksekutif')} — {tr('Segmen & harga per grade')}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => open('customerIntel')}>{tr('Customer Intelligence')}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => open('marketing')}>{tr('Marketing')}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
