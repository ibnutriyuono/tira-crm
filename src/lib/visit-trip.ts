import type { Role, TripHasil, TripStatus, TripVisit, VisitTrip } from './types';

/**
 * Perjalanan dinas GM / RM / BM -- rules shared by the API and the modal.
 * Pure (no server imports) so both sides enforce the same thing.
 */

/** Photos per visit, and the formats accepted (what a phone camera produces, after client-side resize to JPEG). */
export const TRIP_PHOTO_MAX_PER_VISIT = 10;
export const TRIP_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const TRIP_ROLES: Role[] = ['gm', 'rm', 'bm'];

export const TRIP_STATUS_META: Record<TripStatus, { label: string; badge: string }> = {
  draft: { label: 'Draft', badge: 'slate' },
  diajukan: { label: 'Menunggu Persetujuan', badge: 'amber' },
  disetujui: { label: 'Disetujui', badge: 'steel' },
  ditolak: { label: 'Ditolak', badge: 'rust' },
  selesai: { label: 'Selesai', badge: 'green' },
  batal: { label: 'Batal', badge: 'slate' },
};

export const TRIP_HASIL: { key: Exclude<TripHasil, ''>; label: string }[] = [
  { key: 'tercapai', label: 'Tercapai' },
  { key: 'sebagian', label: 'Tercapai sebagian' },
  { key: 'tidak', label: 'Tidak tercapai' },
  { key: 'batal', label: 'Tidak jadi dikunjungi' },
];
export const TRIP_HASIL_LABEL: Record<string, string> = Object.fromEntries(TRIP_HASIL.map((h) => [h.key, h.label]));

type Actor = { id: string; role: Role | string; reg: number | null };

/** Who approves a trip by its owner's role: BM -> RM of the BM's region (or GM), RM -> GM, GM -> nobody. */
export function approverLabel(ownerRole: string): string {
  if (ownerRole === 'bm') return 'RM regional / GM';
  if (ownerRole === 'rm') return 'GM';
  return '-';
}

/**
 * `status` dan `ownerRole` di database bertipe TEXT, bukan enum Postgres, jadi
 * baris yang dibaca langsung lewat Prisma bertipe `string` dan tidak memenuhi
 * union `TripStatus`/`Role` milik VisitTrip di layer aplikasi. Helper izin di
 * bawah memakai bentuk yang dilebarkan ini dan membandingkan langsung ke
 * literalnya, supaya baris mentah dari Prisma maupun objek VisitTrip aplikasi
 * sama-sama diterima tanpa cast di setiap pemanggil.
 */
export interface TripAuthRow {
  ownerId: string;
  ownerRole: string;
  ownerReg: number | null;
  status: string;
}

export function canApproveTrip(user: Actor, trip: TripAuthRow): boolean {
  if (trip.status !== 'diajukan' || trip.ownerId === user.id) return false;
  if (user.role === 'gm' || user.role === 'admin') return trip.ownerRole === 'bm' || trip.ownerRole === 'rm';
  if (user.role === 'rm') return trip.ownerRole === 'bm' && user.reg != null && trip.ownerReg === user.reg;
  return false;
}

/** The plan (customers, purposes, dates) can only change before approval. */
export function canEditPlan(user: Actor, trip: Pick<TripAuthRow, 'ownerId' | 'status'>): boolean {
  return trip.ownerId === user.id && (trip.status === 'draft' || trip.status === 'ditolak');
}

/** Realisasi is filled by the owner once the trip is approved. */
export function canEditRealisasi(user: Actor, trip: Pick<TripAuthRow, 'ownerId' | 'status'>): boolean {
  return trip.ownerId === user.id && trip.status === 'disetujui';
}

function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

export function validateTripHeader(body: { cabang?: unknown; tglBerangkat?: unknown; tglPulang?: unknown }): string | null {
  const cabang = clip(body.cabang, 20);
  const a = clip(body.tglBerangkat, 10);
  const b = clip(body.tglPulang, 10);
  if (!cabang) return 'Cabang tujuan wajib diisi.';
  if (!isDate(a) || !isDate(b)) return 'Tanggal berangkat dan pulang wajib diisi.';
  if (b < a) return 'Tanggal pulang tidak boleh sebelum tanggal berangkat.';
  return null;
}

/**
 * Cleans the plan part of the visit list (customer, PIC, date, tujuan).
 * Realisasi fields are reset -- a plan being (re)written has not happened yet.
 */
