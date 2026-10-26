'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Rfq, RfqItem } from '@/lib/types';
import {
  VR_CHANNEL_LABEL,
  VR_STATUS_META,
  fmtDate,
  vrDefaultMessage,
  vrLines,
  type VendorRequest,
  type VrItemPrice,
} from '@/lib/vendor-request';
import { AVL_META, avlOf, suggestVendors } from '@/lib/vendor-profile';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { IconMail, IconWa } from '../icons';

const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'CNY', 'JPY'];
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/**
 * "Minta Harga ke Vendor" + daftar "Vendor diminta" di detail RFQ / FUP A
 * (Purchasing). Email terpisah per vendor; WhatsApp dibuka berurutan.
 * Nama customer tidak pernah ikut ke vendor.
 */
export function VendorRequestPanel({
  jenis,
  docId,
  noDoc,
  cabang,
  items,
  readOnly,
}: {
  jenis: 'RFQ' | 'FUPA';
  docId: string;
  noDoc: string;
  cabang: string;
  items: RfqItem[];
  readOnly: boolean;
}) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const vendors = useDataStore((s) => s.vendors);
  const me = useDataStore((s) => s.currentUser);
  const upsertRfq = useDataStore((s) => s.upsertRfq);
  const [list, setList] = useState<VendorRequest[] | null>(null);
  const [compose, setCompose] = useState(false);
  const [openBalas, setOpenBalas] = useState('');
  const [waQueue, setWaQueue] = useState<{ nama: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const q = jenis === 'RFQ' ? `rfqId=${docId}` : `fupaId=${docId}`;

  const load = useCallback(() => {
    api
      .get<{ requests: VendorRequest[] }>(`/api/vendor-requests?${q}`)
      .then((r) => setList(r.requests))
      .catch(() => setList([]));
  }, [q]);
  useEffect(load, [load]);

  async function remind(r: VendorRequest) {
    try {
      const res = await api.patch<{ waUrl: string | null; email: string | null }>(`/api/vendor-requests/${r.id}`, { action: 'reminder' });
      if (res.waUrl) window.open(res.waUrl, '_blank', 'noopener');
      toast(`Pengingat ke ${r.vendorNama}${res.email === 'ok' ? ' terkirim via email' : res.waUrl ? ' — WhatsApp dibuka' : ''}`, 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function pakai(r: VendorRequest) {
    try {
      const res = await api.patch<{ rfq: Rfq; used: number }>(`/api/vendor-requests/${r.id}`, { action: 'pakai' });
      upsertRfq(res.rfq);
      toast(`Harga ${r.vendorNama} dipakai sebagai HPP untuk ${res.used} item — isi margin lalu kirim jawaban`, 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function remove(r: VendorRequest) {
    try {
      await api.del(`/api/vendor-requests/${r.id}`);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const summary = (r: VendorRequest) => {
    const priced = r.items.filter((i) => i.harga && !i.noQuote);
    if (r.status === 'noquote') return tr('tidak ada harga');
    if (!priced.length) return '–';
    const cur = Array.from(new Set(priced.map((i) => i.currency || 'IDR'))).join('/');
    return `${priced.length}/${items.length} item · ${cur}${priced.length === 1 ? ` ${Number(priced[0].harga).toLocaleString('id-ID')}` : ''}`;
  };

  return (
    <div className="vr">
      <div className="vr-head">
        <b>{tr("Vendor diminta")}</b>
        {list && list.length > 0 && <span className="muted">{list.filter((r) => r.status === 'dibalas').length}/{list.length} {tr("sudah membalas")}</span>}
        {!readOnly && (
          <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setCompose((v) => !v)}>
            <IconMail /> {compose ? tr("Tutup") : tr("Minta Harga ke Vendor")}
          </button>
        )}
      </div>

      {compose && (
        <ComposeVr
          jenis={jenis}
          docId={docId}
          noDoc={noDoc}
          cabang={cabang}
          items={items}
          vendors={vendors}
          sender={me?.name || 'Purchasing'}
          already={list || []}
          onSent={(wa) => {
            setCompose(false);
            setWaQueue(wa);
            load();
          }}
        />
      )}

      {waQueue.length > 0 && (
        <div className="vr-waq">
          <IconWa />
          <span>
            {tr("WhatsApp berurutan:")} <b>{waQueue[0].nama}</b> {waQueue.length > 1 ? `(${waQueue.length} ${tr("vendor lagi")})` : ''}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-wa"
            onClick={() => {
              window.open(waQueue[0].url, '_blank', 'noopener');
              setWaQueue((qq) => qq.slice(1));
            }}
          >
            {tr("Buka WhatsApp")} {waQueue[0].nama}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setWaQueue([])}>{tr("Lewati")}</button>
        </div>
      )}

      {list === null ? (
        <div className="field-note">{tr("Memuat…")}</div>
      ) : list.length === 0 ? (
        <div className="field-note">{tr("Belum ada vendor yang dimintai harga untuk dokumen ini.")}</div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table vr-table">
            <thead>
              <tr>
                <th>{tr("Vendor")}</th>
                <th>{tr("Saluran")}</th>
                <th>{tr("Diminta")}</th>
                <th>{tr("Tenggat")}</th>
                <th>{tr("Status")}</th>
                <th>{tr("Harga vendor")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const late = r.status === 'menunggu' && r.tenggat && r.tenggat < today;
                return [
                  <tr key={r.id}>
                    <td>
                      <b>{r.vendorNama}</b>
                      {r.reminders > 0 && <div className="muted">{tr("diingatkan")} {r.reminders}×</div>}
                    </td>
                    <td>{VR_CHANNEL_LABEL[r.channel || ''] || r.channel || '-'}</td>
                    <td>{fmtDate(r.tglDiminta)}</td>
                    <td className={late ? 'vr-late' : ''}>{fmtDate(r.tenggat) || '-'}{late ? ` · ${tr("lewat")}` : ''}</td>
                    <td><span className={`badge ${VR_STATUS_META[r.status].color}`}>{tr(VR_STATUS_META[r.status].label)}</span></td>
                    <td className="mono">{summary(r)}</td>
                    <td className="vr-acts">
                      {!readOnly && (
                        <>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpenBalas(openBalas === r.id ? '' : r.id)}>{tr("Catat balasan")}</button>
                          {r.status === 'menunggu' && <button type="button" className="btn btn-outline btn-sm" onClick={() => remind(r)}>{tr("Ingatkan")}</button>}
                          {jenis === 'RFQ' && r.status === 'dibalas' && r.items.some((i) => i.harga && !i.noQuote) && <button type="button" className="btn btn-primary btn-sm" onClick={() => pakai(r)}>{tr("Pakai sebagai HPP")}</button>}
                          <button type="button" className="icon-btn danger" title={tr("Hapus")} onClick={() => remove(r)}>×</button>
                        </>
                      )}
                    </td>
                  </tr>,
                  openBalas === r.id ? (
                    <tr key={`${r.id}-b`} className="vr-balas-row">
                      <td colSpan={7}>
                        <BalasForm
                          r={r}
                          items={items}
                          busy={busy}
                          onSave={async (prices, status) => {
                            setBusy(true);
                            try {
                              await api.patch(`/api/vendor-requests/${r.id}`, { action: 'balas', items: prices, status });
                              setOpenBalas('');
                              load();
                            } catch (e) {
                              toast((e as Error).message, 'error');
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BalasForm({ r, items, busy, onSave }: { r: VendorRequest; items: RfqItem[]; busy: boolean; onSave: (p: VrItemPrice[], status?: string) => void }) {
  const tr = useT();
  const [rows, setRows] = useState<VrItemPrice[]>(() =>
    items.map((_, idx) => r.items.find((x) => x.idx === idx) || { idx, currency: r.currency || 'IDR', leadTime: '', note: '' }),
  );
  const set = (idx: number, p: Partial<VrItemPrice>) => setRows((rs) => rs.map((x) => (x.idx === idx ? { ...x, ...p } : x)));
  const lines = vrLines(items);
  return (
    <div className="vr-balas">
      <table className="simple-table">
        <thead>
          <tr><th>{tr("Item")}</th><th>{tr("Harga / satuan")}</th><th>{tr("Mata uang")}</th><th>{tr("Lead time")}</th><th>{tr("Catatan")}</th><th>{tr("Tidak ada")}</th></tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.idx}>
              <td>{lines[x.idx]?.material || '-'} <span className="muted">{lines[x.idx]?.dimensi}</span></td>
              <td><input type="number" min={0} step="any" value={x.harga ?? ''} disabled={!!x.noQuote} onChange={(e) => set(x.idx, { harga: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 120 }} /></td>
              <td>
                <select value={x.currency || 'IDR'} onChange={(e) => set(x.idx, { currency: e.target.value })} style={{ width: 80 }}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td><input type="text" value={x.leadTime || ''} onChange={(e) => set(x.idx, { leadTime: e.target.value })} placeholder={tr("cth. 3 bln")} style={{ width: 100 }} /></td>
              <td><input type="text" value={x.note || ''} onChange={(e) => set(x.idx, { note: e.target.value })} style={{ width: 160 }} /></td>
              <td className="center"><input type="checkbox" checked={!!x.noQuote} onChange={(e) => set(x.idx, { noQuote: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar-row" style={{ marginTop: 6, marginBottom: 0 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSave(rows.filter((x) => x.harga || x.noQuote || x.note || x.leadTime))}>{tr("Simpan balasan")}</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => onSave([], 'noquote')}>{tr("Vendor tidak ada harga")}</button>
      </div>
    </div>
  );
}

function ComposeVr({
  jenis,
  docId,
  noDoc,
  cabang,
  items,
  vendors,
  sender,
  already,
  onSent,
}: {
  jenis: 'RFQ' | 'FUPA';
  docId: string;
  noDoc: string;
  cabang: string;
  items: RfqItem[];
  vendors: ReturnType<typeof useDataStore.getState>['vendors'];
  sender: string;
  already: VendorRequest[];
  onSent: (wa: { nama: string; url: string }[]) => void;
}) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [vq, setVq] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [idxs, setIdxs] = useState<number[]>(() => items.map((_, i) => i));
  const [tenggat, setTenggat] = useState(addDays(3));
  const [lokasi, setLokasi] = useState(cabang ? `Gudang ${cabang}` : '');
  const [subject, setSubject] = useState(`Permintaan penawaran harga — ${noDoc}`);
  const [attach, setAttach] = useState({ pdf: true, xlsx: false, gambar: true });
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => vrLines(items, idxs), [items, idxs]);
  const defaultMsg = useMemo(() => vrDefaultMessage({ vendorPic: '{pic}', docNo: noDoc, lines, tenggat, lokasi, catatan: '', sender }), [noDoc, lines, tenggat, lokasi, sender]);
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const msg = edited ? message : defaultMsg;

  const sugg = useMemo(() => suggestVendors(items, vendors).slice(0, 6), [items, vendors]);
  const suggIds = useMemo(() => new Set(sugg.map((s) => s.vendor.id)), [sugg]);
  const asked = new Set(already.map((r) => r.vendorId));
  const shown = useMemo(() => {
    const ql = vq.trim().toLowerCase();
    return vendors
      .filter((v) => !ql || [v.nama, v.kategori, ...(v.produk || [])].some((x) => (x || '').toLowerCase().includes(ql)))
      .sort((a, b) => Number(suggIds.has(b.id)) - Number(suggIds.has(a.id)) || a.nama.localeCompare(b.nama))
      .slice(0, 40);
  }, [vendors, vq, suggIds]);

  const defaultChannel = (v: (typeof vendors)[number]) => (v.email && v.wa ? 'both' : v.email ? 'email' : 'wa');

  async function send() {
    const vs = Object.entries(picked).map(([vendorId, channel]) => ({ vendorId, channel }));
    if (!vs.length) return toast('Pilih minimal satu vendor', 'error');
    if (!idxs.length) return toast('Pilih minimal satu item', 'error');
    setBusy(true);
    try {
      const res = await api.post<{ results: { vendorNama: string; email: string | null; waUrl: string | null; error?: string }[] }>('/api/vendor-requests', {
        ...(jenis === 'RFQ' ? { rfqId: docId } : { fupaId: docId }),
        vendors: vs,
        idxs,
        tenggat,
        lokasi,
        subject,
        message: msg,
        attach,
      });
      const mails = res.results.filter((r) => r.email === 'ok').length;
      const failed = res.results.filter((r) => r.email === 'gagal' || r.email === 'tanpa-email').map((r) => `${r.vendorNama}${r.email === 'tanpa-email' ? ' (tanpa email)' : ''}`);
      toast(`Permintaan tercatat untuk ${res.results.length} vendor · email terkirim ${mails}${failed.length ? ` · gagal: ${failed.join(', ')}` : ''}`, failed.length ? 'info' : 'success');
      onSent(res.results.filter((r) => r.waUrl).map((r) => ({ nama: r.vendorNama, url: r.waUrl as string })));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vr-compose">
      <div className="vr-col">
        <label>{tr("Vendor")} <span className="muted">({Object.keys(picked).length} {tr("dipilih")})</span></label>
        <input type="text" value={vq} onChange={(e) => setVq(e.target.value)} placeholder={tr("Cari vendor / produk")} />
        <div className="vr-vlist">
          {shown.map((v) => {
            const st = avlOf(v);
            const s = sugg.find((x) => x.vendor.id === v.id);
            const on = v.id in picked;
            return (
              <div key={v.id} className={`vr-v ${on ? 'on' : ''} ${st === 'diblokir' ? 'blocked' : ''}`}>
                <label className="vr-v-main">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={st === 'diblokir'}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = { ...p };
                        if (e.target.checked) n[v.id] = defaultChannel(v);
                        else delete n[v.id];
                        return n;
                      })
                    }
                  />
                  <span>
                    <b>{v.nama}</b>
                    {st !== 'aktif' && <span className={`badge ${AVL_META[st].color}`} style={{ marginLeft: 6 }}>{tr(AVL_META[st].label)}</span>}
                    {s && <span className="vr-sugg">{tr("Disarankan")} · {s.why.join(', ')}</span>}
                    {asked.has(v.id) && <span className="muted"> · {tr("sudah diminta")}</span>}
                    <span className="muted vr-contact">{[v.email, v.wa].filter(Boolean).join(' · ') || tr('tanpa kontak')}</span>
                  </span>
                </label>
                {on && (
                  <select value={picked[v.id]} onChange={(e) => setPicked((p) => ({ ...p, [v.id]: e.target.value }))} aria-label={tr("Saluran")}>
                    <option value="email" disabled={!v.email}>{tr("Email")}</option>
                    <option value="wa" disabled={!v.wa}>{tr("WhatsApp")}</option>
                    <option value="both" disabled={!v.email || !v.wa}>{tr("Email + WA")}</option>
                  </select>
                )}
              </div>
            );
          })}
          {shown.length === 0 && <div className="field-note">{tr("Vendor tidak ditemukan.")}</div>}
        </div>
      </div>
      <div className="vr-col grow">
        <label>{tr("Item yang dimintakan harga")}</label>
        <div className="vr-items">
          {vrLines(items).map((l) => (
            <label key={l.idx}>
              <input type="checkbox" checked={idxs.includes(l.idx)} onChange={(e) => setIdxs((x) => (e.target.checked ? [...x, l.idx].sort((a, b) => a - b) : x.filter((i) => i !== l.idx)))} />
              {l.material} <span className="muted">{l.dimensi} · {l.pcs} pcs</span>
            </label>
          ))}
        </div>
        <div className="vr-grid">
          <label>{tr("Tenggat balas")}<input type="date" value={tenggat} onChange={(e) => setTenggat(e.target.value)} /></label>
          <label>{tr("Lokasi kirim")}<input type="text" value={lokasi} onChange={(e) => setLokasi(e.target.value)} /></label>
        </div>
        <label>{tr("Subjek email")}<input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label>
          {tr("Pesan (email & WhatsApp)")} {edited && <button type="button" className="link-btn" onClick={() => setEdited(false)}>{tr("kembalikan otomatis")}</button>}
          <textarea rows={9} value={msg} onChange={(e) => { setEdited(true); setMessage(e.target.value); }} />
        </label>
        <div className="field-note" style={{ margin: 0 }}>{tr("{pic} diganti nama PIC vendor. Nama customer tidak dikirim ke vendor.")}</div>
        <div className="vr-attach">
          <label><input type="checkbox" checked={attach.pdf} onChange={(e) => setAttach({ ...attach, pdf: e.target.checked })} /> {tr("Daftar item (PDF)")}</label>
          <label><input type="checkbox" checked={attach.xlsx} onChange={(e) => setAttach({ ...attach, xlsx: e.target.checked })} /> {tr("Daftar item (Excel)")}</label>
          <label><input type="checkbox" checked={attach.gambar} onChange={(e) => setAttach({ ...attach, gambar: e.target.checked })} /> {tr("Gambar kerja dari Sales")}</label>
        </div>
        <div className="field-note" style={{ margin: 0 }}>{tr("Email: lampiran ikut terkirim. WhatsApp: pesan berisi tautan unduh lampiran; tiap vendor dibuka satu per satu.")}</div>
        <div className="toolbar-row" style={{ marginTop: 8, marginBottom: 0 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>
            {busy ? tr("Mengirim…") : `${tr("Kirim ke")} ${Object.keys(picked).length} ${tr("vendor")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
