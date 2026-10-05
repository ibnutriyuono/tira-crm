'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { IconEdit, IconPlus, IconTrash } from '../icons';
import { ACTIVITY_CONVERT_STATUSES, ACTIVITY_TYPES, STATUS_META, type ActivityTipe } from '@/lib/constants';
import { formatDateID, formatRupiah } from '@/lib/format';
import { api } from '@/lib/api-client';
import { activityOwner, localToday } from '@/lib/sales-activity';
import { useDataStore } from '@/store/useDataStore';
import { EMPTY_QCD, useUiStore, type PendingQcd } from '@/store/useUiStore';
import { qcdMissing } from '@/lib/qcd';
import { QcdFields, qcdPayload } from '../QcdFields';
import type { ActivityPic, Prospect, SalesActivity } from '@/lib/types';

const TIPE_LABEL: Record<string, string> = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.label]));
const TIPE_COLOR: Record<string, string> = { kunjungan: 'green', telepon: 'steel', meeting: 'amber', dokumen: 'slate' };
// Button wording per target status — the sales vocabulary, not the status labels.
const CONVERT_LABEL: Record<number, string> = { 1: 'Permintaan', 2: 'Penawaran', 4: 'PO' };

interface ConvertCtx {
  activity: SalesActivity;
  status: number;
}

/**
 * Sales' daily activity log. A salesperson records what they did today
 * (visit, call, meeting, documents sent); when an activity produces a request,
 * quotation or PO, one button moves it into the pipeline as a real Prospect.
 * Everyone else reads the same data through KPI Aktivitas.
 */
