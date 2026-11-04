'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { Kpi, rpShort } from '../analisa/ui';
import { api } from '@/lib/api-client';
import { CAMPAIGN_WINDOW_DAYS, type CampaignSummary } from '@/lib/campaign';
import { appendSheet } from '@/lib/exports';
import { classify, formatDateID, getProspectMaterials, num, todayStr } from '@/lib/format';
import type { Customer } from '@/lib/types';
import { canNow } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

type Status = '' | 'aktif' | 'hilang' | 'belum';

interface Cand {
  c: Customer;
  emails: string[];
  last: string; // tanggal PO/DO terakhir
  poValue: number; // nilai PO/DO 24 bulan
  text: string; // uraian material yang pernah di-PO (huruf kecil)
  reg: number | null;
}

const MAX_FILE = 10 * 1024 * 1024;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

function emailsOf(c: Customer): string[] {
  const all = [c.email, ...(c.pics || []).map((p) => p.email)].map((e) => String(e || '').trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return Array.from(new Set(all.map((e) => e.toLowerCase())));
}

async function toBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Kampanye Marketing: pilih sasaran customer dari kriteria (segmen, cabang /
 * regional, grade yang pernah dibeli, status order), kirim email langsung dari
 * server atau simpan sebagai daftar tindak lanjut manual, lalu ukur hasilnya
 * (prospek baru, penawaran, PO) di tab Riwayat & hasil.
 */
export function CampaignModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'campaign');
  const closeModal = useUiStore((s) => s.closeModal);
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);

  const [tab, setTab] = useState<'buat' | 'riwayat'>('buat');
  const [segmen, setSegmen] = useState('');
  const [cabang, setCabang] = useState('');
  const [reg, setReg] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [bulan, setBulan] = useState(6);
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [nama, setNama] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CampaignSummary[] | null>(null);
  const [smtp, setSmtp] = useState(true);
  const [openId, setOpenId] = useState('');

  const loadHistory = useCallback(() => {
    api
      .get<{ campaigns: CampaignSummary[]; smtp: boolean }>('/api/campaigns')
      .then((r) => {
        setHistory(r.campaigns);
        setSmtp(r.smtp);
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Gagal memuat kampanye', 'error'));
  }, [toast]);
  useEffect(() => {
    if (show) loadHistory();
  }, [show, loadHistory]);

  // Ringkasan pembelian per customer (dari prospek PO/DO).
  const cands = useMemo<Cand[]>(() => {
    const since = monthsAgo(24);
    const by = new Map<string, { last: string; v: number; text: string[]; reg: number | null }>();
    prospects.forEach((p) => {
      const k = norm(p.customer);
      const x = by.get(k) || { last: '', v: 0, text: [], reg: null };
      if (x.reg == null && p.reg != null) x.reg = p.reg;
      if (classify(p) === 'Won') {
        const d = String(p.tglPO || p.tglDelivery || p.statusChangedAt || p.createdAt).slice(0, 10);
        if (d > x.last) x.last = d;
        if (d >= since) x.v += num(p.value);
        getProspectMaterials(p).forEach((m) => x.text.push(`${m.uraian || ''} ${(m as { grade?: string }).grade || ''}`.toLowerCase()));
      }
      by.set(k, x);
    });
    return customers.map((c) => {
      const x = by.get(norm(c.name));
      return { c, emails: emailsOf(c), last: x?.last || '', poValue: x?.v || 0, text: (x?.text || []).join(' | '), reg: x?.reg ?? null };
    });
  }, [customers, prospects]);

  const segOpts = useMemo(() => Array.from(new Set(customers.map((c) => c.segmen || '').filter(Boolean))).sort(), [customers]);
  const cabOpts = useMemo(() => Array.from(new Set(customers.map((c) => (c.cabang || '').toUpperCase()).filter(Boolean))).sort(), [customers]);
  const regOpts = useMemo(() => Array.from(new Set(cands.map((x) => x.reg).filter((r): r is number => r != null))).sort(), [cands]);

  const list = useMemo(() => {
    const cut = monthsAgo(bulan);
    const g = grade.trim().toLowerCase();
    const needle = q.trim().toLowerCase();
    return cands
      .filter((x) => {
        if (segmen && (x.c.segmen || '') !== segmen) return false;
        if (cabang && (x.c.cabang || '').toUpperCase() !== cabang) return false;
        if (reg && String(x.reg ?? '') !== reg) return false;
        if (g && !x.text.includes(g)) return false;
        if (status === 'aktif' && !(x.last && x.last >= cut)) return false;
        if (status === 'hilang' && !(x.last && x.last < cut)) return false;
        if (status === 'belum' && x.last) return false;
        if (onlyEmail && !x.emails.length) return false;
        if (needle && !x.c.name.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => b.poValue - a.poValue || b.last.localeCompare(a.last));
  }, [cands, segmen, cabang, reg, grade, status, bulan, onlyEmail, q]);

  const chosen = list.filter((x) => picked[x.c.id]);
  const withEmail = chosen.filter((x) => x.emails.length);
  const allOn = list.length > 0 && list.every((x) => picked[x.c.id]);

  const filterText = [
    segmen && `Segmen ${segmen}`,
    cabang && `Cabang ${cabang}`,
    reg && `Regional ${reg}`,
    grade && `Pernah beli "${grade}"`,
    status === 'aktif' && `Order ≤ ${bulan} bln`,
    status === 'hilang' && `Tidak order > ${bulan} bln`,
    status === 'belum' && 'Belum pernah order',
    onlyEmail && 'Punya email',
  ]
    .filter(Boolean)
    .join(' · ');

  async function submit(channel: 'email' | 'manual') {
    if (!nama.trim()) return toast(tr('Isi nama kampanye'), 'error');
    if (!chosen.length) return toast(tr('Pilih minimal satu customer'), 'error');
    if (channel === 'email' && (!subject.trim() || !message.trim())) return toast(tr('Isi subjek dan pesan email'), 'error');
    if (channel === 'email' && !withEmail.length) return toast(tr('Customer terpilih belum punya email'), 'error');
    const size = files.reduce((s, f) => s + f.size, 0);
    if (size > MAX_FILE) return toast(tr('Lampiran terlalu besar (maks. 10 MB total).'), 'error');
    setBusy(true);
    try {
      const attachments = channel === 'email' ? await Promise.all(files.map(async (f) => ({ filename: f.name, content: await toBase64(f) }))) : [];
      const r = await api.post<{ targets: number; sent: number; failed: string[] }>('/api/campaigns', {
        nama,
        channel,
        subject,
        message,
        attachments,
        filter: { text: filterText, segmen, cabang, reg, grade, status, bulan },
        targets: chosen.map((x) => ({ customerId: x.c.id, emails: x.emails })),
      });
      toast(channel === 'email' ? `${tr('Email kampanye terkirim ke')} ${r.sent} ${tr('dari')} ${r.targets} ${tr('customer')}${r.failed.length ? ` · ${r.failed.length} ${tr('gagal / tanpa email')}` : ''}` : `${tr('Daftar kampanye disimpan')}: ${r.targets} ${tr('customer')}`, 'success');
      setPicked({});
      setNama('');
      setSubject('');
      setMessage('');
      setFiles([]);
      setTab('riwayat');
      loadHistory();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan kampanye', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function exportList() {
    if (!list.length) return toast(tr('Daftar kosong'), 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const src = chosen.length ? chosen : list;
    appendSheet(XLSX, wb, {
      sheetName: 'Sasaran Kampanye',
      header: ['CUSTOMER', 'CABANG', 'SEGMEN', 'PO TERAKHIR', 'NILAI PO 24 BLN', 'EMAIL', 'KONTAK UTAMA', 'TELEPON'],
      rows: src.map((x) => {
        const pic = (x.c.pics || []).find((p) => p.isPrimary) || (x.c.pics || [])[0];
        return [x.c.name, x.c.cabang || '', x.c.segmen || '', x.last ? formatDateID(x.last) : '', Math.round(x.poValue), x.emails.join(', '), pic?.nama || x.c.pic || '', pic?.phone || x.c.phone || ''];
      }),
      colWidths: [32, 8, 16, 12, 16, 34, 20, 16].map((wch) => ({ wch })),
      numFormats: { 4: '#,##0' },
    });
    XLSX.writeFile(wb, `Sasaran_Kampanye_${todayStr()}.xlsx`);
  }

  const openCampaign = history?.find((c) => c.id === openId) || null;

  return (
    <Modal show={show} onClose={closeModal} title={tr('Kampanye')} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>}>
      <div className="ea-tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={tab === 'buat'} className={tab === 'buat' ? 'on' : ''} onClick={() => setTab('buat')}>{tr('Buat kampanye')}</button>
        <button type="button" role="tab" aria-selected={tab === 'riwayat'} className={tab === 'riwayat' ? 'on' : ''} onClick={() => setTab('riwayat')}>{tr('Riwayat & hasil')}{history ? ` (${history.length})` : ''}</button>
      </div>

      {tab === 'buat' && (
        <>
          <div className="cp-filters">
            <label>{tr('Segmen')}<select value={segmen} onChange={(e) => setSegmen(e.target.value)}><option value="">{tr('Semua')}</option>{segOpts.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>{tr('Regional')}<select value={reg} onChange={(e) => setReg(e.target.value)}><option value="">{tr('Semua')}</option>{regOpts.map((r) => <option key={r} value={String(r)}>Regional {r}</option>)}</select></label>
            <label>{tr('Cabang')}<select value={cabang} onChange={(e) => setCabang(e.target.value)}><option value="">{tr('Semua')}</option>{cabOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>{tr('Pernah beli (grade / material)')}<input type="text" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder={tr('cth. creusabro 4800')} /></label>
            <label>
              {tr('Status order')}
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="">{tr('Semua')}</option>
                <option value="aktif">{tr('Masih order')}</option>
                <option value="hilang">{tr('Tidak order lagi (mulai hilang)')}</option>
                <option value="belum">{tr('Belum pernah order')}</option>
              </select>
            </label>
            {(status === 'aktif' || status === 'hilang') && (
              <label>{tr('Dalam / lebih dari')}<select value={bulan} onChange={(e) => setBulan(Number(e.target.value))}>{[3, 6, 9, 12, 18, 24].map((n) => <option key={n} value={n}>{n} {tr('bulan')}</option>)}</select></label>
            )}
            <label className="cp-check"><input type="checkbox" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} /> {tr('Hanya yang punya email')}</label>
            <input type="text" className="cp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Cari nama customer…')} />
          </div>

          <div className="cp-bar">
            <b>{list.length}</b> {tr('customer cocok')} · <b>{chosen.length}</b> {tr('dipilih')} ({withEmail.length} {tr('punya email')})
            {canNow('marketing', 'x') && <button type="button" className="btn btn-outline btn-sm" onClick={() => void exportList()}>{tr('Export daftar')}</button>}
          </div>
          <div className="table-wrap" style={{ borderTop: 'none', maxHeight: 340, overflowY: 'auto' }}>
            <table className="simple-table cp-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" aria-label={tr('Pilih semua')} checked={allOn} onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(list.map((x) => [x.c.id, true])) : {})} /></th>
                  <th>{tr('Customer')}</th><th>{tr('Cabang')}</th><th>{tr('Segmen')}</th><th>{tr('PO terakhir')}</th><th className="r">{tr('PO 24 bln')}</th><th>{tr('Email')}</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={7} className="field-note">{tr('Tidak ada customer yang cocok dengan kriteria.')}</td></tr>}
                {list.slice(0, 500).map((x) => (
                  <tr key={x.c.id}>
                    <td><input type="checkbox" checked={!!picked[x.c.id]} onChange={(e) => setPicked((p) => ({ ...p, [x.c.id]: e.target.checked }))} aria-label={x.c.name} /></td>
                    <td style={{ fontWeight: 600 }}>{x.c.name}</td>
                    <td>{x.c.cabang || '-'}</td>
                    <td>{x.c.segmen || '-'}</td>
                    <td>{x.last ? formatDateID(x.last) : <span className="field-note" style={{ margin: 0 }}>{tr('belum pernah')}</span>}</td>
                    <td className="r mono">{x.poValue ? rpShort(x.poValue) : '-'}</td>
                    <td className="cp-mail">{x.emails.length ? x.emails.join(', ') : <span className="badge amber">{tr('tanpa email')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cp-compose">
            <div className="form-grid">
              <div className="full"><label>{tr('Nama kampanye')} *</label><input type="text" value={nama} onChange={(e) => setNama(e.target.value)} placeholder={tr('cth. Reaktivasi tambang Q4 — Creusabro 4800')} /></div>
              <div className="full"><label>{tr('Subjek email')}</label><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={tr('cth. Stok Creusabro 4800 tersedia — harga khusus November')} /></div>
              <div className="full">
                <label>{tr('Isi email')}</label>
                <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={tr('Tulis pesan. Sapaan "Dengan hormat", logo dan tanda tangan Anda ditambahkan otomatis.')} />
              </div>
              <div className="full">
                <label>{tr('Lampiran (brosur / datasheet, maks. 10 MB)')}</label>
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))} />
              </div>
            </div>
            <div className="cp-actions">
              <span className="field-note" style={{ margin: 0 }}>{tr('Satu email per customer ke alamat yang tercatat di Kelola Customer. Hasil diukur dari prospek customer tsb.')} {CAMPAIGN_WINDOW_DAYS} {tr('hari setelah kampanye.')}</span>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void submit('manual')} title={tr('Simpan daftar untuk ditindaklanjuti lewat telepon / kunjungan — hasilnya tetap diukur')}>{tr('Simpan tanpa email')}</button>
              <button type="button" className="btn btn-primary" disabled={busy || !smtp} onClick={() => void submit('email')} title={smtp ? '' : tr('Server email belum diatur')}>
                {busy ? tr('Mengirim…') : `${tr('Kirim email ke')} ${withEmail.length} ${tr('customer')}`}
              </button>
            </div>
            {!smtp && <div className="field-note">{tr('Server email belum diatur — kampanye bisa disimpan tanpa email (ditindaklanjuti manual) dan tetap diukur hasilnya.')}</div>}
          </div>
        </>
      )}

      {tab === 'riwayat' && (
        <>
          {!history && <div className="field-note">{tr('Memuat…')}</div>}
          {history && history.length === 0 && <div className="field-note">{tr('Belum ada kampanye.')}</div>}
          {history && history.length > 0 && (
            <>
              <div className="kpi-grid">
                <Kpi label={tr('Kampanye')} value={history.length} foot={`${history.reduce((s, c) => s + c.targets, 0)} ${tr('customer disasar')}`} />
                <Kpi label={tr('Customer merespons')} value={history.reduce((s, c) => s + c.result.customers, 0)} foot={tr('ada prospek baru setelah kampanye')} tone="aktif" />
                <Kpi label={tr('PO dari kampanye')} value={history.reduce((s, c) => s + c.result.po, 0)} foot={rpShort(history.reduce((s, c) => s + c.result.nilaiPo, 0))} tone="won" />
              </div>
              <div className="table-wrap" style={{ borderTop: 'none' }}>
                <table className="simple-table">
                  <thead>
                    <tr><th>{tr('Tanggal')}</th><th>{tr('Kampanye')}</th><th>{tr('Saluran')}</th><th className="r">{tr('Sasaran')}</th><th className="r">{tr('Terkirim')}</th><th className="r">{tr('Merespons')}</th><th className="r">{tr('Penawaran')}</th><th className="r">PO</th><th className="r">{tr('Nilai PO')}</th></tr>
                  </thead>
                  <tbody>
                    {history.map((c) => (
                      <tr key={c.id} className="if-row" onClick={() => setOpenId(openId === c.id ? '' : c.id)}>
                        <td>{c.sentAt ? formatDateID(c.sentAt) : '-'}</td>
                        <td><b>{c.nama}</b><div className="field-note" style={{ margin: 0 }}>{c.filterText || '-'}{c.createdBy ? ` · ${c.createdBy}` : ''}</div></td>
                        <td>{c.channel === 'email' ? 'Email' : tr('Manual')}</td>
                        <td className="r mono">{c.targets}</td>
                        <td className="r mono">{c.channel === 'email' ? c.sentCount : '-'}</td>
                        <td className="r mono">{c.result.customers}</td>
                        <td className="r mono">{c.result.penawaran}</td>
                        <td className="r mono">{c.result.po}</td>
                        <td className="r mono">{c.result.nilaiPo ? rpShort(c.result.nilaiPo) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {openCampaign && (
                <div className="cp-detail">
                  <div className="ea-sec-h"><b>{openCampaign.nama}</b><span className="field-note" style={{ margin: 0 }}>{tr('Subjek')}: {openCampaign.subject}</span></div>
                  {openCampaign.failed.length > 0 && <div className="field-note">{tr('Tidak terkirim')}: {openCampaign.failed.join(', ')}</div>}
                  <table className="simple-table">
                    <thead><tr><th>{tr('Customer')}</th><th>{tr('Cabang')}</th><th>{tr('Hasil')}</th><th className="r">{tr('Prospek')}</th><th className="r">{tr('Penawaran')}</th><th className="r">PO</th><th className="r">{tr('Nilai PO')}</th></tr></thead>
                    <tbody>
                      {openCampaign.result.rows.map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td>{r.cabang || '-'}</td>
                          <td>{r.best === 'po' ? <span className="badge green">PO</span> : r.best === 'penawaran' ? <span className="badge violet">{tr('Penawaran')}</span> : r.best === 'prospek' ? <span className="badge steel">{tr('Prospek')}</span> : <span className="field-note" style={{ margin: 0 }}>{tr('belum ada')}</span>}</td>
                          <td className="r mono">{r.prospek}</td>
                          <td className="r mono">{r.penawaran}</td>
                          <td className="r mono">{r.po}</td>
                          <td className="r mono">{r.nilaiPo ? rpShort(r.nilaiPo) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
