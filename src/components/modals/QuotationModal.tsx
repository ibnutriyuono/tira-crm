'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconDownload, IconMail, IconPlus, IconTrash } from '../icons';
import { escapeForFilename, getProspectMaterials, num, todayStr } from '@/lib/format';
import { normalizeCustomerName } from '@/lib/kam';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Prospect } from '@/lib/types';
import { canNow } from '@/hooks/useCan';
import { signatureUrl } from '../SignatureSection';
import { activityOwner } from '@/lib/sales-activity';
import {
  QUOTE_OPT_GROUPS,
  defaultQuoteOpts,
  lineTotal,
  normalizeQuoteOpts,
  quoteHtml,
  quoteTotals,
  rupiah,
  unitPrice,
  type QuoteData,
  type QuoteItem,
  type QuoteOptKey,
  type QuoteOpts,
} from '@/lib/quotation-doc';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function generateDefaultNomor(r: Prospect): string {
  const now = new Date();
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `${seq}/TA-STL-${r.cabang || 'PST'}/${ROMAN[now.getMonth()]}/${now.getFullYear()}`;
}

const JABATAN: Record<string, string> = { sales: 'Sales Engineer', bm: 'Branch Manager', rm: 'Regional Manager', gm: 'General Manager', salesadmin: 'Admin Sales' };

// Pilihan tampilan, kop, kota & telepon penanda tangan diingat per browser.
const LS = { opts: 'tira.quote.opts', kop: 'tira.quote.kop', kota: 'tira.quote.kota', telp: 'tira.quote.telp' };
const lsGet = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* mode privat: abaikan */
  }
};

const blankItem = (): QuoteItem => ({ line: '', uraian: '', grade: '', satuan: 'pcs', qty: 1, beratPc: 0, hargaKg: 0, harga: 0 });

type Tab = 'isi' | 'tampilan' | 'pratinjau';