export function SalesActivityModal() {
  const show = useUiStore((s) => s.modal === 'salesActivity');
  const closeModal = useUiStore((s) => s.closeModal);
  const openModal = useUiStore((s) => s.openModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const toast = useDataStore((s) => s.toast);

  const owner = currentUser ? activityOwner(currentUser) : null;
  const canWrite = owner !== null;

  const [tanggal, setTanggal] = useState(localToday());
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [tipe, setTipe] = useState<ActivityTipe>('kunjungan');
  const [customer, setCustomer] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [pics, setPics] = useState<ActivityPic[]>([{ nama: '', jabatan: '' }]);
  const [busy, setBusy] = useState(false);

  const [convert, setConvert] = useState<ConvertCtx | null>(null);
  const [uraian, setUraian] = useState('');
  const [qty, setQty] = useState('1');
  const [nilai, setNilai] = useState('');
  const [noPo, setNoPo] = useState('');
  const [qcd, setQcd] = useState<PendingQcd>({ ...EMPTY_QCD });

  const periode = tanggal.slice(0, 7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { activities: rows } = await api.get<{ activities: SalesActivity[] }>(`/api/sales-activities?periode=${periode}`);
      setActivities(rows);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat aktivitas', 'error');
    } finally {
      setLoading(false);
    }
  }, [periode, toast]);

  useEffect(() => {
    if (!show) return;
    setTanggal(localToday());
    setConvert(null);
    resetForm();
  }, [show]);

  useEffect(() => {
    if (show) void load();
  }, [show, load]);

  function resetForm() {
    setEditId(null);
    setTipe('kunjungan');
    setCustomer('');
    setKeterangan('');
    setPics([{ nama: '', jabatan: '' }]);
  }

  const customerOptions = useMemo(() => {
    const names = new Set<string>();
    customers.forEach((c) => c.name && names.add(c.name));
    prospects.forEach((p) => p.customer && names.add(p.customer));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [customers, prospects]);

  const mine = useMemo(() => activities.filter((a) => (owner ? a.se.toLowerCase() === owner.toLowerCase() : true)), [activities, owner]);
  const dayList = useMemo(() => mine.filter((a) => a.tanggal === tanggal), [mine, tanggal]);
  const monthCount = useMemo(() => {
    const m: Record<string, number> = {};
    mine.forEach((a) => (m[a.tipe] = (m[a.tipe] || 0) + 1));
    return m;
  }, [mine]);

  // PIC yang sudah tercatat di Kelola Customer untuk customer terpilih —
  // jadi saran nama, dan memilih salah satunya mengisi jabatan otomatis.
  const knownPics = useMemo(() => {
    const key = customer.trim().toLowerCase();
    const c = key ? customers.find((x) => (x.name || '').trim().toLowerCase() === key) : null;
    return (c?.pics || []).filter((p) => p.nama);
  }, [customers, customer]);

  function setPic(i: number, field: keyof ActivityPic, value: string) {
    setPics((list) =>
      list.map((p, idx) => {
        if (idx !== i) return p;
        const next = { ...p, [field]: value };
        if (field === 'nama' && !p.jabatan) {
          const hit = knownPics.find((k) => k.nama.trim().toLowerCase() === value.trim().toLowerCase());
          if (hit?.jabatan) next.jabatan = hit.jabatan;
        }
        return next;
      }),
    );
  }

  const prospectById = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);

  async function onSave() {
    if (!customer.trim()) return toast('Nama customer wajib diisi', 'error');
    const filled = pics.map((p) => ({ nama: p.nama.trim(), jabatan: p.jabatan.trim() })).filter((p) => p.nama || p.jabatan);
    if (filled.length === 0) return toast('Isi minimal satu PIC beserta jabatannya', 'error');
    if (filled.some((p) => !p.nama || !p.jabatan)) return toast('Setiap PIC wajib diisi nama dan jabatannya', 'error');
    setBusy(true);
    try {
      const payload = { tanggal, tipe, customer: customer.trim(), keterangan, pics: filled };
      const { activity } = editId
        ? await api.put<{ activity: SalesActivity }>(`/api/sales-activities/${editId}`, payload)
        : await api.post<{ activity: SalesActivity }>('/api/sales-activities', payload);
      setActivities((list) => (list.some((a) => a.id === activity.id) ? list.map((a) => (a.id === activity.id ? activity : a)) : [activity, ...list]));
      toast(editId ? 'Aktivitas diperbarui' : 'Aktivitas tersimpan', 'success');
      resetForm();
      // An edit may have moved the entry into another month; refetch keeps the
      // month summary honest.
      if (editId) void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan aktivitas', 'error');
    } finally {
      setBusy(false);
    }
  }

  function onEdit(a: SalesActivity) {
    setConvert(null);
    setEditId(a.id);
    setTanggal(a.tanggal);
    setTipe(a.tipe);
    setCustomer(a.customer);
    setKeterangan(a.keterangan || '');
    setPics(a.pics?.length ? a.pics.map((p) => ({ ...p })) : [{ nama: '', jabatan: '' }]);
  }

  async function onDelete(a: SalesActivity) {
    if (!window.confirm(`Hapus aktivitas ke "${a.customer}"?`)) return;
    try {
      await api.del(`/api/sales-activities/${a.id}`);
      setActivities((list) => list.filter((x) => x.id !== a.id));
      if (editId === a.id) resetForm();
      toast('Aktivitas dihapus', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus aktivitas', 'error');
    }
  }

  function startConvert(a: SalesActivity, status: number) {
    resetForm();
    setConvert({ activity: a, status });
    setUraian(a.keterangan || '');
    setQty('1');
    setNilai('');
    setNoPo('');
    setQcd({ ...EMPTY_QCD });
  }

  async function onConvert() {
    if (!convert) return;
    if (!uraian.trim()) return toast('Isi uraian material/kebutuhan customer', 'error');
    if (convert.status === 4 && !noPo.trim()) return toast('No. PO wajib diisi untuk status PO/Kontrak', 'error');
    if (convert.status === 4) {
      const miss = qcdMissing(4, qcdPayload(qcd));
      if (miss) return toast(miss, 'error');
    }
    setBusy(true);
    try {
      const res = await api.post<{ prospect: Prospect; activity: SalesActivity }>(`/api/sales-activities/${convert.activity.id}/convert`, {
        status: convert.status,
        uraian: uraian.trim(),
        qty: Number(qty) || 1,
        value: Number(nilai) || 0,
        noPo: noPo.trim(),
        ...(convert.status === 4 ? qcdPayload(qcd) : {}),
      });
      upsertProspect(res.prospect);
      setActivities((list) => list.map((a) => (a.id === res.activity.id ? { ...a, prospectId: res.prospect.id } : a)));
      setConvert(null);
      toast(`"${res.prospect.customer}" masuk pipeline sebagai ${CONVERT_LABEL[convert.status]}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memasukkan ke pipeline', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Aktivitas Harian"
      xwide
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              closeModal();
              openModal('activityKpi');
            }}
          >
            Lihat KPI Aktivitas
          </button>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Tutup
          </button>
        </>
      }
    >
      {!canWrite && (
        <div className="import-summary" style={{ marginTop: 0, marginBottom: 12 }}>
          Pengisian aktivitas dilakukan oleh akun <b>Sales</b> (yang memiliki Kode SE) dan <b>Branch Manager</b>. Akun Anda dapat melihat rekap di <b>KPI Aktivitas</b>.
        </div>
      )}

      <div className="toolbar-row" style={{ alignItems: 'center' }}>
        <label style={{ margin: 0 }}>Tanggal</label>
        <input type="date" value={tanggal} max={localToday()} onChange={(e) => e.target.value && setTanggal(e.target.value)} style={{ width: 160 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDateID(tanggal)}</span>
      </div>

      <div className="import-summary" style={{ marginTop: 8, marginBottom: 12 }}>
        <b>Bulan ini ({periode}):</b>{' '}
        {ACTIVITY_TYPES.map((t) => `${t.short} ${monthCount[t.key] || 0}`).join(' · ')}
      </div>

      {canWrite && (
        <div className="rfq-item-card">
          <div className="rfq-item-head">
            <span>{editId ? 'Ubah Aktivitas' : 'Aktivitas Baru'}</span>
            {editId && (
              <button type="button" className="btn btn-outline btn-sm" onClick={resetForm}>
                Batal ubah
              </button>
            )}
          </div>
          <div className="form-grid">
            <div>
              <label>Jenis aktivitas</label>
              <select value={tipe} onChange={(e) => setTipe(e.target.value as ActivityTipe)}>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Customer *</label>
              <input type="text" list="salesActCustomers" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Pilih / ketik nama customer" />
              <datalist id="salesActCustomers">
                {customerOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="full">
              <label>
                PIC &amp; Jabatan <span style={{ color: 'var(--rust-600)' }}>*</span>
              </label>
              <datalist id="salesActPics">
                {knownPics.map((k) => (
                  <option key={k.id} value={k.nama}>
                    {k.jabatan || ''}
                  </option>
                ))}
              </datalist>
              {pics.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input type="text" list="salesActPics" value={p.nama} onChange={(e) => setPic(i, 'nama', e.target.value)} placeholder="Nama PIC" style={{ flex: 1 }} />
                  <input type="text" value={p.jabatan} onChange={(e) => setPic(i, 'jabatan', e.target.value)} placeholder="Jabatan (cth. Purchasing Manager)" style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Hapus PIC ini"
                    disabled={pics.length === 1}
                    onClick={() => setPics((list) => list.filter((_, idx) => idx !== i))}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPics((list) => [...list, { nama: '', jabatan: '' }])}>
                <IconPlus /> Tambah PIC
              </button>
              {knownPics.length > 0 && <div className="field-note" style={{ marginTop: 4 }}>Ketik/pilih nama PIC yang sudah terdaftar di customer ini — jabatannya terisi otomatis.</div>}
            </div>
            <div className="full">
              <label>Hasil / keterangan</label>
              <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="cth. Bertemu Pak Andi (Purchasing), minta penawaran plate SS304 12mm" />
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={onSave}>
            <IconPlus /> {editId ? 'Simpan Perubahan' : 'Simpan Aktivitas'}
          </button>
        </div>
      )}

      {convert && (
        <div className="rfq-item-card" style={{ borderColor: 'var(--steel-600)' }}>
          <div className="rfq-item-head">
            <span>
              Masukkan ke Pipeline · {CONVERT_LABEL[convert.status]} — {convert.activity.customer}
            </span>
          </div>
          <div className="form-grid">
            <div className="full">
              <label>Uraian material / kebutuhan *</label>
              <input type="text" value={uraian} onChange={(e) => setUraian(e.target.value)} placeholder="cth. Plate SS304 12 mm x 1250 x 2500" />
            </div>
            <div>
              <label>Qty (pcs)</label>
              <input type="number" min={1} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <label>Nilai total (Rp), bila sudah ada</label>
              <input type="number" min={0} step="any" value={nilai} onChange={(e) => setNilai(e.target.value)} />
            </div>
            {convert.status === 4 && (
              <div className="full">
                <label>
                  No. PO <span style={{ color: 'var(--rust-600)' }}>*</span>
                </label>
                <input type="text" value={noPo} onChange={(e) => setNoPo(e.target.value)} placeholder="Nomor PO/kontrak dari customer" />
              </div>
            )}
          </div>
          {convert.status === 4 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Quality · Cost · Delivery (wajib — deal ditutup)</div>
              <QcdFields value={qcd} onChange={setQcd} statusVal={4} required />
            </div>
          )}
          <div className="field-note" style={{ marginTop: 6 }}>
            Prospek dibuat dengan status {STATUS_META[convert.status]?.label}. Detail lain (material tambahan, harga) dapat dilengkapi dari Pipeline.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConvert(null)}>
              Batal
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onConvert}>
              Masukkan ke Pipeline
            </button>
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, margin: '12px 0 6px' }}>
        Aktivitas {formatDateID(tanggal)} ({dayList.length})
      </div>
      {loading && dayList.length === 0 ? (
        <div className="field-note">Memuat…</div>
      ) : dayList.length === 0 ? (
        <div className="empty-state" style={{ padding: '22px 10px' }}>
          <h3>Belum ada aktivitas pada tanggal ini</h3>
          {canWrite && <p>Isi form di atas untuk mencatat kunjungan, telepon, meeting, atau dokumen yang dikirim.</p>}
        </div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Jenis</th>
                {!canWrite && <th>SE</th>}
                <th>Customer</th>
                <th>PIC</th>
                <th>Keterangan</th>
                <th>Pipeline</th>
                {canWrite && <th>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {dayList.map((a) => {
                const p = a.prospectId ? prospectById.get(a.prospectId) : null;
                return (
                  <tr key={a.id}>
                    <td>
                      <span className={`badge ${TIPE_COLOR[a.tipe] || 'slate'}`}>{TIPE_LABEL[a.tipe] || a.tipe}</span>
                    </td>
                    {!canWrite && <td>{a.se}</td>}
                    <td style={{ fontWeight: 600 }}>{a.customer}</td>
                    <td>
                      {a.pics?.length
                        ? a.pics.map((p, i) => (
                            <div key={i} style={{ marginBottom: 4, minWidth: 140 }}>
                              <div>{p.nama}</div>
                              <div className="field-note" style={{ margin: 0 }}>
                                {p.jabatan}
                              </div>
                            </div>
                          ))
                        : '-'}
                    </td>
                    <td>{a.keterangan || '-'}</td>
                    <td style={{ minWidth: 250 }}>
                      {a.prospectId ? (
                        <span className="badge green" title={p ? `Nilai ${formatRupiah(p.value)}` : undefined}>
                          Di pipeline{p ? ` · ${STATUS_META[Number(p.status)]?.label ?? ''}` : ''}
                        </span>
                      ) : canWrite ? (
                        <div className="row-actions" style={{ flexWrap: 'wrap', gap: 4 }}>
                          {ACTIVITY_CONVERT_STATUSES.map((st) => (
                            <button key={st} type="button" className="btn btn-outline btn-sm" style={{ padding: '3px 8px', whiteSpace: 'nowrap' }} title={`Masukkan ke pipeline sebagai ${CONVERT_LABEL[st]}`} onClick={() => startConvert(a, st)}>
                              → {CONVERT_LABEL[st]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="Ubah" onClick={() => onEdit(a)}>
                            <IconEdit />
                          </button>
                          {!a.prospectId && (
                            <button type="button" className="icon-btn danger" title="Hapus" onClick={() => onDelete(a)}>
                              <IconTrash />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