export function normalizePlanVisits(raw: unknown, tglBerangkat: string, tglPulang: string, newId: () => string): { visits: TripVisit[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const visits: TripVisit[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const customer = clip(r?.customer, 150);
    const tujuan = clip(r?.tujuan, 1000);
    const pic = clip(r?.pic, 200);
    const tanggal = clip(r?.tanggal, 10);
    if (!customer && !tujuan && !pic) continue;
    if (!customer) return { error: 'Setiap kunjungan wajib diisi nama customer.' };
    if (!tujuan) return { error: `Tujuan kunjungan ke "${customer}" wajib diisi.` };
    if (tanggal && (!isDate(tanggal) || tanggal < tglBerangkat || tanggal > tglPulang)) {
      return { error: `Tanggal kunjungan ke "${customer}" harus di antara tanggal berangkat dan pulang.` };
    }
    visits.push({ id: clip(r?.id, 40) || newId(), customer, pic, tanggal, tujuan, realisasi: '', uraian: '', hasil: '', tambahan: false });
  }
  if (visits.length === 0) return { error: 'Isi minimal satu kunjungan customer.' };
  if (visits.length > 50) return { error: 'Maksimal 50 kunjungan per perjalanan.' };
  return { visits };
}

/**
 * Merges realisasi input onto the approved plan. Planned visits keep their
 * customer/tujuan from the stored copy (the approved plan can't be rewritten
 * here); only realisasi/hasil change. New rows become `tambahan` visits.
 */
export function mergeRealisasi(stored: TripVisit[], raw: unknown, newId: () => string): { visits: TripVisit[] } | { error: string } {
  const incoming = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
  const byId = new Map(incoming.map((r) => [clip(r?.id, 40), r]));
  const hasilOk = (h: string): h is TripHasil => h === '' || TRIP_HASIL.some((x) => x.key === h);

  const out: TripVisit[] = [];
  for (const v of stored) {
    const r = byId.get(v.id);
    if (!r && v.tambahan) continue; // an added visit removed again
    const hasil = clip(r?.hasil ?? v.hasil, 20);
    if (!hasilOk(hasil)) return { error: 'Hasil kunjungan tidak valid.' };
    out.push({ ...v, realisasi: clip(r?.realisasi ?? v.realisasi, 2000), uraian: clip(r?.uraian ?? v.uraian, 10000), hasil, pic: v.tambahan ? clip(r?.pic ?? v.pic, 200) : v.pic });
  }
  const storedIds = new Set(stored.map((v) => v.id));
  for (const r of incoming) {
    const id = clip(r?.id, 40);
    if (id && storedIds.has(id)) continue;
    const customer = clip(r?.customer, 150);
    const realisasi = clip(r?.realisasi, 2000);
    if (!customer && !realisasi) continue;
    if (!customer) return { error: 'Kunjungan tambahan wajib diisi nama customer.' };
    const hasil = clip(r?.hasil, 20);
    if (!hasilOk(hasil)) return { error: 'Hasil kunjungan tidak valid.' };
    out.push({ id: newId(), customer, pic: clip(r?.pic, 200), tanggal: clip(r?.tanggal, 10), tujuan: clip(r?.tujuan, 1000) || '(di luar rencana)', realisasi, uraian: clip(r?.uraian, 10000), hasil, tambahan: true });
  }
  return { visits: out };
}

/** A trip can be closed once every visit has a hasil and a realisasi note. */
export function finishBlocker(visits: TripVisit[]): string | null {
  const open = visits.filter((v) => !v.hasil || !v.realisasi.trim());
  if (open.length === 0) return null;
  return `Lengkapi realisasi & hasil untuk: ${open.map((v) => v.customer).join(', ')}.`;
}

export function tripRealisasiRate(visits: TripVisit[]): { planned: number; done: number; extra: number } {
  const planned = visits.filter((v) => !v.tambahan);
  return {
    planned: planned.length,
    done: planned.filter((v) => v.hasil === 'tercapai' || v.hasil === 'sebagian').length,
    extra: visits.length - planned.length,
  };
}

const ROLE_LABEL: Record<string, string> = { gm: 'General Manager', rm: 'Regional Manager', bm: 'Branch Manager' };

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function tgl(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Reference number printed on the report, stable per trip: PD/<CABANG>/<YYYYMM>/<last 6 of id>. */
export function tripDocNo(trip: Pick<VisitTrip, 'id' | 'cabang' | 'tglBerangkat'>): string {
  return `PD/${trip.cabang}/${trip.tglBerangkat.slice(0, 7).replace('-', '')}/${trip.id.slice(-6).toUpperCase()}`;
}

function dayCount(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86400000) + 1 : 1;
}

/**
 * "Laporan Kunjungan Customer" -- the printed visit report attached to a
 * travel reimbursement claim for Finance (A4 landscape). It is proof of the
 * trip: who went where and when, who approved it, and what each planned
 * customer visit achieved. Costs are claimed on Finance's own form.
 *
 * Only a finished trip ("Selesai") is a final report; any other status
 * prints with a clear "BELUM FINAL" banner so Finance can't mistake a
 * plan for a completed trip.
 */
export function buildTripPrintHtml(trip: VisitTrip, photos: { visitId: string; src: string; name: string }[] = []): string {
  const rate = tripRealisasiRate(trip.visits);
  const final = trip.status === 'selesai';
  const rows = trip.visits
    .map(
      (v, i) => `<tr>
  <td class="c">${i + 1}</td>
  <td class="c nw">${esc(tgl(v.tanggal))}</td>
  <td><b>${esc(v.customer)}</b>${v.tambahan ? '<div class="tag">di luar rencana</div>' : ''}</td>
  <td>${esc(v.pic)}</td>
  <td>${esc(v.tujuan)}</td>
  <td class="real">${esc(v.realisasi)}</td>
  <td class="c">${esc(TRIP_HASIL_LABEL[v.hasil] || '')}</td>
</tr>`,
    )
    .join('');
  const approved = trip.approvedAt
    ? `<b>${esc(trip.approverName)}</b><br><small>${esc(tgl(trip.approvedAt))}</small>`
    : '<small>(belum disetujui)</small>';
  const banner = final
    ? ''
    : `<div class="banner">BELUM FINAL — status perjalanan: ${esc(TRIP_STATUS_META[trip.status].label)}. Laporan untuk reimbursement dicetak setelah perjalanan berstatus Selesai.</div>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Laporan Kunjungan ${esc(tripDocNo(trip))} - ${esc(trip.ownerName)}</title>
<style>
@page{size:A4 landscape;margin:12mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0}
h1{font-size:16px;margin:0 0 2px;letter-spacing:.03em}
.sub{color:#444}
.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:10px}
.docno{text-align:right;font-size:11px}
.docno b{font-size:12px}
.banner{border:2px dashed #b00;color:#b00;font-weight:bold;padding:6px 8px;margin-bottom:10px;text-align:center}
table{width:100%;border-collapse:collapse}
.info td{padding:3px 6px;vertical-align:top}
.info td:first-child,.info td:nth-child(3){width:120px;color:#444}
.visits{margin-top:10px}
.visits th,.visits td{border:1px solid #444;padding:5px;vertical-align:top}
.visits th{background:#e8e8e8;font-size:10px;text-transform:uppercase}
.visits td.real{min-width:200px;height:40px}
.c{text-align:center}
.nw{white-space:nowrap}
.tag{font-size:9px;color:#8a4b00;font-style:italic}
.note{margin-top:8px;border:1px solid #444;padding:6px;min-height:32px}
.decl{margin-top:10px;font-size:10.5px}
.sign{display:flex;gap:16px;margin-top:10px;page-break-inside:avoid}
.sign div{flex:1;border:1px solid #444;height:100px;padding:6px;display:flex;flex-direction:column;justify-content:space-between;text-align:center}
.sign small{color:#555}
.foot{margin-top:8px;color:#777;font-size:9px;display:flex;justify-content:space-between}
.lampiran{page-break-before:always}
.lampiran h2{font-size:14px;margin:0 0 2px}
.lv{border:1px solid #444;margin-top:10px;page-break-inside:avoid}
.lv-head{background:#e8e8e8;padding:5px 8px;display:flex;justify-content:space-between;gap:12px;font-size:11px}
.lv-body{padding:8px}
.uraian{white-space:pre-wrap;line-height:1.5;font-size:11px}
.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.photos figure{margin:0;border:1px solid #bbb;padding:3px;page-break-inside:avoid}
.photos img{width:100%;height:58mm;object-fit:cover;display:block}
.photos figcaption{font-size:8.5px;color:#555;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
@media screen{body{padding:16px;max-width:1100px;margin:auto}}
</style></head><body>
<div class="head"><div><h1>LAPORAN KUNJUNGAN CUSTOMER</h1>
<div class="sub">Lampiran Reimbursement Perjalanan Dinas · PT Tira Austenite · Steel Division</div></div>
<div class="docno">No. <b>${esc(tripDocNo(trip))}</b><br>Status: <b>${esc(TRIP_STATUS_META[trip.status].label)}</b></div></div>
${banner}
<table class="info">
<tr><td>Nama pemohon</td><td><b>${esc(trip.ownerName)}</b> — ${esc(ROLE_LABEL[trip.ownerRole] || trip.ownerRole)}${trip.ownerCabang ? ` (${esc(trip.ownerCabang)})` : ''}</td>
<td>Cabang tujuan</td><td><b>${esc(trip.cabang)}</b>${trip.reg != null ? ` · Regional ${esc(trip.reg)}` : ''}</td></tr>
<tr><td>Tanggal perjalanan</td><td>${esc(tgl(trip.tglBerangkat))} s/d ${esc(tgl(trip.tglPulang))} (${dayCount(trip.tglBerangkat, trip.tglPulang)} hari)</td>
<td>Disetujui</td><td>${trip.approvedAt ? `${esc(trip.approverName)}, ${esc(tgl(trip.approvedAt))}` : '-'}</td></tr>
<tr><td>Keperluan</td><td>${esc(trip.keperluan || '-')}</td>
<td>Hasil kunjungan</td><td>${rate.done} dari ${rate.planned} kunjungan rencana tercapai${rate.extra ? `, +${rate.extra} di luar rencana` : ''}${trip.finishedAt ? ` · selesai ${esc(tgl(trip.finishedAt))}` : ''}</td></tr>
</table>
<table class="visits"><thead><tr><th style="width:26px">No</th><th style="width:78px">Tanggal</th><th style="width:16%">Customer</th><th style="width:12%">PIC</th>
<th style="width:21%">Tujuan Kunjungan</th><th>Realisasi / Hasil Pembicaraan</th><th style="width:88px">Hasil</th></tr></thead><tbody>${rows}</tbody></table>
<div class="note"><b>Catatan / tindak lanjut:</b> ${esc(trip.catatanRealisasi || '')}</div>
${trip.approvalNote ? `<div class="note"><b>Catatan atasan:</b> ${esc(trip.approvalNote)}</div>` : ''}
<div class="decl">Saya menyatakan bahwa kunjungan di atas benar telah dilaksanakan dalam rangka perjalanan dinas sesuai rencana yang disetujui.</div>
<div class="sign">
<div><small>Pemohon</small><span><b>${esc(trip.ownerName)}</b><br><small>${esc(ROLE_LABEL[trip.ownerRole] || '')}</small></span></div>
<div><small>Disetujui atasan (${esc(approverLabel(trip.ownerRole))})</small><span>${trip.ownerRole === 'gm' ? '<small>—</small>' : approved}</span></div>
<div><small>Diterima Keuangan</small><span><small>Nama &amp; tanggal</small></span></div>
</div>
<div class="foot"><span>Dicetak dari TIRA CRM · ${esc(new Date().toLocaleString('id-ID'))}</span><span>${esc(tripDocNo(trip))}</span></div>
${buildLampiran(trip, photos)}
<script>window.onload=function(){window.print()}</script>
</body></html>`;
}

/**
 * "Lampiran -- Uraian Realisasi Kunjungan": one block per visit that has a
 * detailed narrative or photos, on its own page after the report. Visits
 * with neither are listed as such rather than silently dropped, so Finance
 * sees the attachment covers every visit.
 */
function buildLampiran(trip: VisitTrip, photos: { visitId: string; src: string; name: string }[]): string {
  const withContent = trip.visits.filter((v) => (v.uraian || '').trim() || photos.some((p) => p.visitId === v.id));
  if (withContent.length === 0) return '';
  const blocks = trip.visits
    .map((v, i) => {
      const ph = photos.filter((p) => p.visitId === v.id);
      const ur = (v.uraian || '').trim();
      const head = `<div class="lv-head"><span><b>${i + 1}. ${esc(v.customer)}</b>${v.pic ? ` · ${esc(v.pic)}` : ''}${v.tambahan ? ' · <i>di luar rencana</i>' : ''}</span><span>${esc(tgl(v.tanggal))}${v.hasil ? ` · ${esc(TRIP_HASIL_LABEL[v.hasil] || '')}` : ''}</span></div>`;
      if (!ur && ph.length === 0) return `<div class="lv">${head}<div class="lv-body"><small>Tidak ada uraian/foto.</small></div></div>`;
      const imgs = ph.length
        ? `<div class="photos">${ph.map((p, k) => `<figure><img src="${esc(p.src)}" alt="Foto ${k + 1}"><figcaption>Foto ${k + 1} — ${esc(p.name)}</figcaption></figure>`).join('')}</div>`
        : '';
      return `<div class="lv">${head}<div class="lv-body">${ur ? `<div class="uraian">${esc(ur)}</div>` : ''}${imgs}</div></div>`;
    })
    .join('');
  return `<div class="lampiran">
<div class="head"><div><h2>LAMPIRAN — URAIAN REALISASI &amp; FOTO KUNJUNGAN</h2>
<div class="sub">${esc(trip.ownerName)} · ${esc(trip.cabang)} · ${esc(tgl(trip.tglBerangkat))} s/d ${esc(tgl(trip.tglPulang))}</div></div>
<div class="docno">No. <b>${esc(tripDocNo(trip))}</b></div></div>
${blocks}
<div class="foot"><span>Lampiran laporan kunjungan</span><span>${esc(tripDocNo(trip))}</span></div>
</div>`;
}
