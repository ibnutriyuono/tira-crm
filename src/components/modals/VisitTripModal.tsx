'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { CustomerNameInput } from '../CustomerNameInput';
import { IconPlus, IconTrash } from '../icons';
import { CABANG_LIST } from '@/lib/constants';
import { formatDateID } from '@/lib/format';
import { api } from '@/lib/api-client';
import { activityOwner, localToday } from '@/lib/sales-activity';
import {
  TRIP_HASIL,
  TRIP_PHOTO_MAX_PER_VISIT,
  TRIP_HASIL_LABEL,
  TRIP_ROLES,
  tripCabangLocked,
  TRIP_STATUS_META,
  approverLabel,
  buildTripPrintHtml,
  canApproveTrip,
  canEditPlan,
  canEditRealisasi,
  finishBlocker,
  tripDocNo,
  tripRealisasiRate,
} from '@/lib/visit-trip';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { TripPhoto, TripVisit, VisitTrip } from '@/lib/types';
import { UserPicker } from '../UserPicker';
import { useRoster, type RosterUser } from '../issues/shared';
import { canNow, useCan } from '@/hooks/useCan';

import { useT } from '@/store/useLangStore';
import { isGmLevel } from '@/lib/roles';
const ROLE_SHORT: Record<string, string> = { vp: 'VP', gm: 'GM', rm: 'RM', bm: 'BM', sales: 'Sales' };
const blankVisit = (): TripVisit => ({ id: '', customer: '', pic: '', tanggal: '', tujuan: '', realisasi: '', uraian: '', hasil: '', tambahan: false });
let tmpSeq = 0;
const tmpId = () => `new-${++tmpSeq}`;

const photoUrl = (tripId: string, photoId: string) => `/api/visit-trips/${tripId}/photos/${photoId}`;

/**
 * Opens the print window synchronously (inside the click, so pop-up blockers
 * allow it), then fetches the trip's photos and writes the report with its
 * "Lampiran" page. Photo URLs are absolute because the new window starts at
 * about:blank.
 */
function printTrip(trip: VisitTrip, onError: (msg: string) => void) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write('<p style="font-family:sans-serif;padding:20px">Menyiapkan laporan…</p>');
  api
    .get<{ photos: TripPhoto[] }>(`/api/visit-trips/${trip.id}/photos`)
    .catch(() => ({ photos: [] as TripPhoto[] }))
    .then(({ photos }) => {
      const list = photos.map((p) => ({ visitId: p.visitId, name: p.name, src: `${window.location.origin}${photoUrl(trip.id, p.id)}` }));
      w.document.open();
      w.document.write(buildTripPrintHtml(trip, list));
      w.document.close();
    })
    .catch(() => onError('Gagal menyiapkan laporan'));
  return true;
}

/**
 * Phone photos are often 4-8 MB; the printed report needs far less. Downscale
 * to at most 1600 px on the long side and re-encode as JPEG before upload.
 * Falls back to the original file if the browser can't decode it.
 */
async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/**
 * Perjalanan dinas Sales / BM / RM / GM: plan a trip to a branch (customers +
 * purpose of each visit), get it approved (Sales by their BM, BM by their RM,
 * RM by the GM),
 * then record what actually happened. Every trip prints as one form.
 */