export function QuotationModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'quotation';
  const prospectId = useUiStore((s) => s.quotationProspectId);
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const record = prospectId ? records.find((r) => r.id === prospectId) || null : null;
  const cust = useMemo(() => {
    if (!record) return null;
    const key = normalizeCustomerName(record.customer);
    return customers.find((c) => normalizeCustomerName(c.name) === key) || null;
  }, [record, customers]);
  const picOptions = useMemo(() => (cust?.pics?.length ? cust.pics : cust?.pic ? [{ id: 'legacy', nama: cust.pic, jabatan: null, phone: cust.phone, email: cust.email, isPrimary: true }] : []), [cust]);

  const [tab, setTab] = useState<Tab>('isi');
  const [opts, setOpts] = useState<QuoteOpts>(defaultQuoteOpts());
  const [d, setD] = useState<QuoteData | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // Catat ke Aktivitas Harian pembuat surat ("Kirim penawaran / dokumen").
  const [logAkt, setLogAkt] = useState(true);

  useEffect(() => {
    if (!show || !record) return;
    const primary = picOptions.find((p) => p.isPrimary) || picOptions[0];
    const picLabel = (p: { nama: string; jabatan: string | null } | undefined) => (p ? `${p.nama}${p.jabatan ? ` (${p.jabatan})` : ''}` : '');
    let saved: unknown = null;
    try {
      saved = JSON.parse(lsGet(LS.opts) || 'null');
    } catch {
      saved = null;
    }
    setOpts(normalizeQuoteOpts(saved));
    setTab('isi');
    const mats = getProspectMaterials(record) as (ReturnType<typeof getProspectMaterials>[number] & { grade?: string; satuan?: string; fabNama?: string })[];
    setD({
      nomor: generateDefaultNomor(record),
      tanggal: todayStr(),
      kota: lsGet(LS.kota) || '',
      lampiran: '-',
      perihal: `Penawaran Harga ${record.uraian || ''}`.trim().slice(0, 120),
      kepada: record.customer || '',
      pic: picLabel(primary),
      alamat: cust?.address || '',
      items: mats.length
        ? mats.map((m) => ({
            line: m.line || '',
            uraian: m.uraian || '',
            grade: m.grade || '',
            satuan: m.fabNama !== undefined ? m.satuan || 'unit' : 'pcs',
            qty: num(m.qty) || 1,
            beratPc: num(m.beratPc),
            hargaKg: num(m.hargaKg),
            harga: num(m.harga),
          }))
        : [blankItem()],
      ppnInclude: false,
      pembayaran: '30 hari setelah invoice diterima',
      pengiriman: '2-4 minggu setelah PO diterima / sesuai kondisi stock',
      berlaku: '14 hari kerja sejak tanggal penawaran',
      kondisiStock: record.kondisiStock || '',
      catatan: '',
      signer: { nama: currentUser?.name || '', jabatan: JABATAN[currentUser?.role || ''] || '', telp: lsGet(LS.telp) || '', email: currentUser?.email || '' },
      kopText: lsGet(LS.kop) || '',
    });
    setEmail(primary?.email || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, prospectId]);

  const totals = useMemo(() => (d ? quoteTotals(d, opts) : null), [d, opts]);
  const sigSrc = signatureUrl(currentUser?.signatureAt);
  const preview = useMemo(() => (d && tab === 'pratinjau' ? quoteHtml(d, opts, '/logo.png', sigSrc) : ''), [d, opts, tab, sigSrc]);

  if (!record || !d) return null;

  const set = (patch: Partial<QuoteData>) => setD((x) => (x ? { ...x, ...patch } : x));
  const setSigner = (patch: Partial<QuoteData['signer']>) => setD((x) => (x ? { ...x, signer: { ...x.signer, ...patch } } : x));
  const setItem = (idx: number, patch: Partial<QuoteItem>) => setD((x) => (x ? { ...x, items: x.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } : x));
  const removeItem = (idx: number) => setD((x) => (x && x.items.length > 1 ? { ...x, items: x.items.filter((_, i) => i !== idx) } : x));
  const toggleOpt = (k: QuoteOptKey) =>
    setOpts((o) => {
      const n = { ...o, [k]: !o[k] };
      lsSet(LS.opts, JSON.stringify(n));
      return n;
    });

  function remember() {
    if (!d) return;
    lsSet(LS.kop, d.kopText);
    lsSet(LS.kota, d.kota);
    lsSet(LS.telp, d.signer.telp);
  }

  const canLogAkt = !!currentUser && !!activityOwner(currentUser) && canNow('aktivitas', 'e');

  /** Satu nomor surat = satu baris Aktivitas Harian (unduh ulang memperbarui baris yang sama). */
  async function logToActivity(kanal: 'email' | null) {
    if (!d || !record || !logAkt || !canLogAkt) return;
    try {
      const r = await api.post<{ created: boolean }>('/api/sales-activities/quotation', {
        prospectId: record.id,
        nomor: d.nomor,
        tanggal: d.tanggal,
        customer: d.kepada,
        pic: d.pic,
        ringkas: d.items.filter((it) => it.uraian.trim()).map((it) => it.uraian.trim()).join(', '),
        total: totals ? rupiah(totals.grand).replace(/\u00A0/g, ' ') : '',
        kanal,
      });
      if (r.created) toast('Tercatat di Aktivitas Harian (Kirim penawaran / dokumen)', 'success');
    } catch (err) {
      toast(err instanceof Error ? `Aktivitas Harian: ${err.message}` : 'Gagal mencatat ke Aktivitas Harian', 'error');
    }
  }

  async function markSent() {
    if (!record || record.penawaranTerkirim || !canNow('prospek', 'e')) return;
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${record.id}`, { penawaranTerkirim: true });
      upsertProspect(prospect);
    } catch {
      /* non-blocking */
    }
  }

  function validate(): boolean {
    if (!d) return false;
    if (!d.kepada.trim()) {
      toast('Nama customer/tujuan wajib diisi', 'error');
      return false;
    }
    if (!d.items.some((it) => it.uraian.trim())) {
      toast('Isi minimal satu uraian material', 'error');
      return false;
    }
    return true;
  }

  async function onDownload() {
    if (!d || !validate()) return;
    setBusy(true);
    try {
      remember();
      const { buildQuoteDocx, loadLogo } = await import('@/lib/quotation-docx');
      const [logo, sig] = await Promise.all([opts.kop ? loadLogo() : null, opts.ttdGambar && sigSrc ? loadLogo(sigSrc) : null]);
      const blob = await buildQuoteDocx(d, opts, logo, sig);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Penawaran_${escapeForFilename(d.kepada || 'Customer')}_${d.tanggal || todayStr()}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Surat penawaran (.docx) berhasil diunduh', 'success');
      void markSent();
      void logToActivity(null);
    } catch (err) {
      toast(err instanceof Error ? `Gagal membuat file Word: ${err.message}` : 'Gagal membuat file Word', 'error');
    } finally {
      setBusy(false);
    }
  }

  function onSendEmail() {
    if (!d || !validate()) return;
    remember();
    const ringkas = d.items.filter((it) => it.uraian.trim()).map((it) => it.uraian.trim()).join(', ');
    const subject = encodeURIComponent(`Penawaran Harga - ${d.perihal || ringkas}`);
    const sapa = d.pic.replace(/\s*\(.*\)\s*$/, '').trim() || d.kepada;
    const body = [
      `Yth. Bapak/Ibu ${sapa},`,
      '',
      `Bersama email ini kami sampaikan penawaran harga untuk ${ringkas || 'material yang diminta'} (No. ${d.nomor}), total ${totals ? rupiah(totals.grand) : ''}.`,
      'Mohon lampirkan file Word hasil unduhan (.docx) pada email ini sebelum dikirim.',
      '',
      'Terima kasih.',
      '',
      d.signer.nama,
      d.signer.jabatan,
      'PT. TIRA AUSTENITE, Tbk - Steel Division',
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '');
    window.open(`mailto:${email}?subject=${subject}&body=${encodeURIComponent(body.join('\n'))}`, '_blank');
    void markSent();
    void logToActivity('email');
  }

  const anyPerKg = d.items.some((it) => it.beratPc > 0 && it.hargaKg > 0);

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Buat Surat Penawaran"
      xwide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
          <button type="button" className="btn btn-outline" onClick={onSendEmail}>
            <IconMail /> Kirim via Email
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onDownload}>
            <IconDownload /> {busy ? 'Menyiapkan…' : 'Unduh Word (.docx)'}
          </button>
        </>
      }
    >
      <div className="sa-pills q-tabs" role="tablist" aria-label="Bagian surat penawaran">
        {(
          [
            ['isi', 'Isi surat'],
            ['tampilan', 'Data yang ditampilkan'],
            ['pratinjau', 'Pratinjau'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'isi' && (
        <div className="form-grid">
          <div>
            <label>Nomor Surat</label>
            <input type="text" value={d.nomor} onChange={(e) => set({ nomor: e.target.value })} />
          </div>
          <div className="q-2">
            <div>
              <label>Kota</label>
              <input type="text" value={d.kota} placeholder="cth. Jakarta" onChange={(e) => set({ kota: e.target.value })} />
            </div>
            <div>
              <label>Tanggal</label>
              <input type="date" value={d.tanggal} onChange={(e) => set({ tanggal: e.target.value })} />
            </div>
          </div>
          <div>
            <label>Kepada (Customer)</label>
            <input type="text" value={d.kepada} onChange={(e) => set({ kepada: e.target.value })} />
          </div>
          <div>
            <label>PIC / Up.</label>
            <input type="text" list="q-pic-list" value={d.pic} placeholder={picOptions.length ? 'pilih atau ketik' : 'nama PIC (jabatan)'} onChange={(e) => set({ pic: e.target.value })} />
            <datalist id="q-pic-list">
              {picOptions.map((p) => (
                <option key={p.id} value={`${p.nama}${p.jabatan ? ` (${p.jabatan})` : ''}`} />
              ))}
            </datalist>
            {!cust && <div className="field-note">Customer belum ada di Kelola Customer — PIC & alamat diisi manual.</div>}
          </div>
          <div className="full">
            <label>Alamat</label>
            <textarea style={{ minHeight: 44 }} value={d.alamat} onChange={(e) => set({ alamat: e.target.value })} />
          </div>
          <div className={opts.lampiran ? '' : 'full'}>
            <label>Perihal</label>
            <input type="text" value={d.perihal} onChange={(e) => set({ perihal: e.target.value })} />
          </div>
          {opts.lampiran && (
            <div>
              <label>Lampiran</label>
              <input type="text" value={d.lampiran} onChange={(e) => set({ lampiran: e.target.value })} />
            </div>
          )}

          <div className="full">
            <label>Daftar Material yang Ditawarkan</label>
            <div className="qitem-header">
              <span>Line</span>
              <span>Uraian Material</span>
              <span>Qty</span>
              <span>Satuan</span>
              <span>Berat/pcs (kg)</span>
              <span>Harga/kg</span>
              <span>Harga Satuan</span>
              <span style={{ textAlign: 'right' }}>Jumlah</span>
              <span></span>
            </div>
            {d.items.map((it, idx) => {
              const perKg = it.beratPc > 0 && it.hargaKg > 0;
              return (
                <div className="qitem-row" key={idx}>
                  <input type="text" aria-label="Line" placeholder="Line" value={it.line} onChange={(e) => setItem(idx, { line: e.target.value })} />
                  <input type="text" aria-label="Uraian material" placeholder="Uraian material" value={it.uraian} onChange={(e) => setItem(idx, { uraian: e.target.value })} />
                  <input type="number" aria-label="Qty" min={0} step="any" value={it.qty} onChange={(e) => setItem(idx, { qty: num(e.target.value) })} />
                  <input type="text" aria-label="Satuan" value={it.satuan} onChange={(e) => setItem(idx, { satuan: e.target.value })} />
                  <input type="number" aria-label="Berat per pcs (kg)" min={0} step="any" value={it.beratPc || ''} placeholder="-" onChange={(e) => setItem(idx, { beratPc: num(e.target.value) })} />
                  <input type="number" aria-label="Harga per kg" min={0} step="any" value={it.hargaKg || ''} placeholder="-" onChange={(e) => setItem(idx, { hargaKg: num(e.target.value) })} />
                  <input
                    type="number"
                    aria-label="Harga satuan"
                    min={0}
                    step="any"
                    value={perKg ? Math.round(unitPrice(it)) : it.harga}
                    readOnly={perKg}
                    title={perKg ? 'Dihitung dari berat/pcs × harga/kg. Kosongkan harga/kg untuk mengisi harga satuan langsung.' : undefined}
                    className={perKg ? 'q-calc' : undefined}
                    onChange={(e) => setItem(idx, { harga: num(e.target.value) })}
                  />
                  <div className="qi-total mono">{rupiah(lineTotal(it))}</div>
                  <button type="button" className="icon-btn danger qi-remove" aria-label="Hapus material" disabled={d.items.length <= 1} onClick={() => removeItem(idx)}>
                    <IconTrash />
                  </button>
                </div>
              );
            })}
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => set({ items: [...d.items, blankItem()] })}>
              <IconPlus /> Tambah Material
            </button>
            {anyPerKg && <div className="field-note">Harga satuan = berat/pcs × harga/kg (abu-abu = dihitung otomatis).</div>}
          </div>

          <div className="full q-totals">
            <label className="q-ppn">
              <input type="checkbox" checked={d.ppnInclude} onChange={(e) => set({ ppnInclude: e.target.checked })} />
              Harga yang diisi sudah termasuk PPN 11%
            </label>
            <div className="q-sum">
              {totals?.rows.map((r) => (
                <div key={r.label} className={r.bold ? 'q-sum-grand' : ''}>
                  <span>{r.label}</span>
                  <b className="mono">{r.value}</b>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label>Syarat Pembayaran</label>
            <input type="text" value={d.pembayaran} onChange={(e) => set({ pembayaran: e.target.value })} />
          </div>
          <div>
            <label>Syarat Pengiriman</label>
            <input type="text" value={d.pengiriman} onChange={(e) => set({ pengiriman: e.target.value })} />
          </div>
          <div>
            <label>Masa Berlaku Penawaran</label>
            <input type="text" value={d.berlaku} onChange={(e) => set({ berlaku: e.target.value })} />
          </div>
          <div>
            <label>Kondisi Stock</label>
            <input type="text" value={d.kondisiStock} onChange={(e) => set({ kondisiStock: e.target.value })} />
          </div>
          <div className="full">
            <label>Catatan Tambahan (opsional)</label>
            <textarea value={d.catatan} onChange={(e) => set({ catatan: e.target.value })} />
          </div>

          <div className="full q-section">Penanda tangan</div>
          <div className="full q-sigrow">
            {sigSrc ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigSrc} alt="Tanda tangan Anda" />
                <span className="field-note" style={{ margin: 0 }}>
                  {opts.ttdGambar ? 'Tanda tangan Anda dipasang otomatis di surat.' : 'Tanda tangan tidak dipasang (dimatikan di tab "Data yang ditampilkan").'}
                </span>
              </>
            ) : (
              <span className="field-note" style={{ margin: 0 }}>
                Belum ada tanda tangan. Tambahkan lewat tombol <b>Akun Saya</b> di atas — selanjutnya otomatis terpasang di setiap surat penawaran Anda.
              </span>
            )}
          </div>
          <div>
            <label>Nama</label>
            <input type="text" value={d.signer.nama} onChange={(e) => setSigner({ nama: e.target.value })} />
          </div>
          <div>
            <label>Jabatan</label>
            <input type="text" value={d.signer.jabatan} onChange={(e) => setSigner({ jabatan: e.target.value })} />
          </div>
          <div>
            <label>Telepon / WA</label>
            <input type="tel" value={d.signer.telp} placeholder="08xx…" onChange={(e) => setSigner({ telp: e.target.value })} />
          </div>
          <div>
            <label>Email</label>
            <input type="email" value={d.signer.email} onChange={(e) => setSigner({ email: e.target.value })} />
          </div>

          <div className="full">
            <label>Email Tujuan (untuk kirim email)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" />
          </div>
          {canLogAkt && (
            <div className="full">
              <label className="q-ppn">
                <input type="checkbox" checked={logAkt} onChange={(e) => setLogAkt(e.target.checked)} />
                Catat ke Aktivitas Harian saya sebagai &quot;Kirim penawaran / dokumen&quot; saat diunduh / dikirim
              </label>
              <div className="field-note">Satu nomor surat dicatat sekali — unduh ulang atau kirim email memperbarui catatan yang sama.</div>
            </div>
          )}
        </div>
      )}

      {tab === 'tampilan' && (
        <div>
          <div className="field-note" style={{ marginTop: 0 }}>
            Centang data yang ingin muncul di surat. Pilihan ini diingat di browser ini untuk surat berikutnya.
          </div>
          <div className="q-opts">
            {QUOTE_OPT_GROUPS.map((g) => (
              <fieldset key={g.title} className="q-opt-group">
                <legend>{g.title}</legend>
                {g.opts.map((x) => (
                  <label key={x.key} className="q-opt">
                    <input type="checkbox" checked={opts[x.key]} onChange={() => toggleOpt(x.key)} />
                    <span>
                      {x.label}
                      {x.hint && <small>{x.hint}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="full">
              <label>Alamat & telepon kantor di kop surat (opsional)</label>
              <textarea
                value={d.kopText}
                placeholder={'cth. Jl. … No. …, Jakarta 12345\nTelp. (021) … · www.…'}
                onChange={(e) => set({ kopText: e.target.value })}
                style={{ minHeight: 56 }}
              />
              <div className="field-note">Tampil di bawah nama perusahaan bila &quot;Logo &amp; kop perusahaan&quot; dicentang.</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                const o = defaultQuoteOpts();
                setOpts(o);
                lsSet(LS.opts, JSON.stringify(o));
              }}
            >
              Kembalikan bawaan
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('pratinjau')}>
              Lihat pratinjau →
            </button>
          </div>
        </div>
      )}

      {tab === 'pratinjau' && (
        <div className="q-preview-wrap">
          {/* Konten dibangun dari data form yang di-escape di quoteHtml. */}
          <div className="q-paper" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      )}
    </Modal>
  );
}