export function VisitTripModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'visitTrip');
  const closeModal = useUiStore((s) => s.closeModal);
  const currentUser = useDataStore((s) => s.currentUser);
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);

  // Kelola Role: rencana, persetujuan & realisasi butuh hak Tambah/Ubah; hapus draft butuh hak Hapus.
  const permE = useCan('trip', 'e');
  const permD = useCan('trip', 'd');
  const canPlan = permE && !!currentUser && TRIP_ROLES.includes(currentUser.role);

  const [view, setView] = useState<'list' | 'edit' | 'detail'>('list');
  const [periode, setPeriode] = useState(localToday().slice(0, 7));
  const [trips, setTrips] = useState<VisitTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // plan form
  const [cabang, setCabang] = useState('');
  const [tglBerangkat, setTglBerangkat] = useState('');
  const [tglPulang, setTglPulang] = useState('');
  const [keperluan, setKeperluan] = useState('');
  const [planVisits, setPlanVisits] = useState<TripVisit[]>([blankVisit()]);
  const [peserta, setPeserta] = useState<string[]>([]);
  const roster = useRoster();

  // detail: realisasi + approval
  const [realVisits, setRealVisits] = useState<TripVisit[]>([]);
  const [catatan, setCatatan] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [photos, setPhotos] = useState<TripPhoto[]>([]);
  const [uploadingVisit, setUploadingVisit] = useState<string | null>(null);

  // The open trip is kept on its own as well: one opened from a notification
  // may fall outside the month the list is showing, and a list reload must
  // not blank the detail view.
  const [openTrip, setOpenTrip] = useState<VisitTrip | null>(null);
  const current = useMemo(() => trips.find((t) => t.id === currentId) || (openTrip?.id === currentId ? openTrip : null), [trips, currentId, openTrip]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { trips: rows } = await api.get<{ trips: VisitTrip[] }>(`/api/visit-trips${periode ? `?periode=${periode}` : ''}`);
      setTrips(rows);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat perjalanan', 'error');
    } finally {
      setLoading(false);
    }
  }, [periode, toast]);

  useEffect(() => {
    if (show) void load();
  }, [show, load]);

  useEffect(() => {
    if (!show) return;
    setView('list');
    // Opened from a notification: fetch that one trip (it may be outside the
    // month shown in the list) and go straight to its detail.
    const openId = useUiStore.getState().visitTripOpenId;
    if (!openId) return;
    useUiStore.setState({ visitTripOpenId: null });
    api
      .get<{ trip: VisitTrip }>(`/api/visit-trips/${openId}`)
      .then(({ trip }) => {
        upsertLocal(trip);
        openDetail(trip);
      })
      .catch((err) => toast(err instanceof Error ? err.message : 'Perjalanan tidak ditemukan', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const picOptions = useMemo(() => {
    const out: string[] = [];
    customers.forEach((c) => (c.pics || []).forEach((p) => p.nama && out.push(p.jabatan ? `${p.nama} (${p.jabatan})` : p.nama)));
    return Array.from(new Set(out)).sort();
  }, [customers]);

  const pending = useMemo(() => (currentUser ? trips.filter((t) => permE && canApproveTrip(currentUser, t)) : []), [trips, currentUser, permE]);

  function upsertLocal(trip: VisitTrip) {
    setOpenTrip(trip);
    setTrips((list) => (list.some((t) => t.id === trip.id) ? list.map((t) => (t.id === trip.id ? trip : t)) : [trip, ...list]));
  }

  function openNew() {
    setCurrentId(null);
    setCabang(tripCabangLocked(currentUser?.role) ? (currentUser?.cabang || '').toUpperCase() : '');
    const today = localToday();
    setTglBerangkat(today);
    setTglPulang(today);
    setKeperluan('');
    setPlanVisits([blankVisit()]);
    setPeserta([]);
    setView('edit');
  }

  function openEdit(t: VisitTrip) {
    setCurrentId(t.id);
    setCabang(t.cabang);
    setTglBerangkat(t.tglBerangkat);
    setTglPulang(t.tglPulang);
    setKeperluan(t.keperluan || '');
    setPlanVisits(t.visits.length ? t.visits.map((v) => ({ ...v })) : [blankVisit()]);
    setPeserta(Array.isArray(t.pesertaIds) ? t.pesertaIds : []);
    setView('edit');
  }

  function openDetail(t: VisitTrip) {
    setCurrentId(t.id);
    setRealVisits(t.visits.map((v) => ({ ...v })));
    setCatatan(t.catatanRealisasi || '');
    setApprovalNote('');
    setView('detail');
    setPhotos([]);
    api
      .get<{ photos: TripPhoto[] }>(`/api/visit-trips/${t.id}/photos`)
      .then(({ photos: rows }) => setPhotos(rows))
      .catch(() => {});
  }

  async function uploadPhotos(visitId: string, files: FileList | null) {
    if (!current || !files || files.length === 0) return;
    const room = TRIP_PHOTO_MAX_PER_VISIT - photos.filter((p) => p.visitId === visitId).length;
    if (room <= 0) return toast(`Maksimal ${TRIP_PHOTO_MAX_PER_VISIT} foto per kunjungan`, 'error');
    setUploadingVisit(visitId);
    try {
      for (const f of Array.from(files).slice(0, room)) {
        const fd = new FormData();
        fd.append('visitId', visitId);
        fd.append('file', await shrinkPhoto(f));
        const res = await fetch(`/api/visit-trips/${current.id}/photos`, { method: 'POST', body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Gagal mengunggah foto');
        setPhotos((list) => [...list, body.photo as TripPhoto]);
      }
      if (files.length > room) toast(`Hanya ${room} foto pertama yang diunggah (maks. ${TRIP_PHOTO_MAX_PER_VISIT} per kunjungan)`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengunggah foto', 'error');
    } finally {
      setUploadingVisit(null);
    }
  }

  async function deletePhoto(p: TripPhoto) {
    if (!current || !window.confirm(`Hapus foto "${p.name}"?`)) return;
    try {
      await api.del(`/api/visit-trips/${current.id}/photos/${p.id}`);
      setPhotos((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus foto', 'error');
    }
  }

  async function savePlan(submit: boolean) {
    const visits = planVisits.filter((v) => v.customer.trim() || v.tujuan.trim() || v.pic.trim());
    if (!cabang) return toast('Pilih cabang tujuan', 'error');
    if (!tglBerangkat || !tglPulang) return toast('Isi tanggal berangkat dan pulang', 'error');
    if (tglPulang < tglBerangkat) return toast('Tanggal pulang tidak boleh sebelum tanggal berangkat', 'error');
    if (visits.length === 0) return toast('Isi minimal satu kunjungan customer', 'error');
    const bad = visits.find((v) => !v.customer.trim() || !v.tujuan.trim());
    if (bad) return toast('Setiap kunjungan wajib diisi customer dan tujuan kunjungannya', 'error');
    setBusy(true);
    try {
      const payload = { cabang, tglBerangkat, tglPulang, keperluan, pesertaIds: peserta, visits: visits.map((v) => ({ ...v, id: v.id.startsWith('new-') ? '' : v.id })) };
      let { trip } = currentId ? await api.put<{ trip: VisitTrip }>(`/api/visit-trips/${currentId}`, payload) : await api.post<{ trip: VisitTrip }>('/api/visit-trips', payload);
      if (submit) ({ trip } = await api.post<{ trip: VisitTrip }>(`/api/visit-trips/${trip.id}/action`, { action: 'submit' }));
      upsertLocal(trip);
      toast(submit ? (trip.status === 'disetujui' ? 'Rencana perjalanan ditetapkan' : 'Rencana diajukan untuk persetujuan') : 'Draft tersimpan', 'success');
      openDetail(trip);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan rencana', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doAction(action: 'submit' | 'approve' | 'reject' | 'finish' | 'cancel', note?: string) {
    if (!current) return;
    if (action === 'reject' && !note?.trim()) return toast('Isi alasan penolakan di kolom catatan', 'error');
    if (action === 'cancel' && !window.confirm('Batalkan perjalanan ini?')) return;
    setBusy(true);
    try {
      const { trip } = await api.post<{ trip: VisitTrip }>(`/api/visit-trips/${current.id}/action`, { action, note });
      upsertLocal(trip);
      openDetail(trip);
      toast(`Status: ${TRIP_STATUS_META[trip.status].label}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memproses', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveRealisasi(thenFinish: boolean) {
    if (!current) return;
    const visits = realVisits.filter((v) => !v.tambahan || v.customer.trim() || v.realisasi.trim());
    if (visits.some((v) => v.tambahan && !v.customer.trim())) return toast('Kunjungan tambahan wajib diisi nama customer', 'error');
    if (thenFinish) {
      const blocker = finishBlocker(visits);
      if (blocker) return toast(blocker, 'error');
    }
    setBusy(true);
    try {
      let { trip } = await api.put<{ trip: VisitTrip }>(`/api/visit-trips/${current.id}`, {
        visits: visits.map((v) => ({ ...v, id: v.id.startsWith('new-') ? '' : v.id })),
        catatanRealisasi: catatan,
      });
      if (thenFinish) ({ trip } = await api.post<{ trip: VisitTrip }>(`/api/visit-trips/${trip.id}/action`, { action: 'finish' }));
      upsertLocal(trip);
      openDetail(trip);
      toast(thenFinish ? 'Perjalanan selesai' : 'Realisasi tersimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan realisasi', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!current || !window.confirm('Hapus draft perjalanan ini?')) return;
    setBusy(true);
    try {
      await api.del(`/api/visit-trips/${current.id}`);
      setTrips((list) => list.filter((t) => t.id !== current.id));
      setView('list');
      toast('Draft dihapus', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    } finally {
      setBusy(false);
    }
  }

  function onPrint(t: VisitTrip) {
    if (!printTrip(t, (m) => toast(m, 'error'))) toast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.', 'error');
  }

  const setPlan = (i: number, field: keyof TripVisit, value: string) => setPlanVisits((list) => list.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));
  const setReal = (i: number, field: keyof TripVisit, value: string) => setRealVisits((list) => list.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));

  const statusBadge = (t: VisitTrip) => <span className={`badge ${TRIP_STATUS_META[t.status].badge}`}>{TRIP_STATUS_META[t.status].label}</span>;

  const lists = (
    <>
      <datalist id="tripPics">
        {picOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );

  // ---------------------------------------------------------------- list
  const listView = (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 10 }}>
        <label style={{ margin: 0 }}>{tr("Bulan berangkat")}</label>
        <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setPeriode('')} disabled={!periode}>
          {tr("Semua bulan")}
        </button>
        {loading && <span className="field-note">{tr("Memuat…")}</span>}
        {canPlan && (
          <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={openNew}>
            <IconPlus /> {tr("Rencana Perjalanan")}
          </button>
        )}
      </div>

      {pending.length > 0 && (
        <div className="import-summary" style={{ marginTop: 0, marginBottom: 12 }}>
          <b>{pending.length} {tr("rencana menunggu persetujuan Anda:")}</b>{' '}
          {pending.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ' · '}
              <a href="#" onClick={(e) => (e.preventDefault(), openDetail(t))}>
                {t.ownerName} → {t.cabang} ({formatDateID(t.tglBerangkat)})
              </a>
            </span>
          ))}
        </div>
      )}

      {trips.length === 0 ? (
        <div className="empty-state">
          <h3>{tr("Belum ada perjalanan")}{periode ? tr(" pada bulan ini") : ''}</h3>
          {canPlan && <p>{tr("Klik \"Rencana Perjalanan\" untuk membuat rencana kunjungan ke customer di cabang.")}</p>}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>{tr("Tanggal")}</th>
                <th>{tr("Nama")}</th>
                <th>{tr("Cabang")}</th>
                <th>{tr("Keperluan")}</th>
                <th>{tr("Kunjungan")}</th>
                <th>{tr("Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const r = tripRealisasiRate(t.visits);
                return (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDateID(t.tglBerangkat)}
                      {t.tglPulang !== t.tglBerangkat && <div className="field-note">{tr("s/d")} {formatDateID(t.tglPulang)}</div>}
                    </td>
                    <td>
                      <b>{t.ownerName}</b> <span className="field-note" style={{ display: 'inline' }}>{ROLE_SHORT[t.ownerRole] || t.ownerRole}</span>
                    </td>
                    <td>{t.cabang}</td>
                    <td>{t.keperluan || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.planned} {tr("rencana")}
                      {(t.status === 'disetujui' || t.status === 'selesai') && (
                        <div className="field-note">
                          {r.done}/{r.planned} {tr("tercapai")}{r.extra ? ` · +${r.extra}` : ''}
                        </div>
                      )}
                    </td>
                    <td>{statusBadge(t)}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openDetail(t)}>
                          {tr("Buka")}
                        </button>
                        {canNow('trip', 'x') && (
                          <button type="button" className="btn btn-outline btn-sm" title={tr("Cetak laporan kunjungan (lampiran reimbursement)")} onClick={() => onPrint(t)}>
                            {tr("Cetak")}
                          </button>
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
    </>
  );

  // ---------------------------------------------------------------- plan form
  const editView = (
    <>
      {lists}
      <div className="form-grid">
        <div>
          <label>{tr("Cabang tujuan *")}</label>
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} disabled={tripCabangLocked(currentUser?.role)}>
            <option value="">{tr("— pilih cabang —")}</option>
            {CABANG_LIST.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label>{tr("Berangkat *")}</label>
            <input type="date" value={tglBerangkat} onChange={(e) => setTglBerangkat(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>{tr("Pulang *")}</label>
            <input type="date" value={tglPulang} min={tglBerangkat} onChange={(e) => setTglPulang(e.target.value)} />
          </div>
        </div>
        <div className="full">
          <label>{tr("Keperluan perjalanan")}</label>
          <input type="text" value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder={tr("cth. Review cabang & kunjungan key account Q4")} />
        </div>
        <div className="full">
          <label>{tr("Peserta perjalanan (selain Anda)")}</label>
          <UserPicker value={peserta} onChange={setPeserta} roster={roster} exclude={currentUser ? [currentUser.id] : []} placeholder={tr("+ Tambah peserta (pilih user)…")} />
          <div className="field-note" style={{ margin: 0 }}>{tr("Peserta diberi notifikasi saat perjalanan disetujui/dibatalkan dan bisa melihat perjalanan ini. Saat realisasi, pilih personil yang ikut ke tiap customer — kunjungan tercatat di Aktivitas Harian mereka.")}</div>
        </div>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 6px' }}>{tr("Rencana kunjungan customer")}</div>
      {planVisits.map((v, i) => (
        <div className="rfq-item-card" key={v.id || i}>
          <div className="rfq-item-head">
            <span>{tr("Kunjungan")} {i + 1}</span>
            <button type="button" className="icon-btn danger" title={tr("Hapus kunjungan")} disabled={planVisits.length === 1} onClick={() => setPlanVisits((list) => list.filter((_, idx) => idx !== i))}>
              <IconTrash />
            </button>
          </div>
          <div className="form-grid">
            <div>
              <label>{tr("Customer *")}</label>
              <CustomerNameInput value={v.customer} onChange={(val) => setPlan(i, 'customer', val)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}>
                <label>{tr("PIC yang ditemui")}</label>
                <input type="text" list="tripPics" value={v.pic} onChange={(e) => setPlan(i, 'pic', e.target.value)} placeholder={tr("Nama (Jabatan)")} />
              </div>
              <div style={{ flex: 1 }}>
                <label>{tr("Tanggal")}</label>
                <input type="date" value={v.tanggal} min={tglBerangkat} max={tglPulang} onChange={(e) => setPlan(i, 'tanggal', e.target.value)} />
              </div>
            </div>
            <div className="full">
              <label>{tr("Tujuan kunjungan *")}</label>
              <textarea value={v.tujuan} onChange={(e) => setPlan(i, 'tujuan', e.target.value)} placeholder={tr("cth. Negosiasi harga kontrak 2027, follow up penawaran SS304, keluhan delivery")} />
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setPlanVisits((list) => [...list, { ...blankVisit(), id: tmpId() }])}>
        <IconPlus /> {tr("Tambah kunjungan")}
      </button>
      <div className="field-note" style={{ marginTop: 8 }}>
        {isGmLevel(currentUser?.role) ? tr("Sebagai GM, rencana langsung berstatus Disetujui saat ditetapkan.") : `Setelah diajukan, rencana ini disetujui oleh ${approverLabel(currentUser?.role || '')}.`}
      </div>
    </>
  );

  // ---------------------------------------------------------------- detail
  let detailView = null;
  if (current && currentUser) {
    const editReal = (permE && canEditRealisasi(currentUser, current));
    const approve = (permE && canApproveTrip(currentUser, current));
    const isOwner = current.ownerId === currentUser.id;
    const r = tripRealisasiRate(editReal ? realVisits : current.visits);
    detailView = (
      <>
        {lists}
        <div className="import-summary" style={{ marginTop: 0, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
          <div>
            <b>{current.ownerName}</b> ({ROLE_SHORT[current.ownerRole] || current.ownerRole})
          </div>
          <div>
            {tr("Cabang tujuan:")} <b>{current.cabang}</b>
          </div>
          <div>
            {formatDateID(current.tglBerangkat)} {tr("s/d")} {formatDateID(current.tglPulang)}
          </div>
          <div>
            {statusBadge(current)} <span className="field-note" style={{ display: 'inline' }}>{tripDocNo(current)}</span>
          </div>
          {current.keperluan && <div style={{ gridColumn: '1 / -1' }}>{tr("Keperluan:")} {current.keperluan}</div>}
          {!!current.pesertaIds?.length && (
            <div style={{ gridColumn: '1 / -1' }}>
              {tr("Peserta:")} <b>{current.pesertaIds.map((id) => roster.find((u) => u.id === id)?.name || '(user)').join(', ')}</b>
            </div>
          )}
          {current.approverName && (
            <div style={{ gridColumn: '1 / -1' }}>
              {current.status === 'ditolak' ? tr("Ditolak") : tr("Disetujui")} {tr("oleh")} <b>{current.approverName}</b>
              {current.approvedAt ? ` · ${new Date(current.approvedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
              {current.approvalNote ? ` — "${current.approvalNote}"` : ''}
            </div>
          )}
          {(current.status === 'disetujui' || current.status === 'selesai') && (
            <div style={{ gridColumn: '1 / -1' }}>
              {tr("Realisasi:")} <b>{r.done}/{r.planned}</b> {tr("kunjungan rencana tercapai")}{r.extra ? ` · +${r.extra} di luar rencana` : ''}
            </div>
          )}
        </div>

        <div className="table-wrap">
          <table className="simple-table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>{tr("Customer")}</th>
                <th>PIC</th>
                <th>{tr("Tgl")}</th>
                <th>{tr("Tujuan kunjungan (rencana)")}</th>
                <th>{tr("Realisasi")}</th>
                <th>{tr("Hasil")}</th>
                <th title={tr("Personil yang ikut ke customer ini — kunjungan tercatat di Aktivitas Harian mereka")}>{tr("Personil ikut → Aktivitas Harian")}</th>
                {editReal && <th />}
              </tr>
            </thead>
            <tbody>
              {(editReal ? realVisits : current.visits).map((v, i) => (
                <tr key={v.id || i}>
                  <td>{i + 1}</td>
                  <td style={{ minWidth: 140 }}>
                    {editReal && v.tambahan ? (
                      <CustomerNameInput value={v.customer} onChange={(val) => setReal(i, 'customer', val)} placeholder={tr("Customer")} />
                    ) : (
                      <b>{v.customer}</b>
                    )}
                    {v.tambahan && <div className="field-note">{tr("di luar rencana")}</div>}
                  </td>
                  <td style={{ minWidth: 110 }}>
                    {editReal && v.tambahan ? <input type="text" list="tripPics" value={v.pic} onChange={(e) => setReal(i, 'pic', e.target.value)} placeholder="PIC" style={{ width: '100%' }} /> : v.pic || '-'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.tanggal ? formatDateID(v.tanggal) : '-'}</td>
                  <td style={{ minWidth: 180 }}>{v.tujuan}</td>
                  <td style={{ minWidth: 220 }}>
                    {editReal ? (
                      <textarea value={v.realisasi} onChange={(e) => setReal(i, 'realisasi', e.target.value)} placeholder={tr("Apa yang terjadi / hasil pembicaraan")} style={{ width: '100%', minHeight: 54 }} />
                    ) : (
                      v.realisasi || <span className="field-note">{tr("belum diisi")}</span>
                    )}
                  </td>
                  <td style={{ minWidth: 130 }}>
                    {editReal ? (
                      <select value={v.hasil} onChange={(e) => setReal(i, 'hasil', e.target.value)} style={{ width: '100%' }}>
                        <option value="">{tr("— pilih —")}</option>
                        {TRIP_HASIL.map((h) => (
                          <option key={h.key} value={h.key}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      TRIP_HASIL_LABEL[v.hasil] || '-'
                    )}
                  </td>
                  <td style={{ minWidth: 230 }}>
                    <PersonilCell trip={current} v={v} roster={roster} edit={editReal} onChange={(ids) => setRealVisits((list) => list.map((x, idx) => (idx === i ? { ...x, personilIds: ids } : x)))} />
                  </td>
                  {editReal && (
                    <td>
                      {v.tambahan && (
                        <button type="button" className="icon-btn danger" title={tr("Hapus")} onClick={() => setRealVisits((list) => list.filter((_, idx) => idx !== i))}>
                          <IconTrash />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editReal && (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setRealVisits((list) => [...list, { ...blankVisit(), id: tmpId(), tambahan: true }])}>
            <IconPlus /> {tr("Kunjungan di luar rencana")}
          </button>
        )}

        {(editReal || current.status === 'selesai' || current.visits.some((v) => (v.uraian || '').trim()) || photos.length > 0) && (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '16px 0 4px' }}>{tr("Uraian realisasi & foto kunjungan")}</div>
            <div className="field-note" style={{ marginBottom: 6 }}>{tr("Ceritakan suasana dan isi kunjungan secara rinci. Uraian dan foto tercetak sebagai lampiran laporan kunjungan.")}</div>
            {(editReal ? realVisits : current.visits).map((v, i) => {
              const vp = photos.filter((p) => p.visitId === v.id);
              const unsaved = !v.id || v.id.startsWith('new-');
              if (!editReal && !(v.uraian || '').trim() && vp.length === 0) return null;
              return (
                <div className="rfq-item-card" key={`u-${v.id || i}`}>
                  <div className="rfq-item-head">
                    <span>
                      {i + 1}. {v.customer || tr("(customer belum diisi)")}
                      {v.pic ? ` · ${v.pic}` : ''}
                    </span>
                    <span className="field-note" style={{ margin: 0 }}>
                      {vp.length} {tr("foto")}
                    </span>
                  </div>
                  {editReal ? (
                    <textarea
                      value={v.uraian || ''}
                      onChange={(e) => setReal(i, 'uraian', e.target.value)}
                      placeholder={tr("cth. Diterima Pak Rudi dan tim engineering di ruang meeting. Suasana terbuka; customer sedang mengevaluasi supplier tool steel karena masalah lead time pemasok lama. Kami presentasikan SKD11 & DC53, mereka minta sampel 2 grade dan penawaran untuk 3 bulan ke depan…")}
                      style={{ width: '100%', minHeight: 110 }}
                    />
                  ) : (
                    (v.uraian || '').trim() && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{v.uraian}</div>
                  )}
                  {(vp.length > 0 || editReal) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
                      {vp.map((p) => (
                        <div key={p.id} style={{ position: 'relative', width: 120 }}>
                          <a href={photoUrl(current.id, p.id)} target="_blank" rel="noreferrer" title={p.name}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photoUrl(current.id, p.id)} alt={p.name} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)', display: 'block' }} />
                          </a>
                          {editReal && permD && (
                            <button type="button" className="icon-btn danger" title={tr("Hapus foto")} onClick={() => deletePhoto(p)} style={{ position: 'absolute', top: 4, right: 4, background: '#fff' }}>
                              <IconTrash />
                            </button>
                          )}
                        </div>
                      ))}
                      {editReal &&
                        (unsaved ? (
                          <span className="field-note">{tr("Klik \"Simpan Realisasi\" dulu untuk menambah foto pada kunjungan baru ini.")}</span>
                        ) : (
                          vp.length < TRIP_PHOTO_MAX_PER_VISIT && (
                            <label className="btn btn-outline btn-sm" style={{ width: 120, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', margin: 0 }}>
                              {uploadingVisit === v.id ? tr("Mengunggah…") : tr("+ Foto")}
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                hidden
                                disabled={uploadingVisit !== null}
                                onChange={(e) => {
                                  void uploadPhotos(v.id, e.target.files);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {editReal && (
          <>
            <div style={{ marginTop: 10 }}>
              <label>{tr("Catatan realisasi")}</label>
              <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={tr("Ringkasan perjalanan, temuan di cabang, tindak lanjut")} style={{ width: '100%', minHeight: 54 }} />
            </div>
          </>
        )}
        {!editReal && current.catatanRealisasi && (
          <div className="import-summary" style={{ marginTop: 10 }}>
            <b>{tr("Catatan realisasi:")}</b> {current.catatanRealisasi}
          </div>
        )}

        {approve && (
          <div className="rfq-item-card" style={{ marginTop: 12, borderColor: 'var(--amber-600)' }}>
            <div className="rfq-item-head">
              <span>{tr("Persetujuan")}</span>
            </div>
            <label>{tr("Catatan (wajib bila ditolak)")}</label>
            <input type="text" value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} placeholder={tr("cth. Tambahkan kunjungan ke PT X")} style={{ width: '100%' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => doAction('approve', approvalNote)}>
                {tr("Setujui")}
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => doAction('reject', approvalNote)}>
                {tr("Tolak")}
              </button>
            </div>
          </div>
        )}
        {current.status === 'selesai' && (
          <div className="field-note" style={{ marginTop: 10 }}>
            {tr("Perjalanan selesai — klik")} <b>{tr("Cetak Laporan")}</b> {tr("untuk lampiran reimbursement ke Keuangan.")}
          </div>
        )}
        {isOwner && current.status === 'diajukan' && <div className="field-note" style={{ marginTop: 10 }}>{tr("Menunggu persetujuan")} {approverLabel(current.ownerRole)}{tr(". Realisasi dapat diisi setelah disetujui.")}</div>}
      </>
    );
  }

  // ---------------------------------------------------------------- footer
  let footer: React.ReactNode;
  if (view === 'list') {
    footer = (
      <button type="button" className="btn btn-outline" onClick={closeModal}>
        {tr("Tutup")}
      </button>
    );
  } else if (view === 'edit') {
    footer = (
      <>
        <button type="button" className="btn btn-outline" onClick={() => (current ? openDetail(current) : setView('list'))}>
          {tr("Batal")}
        </button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => savePlan(false)}>
          {tr("Simpan Draft")}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => savePlan(true)}>
          {isGmLevel(currentUser?.role) ? tr("Simpan & Tetapkan") : tr("Simpan & Ajukan")}
        </button>
      </>
    );
  } else if (current && currentUser) {
    const isOwner = current.ownerId === currentUser.id;
    footer = (
      <>
        <button type="button" className="btn btn-outline" onClick={() => setView('list')} style={{ marginRight: 'auto' }}>
          {tr("← Daftar")}
        </button>
        {canNow('trip', 'x') && (
          <button type="button" className={`btn ${current.status === 'selesai' ? 'btn-primary' : 'btn-outline'}`} onClick={() => onPrint(current)} title={tr("Laporan kunjungan untuk lampiran reimbursement ke Keuangan")}>
            {tr("Cetak Laporan")}
          </button>
        )}
        {isOwner && permD && current.status === 'draft' && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={deleteDraft}>
            {tr("Hapus Draft")}
          </button>
        )}
        {isOwner && permE && current.status !== 'selesai' && current.status !== 'batal' && current.status !== 'draft' && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => doAction('cancel')}>
            {tr("Batalkan")}
          </button>
        )}
        {(permE && canEditPlan(currentUser, current)) && (
          <>
            <button type="button" className="btn btn-outline" onClick={() => openEdit(current)}>
              {tr("Ubah Rencana")}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => doAction('submit')}>
              {isGmLevel(current.ownerRole) ? tr("Tetapkan") : tr("Ajukan")}
            </button>
          </>
        )}
        {(permE && canEditRealisasi(currentUser, current)) && (
          <>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => saveRealisasi(false)}>
              {tr("Simpan Realisasi")}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveRealisasi(true)}>
              {tr("Selesaikan Perjalanan")}
            </button>
          </>
        )}
      </>
    );
  }

  const title = view === 'edit' ? (currentId ? 'Ubah Rencana Perjalanan' : 'Rencana Perjalanan Baru') : view === 'detail' ? 'Detail Perjalanan' : 'Perjalanan Dinas';

  return (
    <Modal show={show} onClose={closeModal} title={title} xwide footer={footer}>
      {view === 'list' ? listView : view === 'edit' ? editView : detailView}
    </Modal>
  );
}

const up = (x: string | null | undefined) => (x || '').trim().toUpperCase();
/** Punya identitas Aktivitas Harian (semua role, lihat activityOwner). */
const ownsActivity = (u: RosterUser) => !!activityOwner(u);
const isField = (u: RosterUser) => u.role === 'sales' || u.role === 'bm';

/**
 * Personil yang ikut ke satu customer (pemilik + peserta + Sales/BM cabang
 * tujuan) dan pratinjau baris Aktivitas Harian yang akan tercatat.
 */
function PersonilCell({ trip, v, roster, edit, onChange }: { trip: VisitTrip; v: TripVisit; roster: RosterUser[]; edit: boolean; onChange: (ids: string[]) => void }) {
  const tr = useT();
  const peserta = Array.isArray(trip.pesertaIds) ? trip.pesertaIds : [];
  const base = [trip.ownerId, ...peserta];
  const local = roster.filter((u) => (u.role === 'sales' || u.role === 'bm') && up(u.cabang) === up(trip.cabang) && !base.includes(u.id)).map((u) => u.id);
  const options = [...base, ...local];
  const ikut = v.personilIds?.length ? v.personilIds : base;
  const users = ikut.map((id) => roster.find((u) => u.id === id)).filter((u): u is RosterUser => !!u);
  const owners = users.filter(ownsActivity);
  const others = (uid: string) => users.filter((u) => u.id !== uid).map((u) => u.name);
  const counts = !!v.realisasi.trim() && v.hasil !== 'batal';
  const name = (id: string) => roster.find((u) => u.id === id)?.name || (id === trip.ownerId ? trip.ownerName : '(user)');
  return (
    <div className="trip-personil">
      {edit ? (
        <div className="trip-personil-opts">
          {options.map((id) => {
            const on = ikut.includes(id);
            return (
              <button key={id} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => onChange(on ? ikut.filter((x) => x !== id) : [...ikut, id])}>
                {on ? '✓' : '+'} {name(id)}
              </button>
            );
          })}
        </div>
      ) : (
        <div>{ikut.map(name).join(', ') || '-'}</div>
      )}
      <div className="field-note" style={{ margin: '3px 0 0' }}>
        {!counts
          ? v.hasil === 'batal' ? tr("Tidak dicatat (tidak jadi dikunjungi).") : tr("Tercatat setelah realisasi diisi.")
          : `→ ${[
              ...owners.map((u) => `${u.name}${others(u.id).length ? ` (didampingi ${others(u.id).join(', ')})` : ''}`),
              ...(users.some(isField) ? [] : [`Sales pemilik customer di ${trip.cabang}${users.length ? ` (didampingi ${users.map((u) => u.name).join(', ')})` : ''}`]),
            ].join('; ')}`}
      </div>
    </div>
  );
}
