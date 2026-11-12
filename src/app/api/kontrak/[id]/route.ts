import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { logActivity } from '@/lib/activity';
import { notify } from '@/lib/notify';
import { jakartaToday } from '@/lib/followup-notify';
import { MARGIN_LEVEL_LABEL, asLevel } from '@/lib/margin-tier';
import { addMonths, defaultAkhir, type Kontrak, type KontrakApproval } from '@/lib/kontrak';
import {
  approverIds, canDecideKontrak, canEditKontrak, cleanKontrakInput, itemCreateData, kontrakRecipients, logKontrak, neededApprovals, nextNomor, realisasi, scopeFilter, selfApproves, toKontrak,
} from '@/lib/kontrak-server';
import type { SafeUser } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

async function load(user: SafeUser, id: string): Promise<Kontrak | NextResponse> {
  const row = await prisma.kontrak.findUnique({ where: { id }, include: { items: true } });
  if (!row) return NextResponse.json({ error: 'Kontrak tidak ditemukan' }, { status: 404 });
  const k = toKontrak(row);
  if (!(await scopeFilter(user))(k)) return NextResponse.json({ error: 'Kontrak di luar cakupan Anda' }, { status: 403 });
  return k;
}

const apprLabel = (a: KontrakApproval) => (a.jenis === 'pasokan' ? 'kesiapan pasokan (GM Operation)' : `diskon (${MARGIN_LEVEL_LABEL[asLevel(a.level)]})`);

/** Detail: kontrak + realisasi + PO terhubung + riwayat + hak user. */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'v');
  if (denied) return denied;
  const { id } = await params;
  const k = await load(user, id);
  if (k instanceof NextResponse) return k;
  const [r, logs, prev, next] = await Promise.all([
    realisasi([k]),
    prisma.kontrakLog.findMany({ where: { kontrakId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    k.prevId ? prisma.kontrak.findUnique({ where: { id: k.prevId }, select: { id: true, nomor: true } }) : null,
    prisma.kontrak.findFirst({ where: { prevId: id, status: { not: 'batal' } }, select: { id: true, nomor: true, status: true } }),
  ]);
  const re = r.get(id);
  const decide: Record<string, boolean> = {};
  for (const a of k.approvals) decide[a.jenis] = await canDecideKontrak(user, k, a);
  const need = ['draft', 'ditolak'].includes(k.status) ? await neededApprovals(k) : null;
  return NextResponse.json({
    kontrak: { ...k, real: re?.real, poCount: re?.poCount || 0, linkCount: re?.links.length || 0, nextId: next?.id || null, nextNomor: next?.nomor || null },
    links: re?.links || [],
    logs: logs.map((l) => ({ id: l.id, aksi: l.aksi, ket: l.ket, byName: l.byName, at: l.createdAt.toISOString() })),
    prev,
    next,
    need,
    canEdit: canEditKontrak(user, k) && !(await guard(user, 'kontrak', 'e')),
    canDelete: (user.role === 'admin' || (canEditKontrak(user, k) && k.createdById === user.id)) && k.status === 'draft' && !(await guard(user, 'kontrak', 'd')),
    canDecide: decide,
  });
}

/**
 * Ubah kontrak. Draft / ditolak: seluruh isi. Menunggu / aktif: hanya
 * cakupan & keterangan (entitas, cabang, no kontrak customer, TOP, franco,
 * catatan) — dicatat sebagai adendum. Harga & item yang berubah = ajukan ulang.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'e');
  if (denied) return denied;
  const { id } = await params;
  const k = await load(user, id);
  if (k instanceof NextResponse) return k;
  if (!canEditKontrak(user, k)) return NextResponse.json({ error: 'Kontrak diubah oleh Admin Sales cabangnya.' }, { status: 403 });
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const input = cleanKontrakInput(b);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  if (k.status === 'draft' || k.status === 'ditolak') {
    const { items, ...head } = input;
    const row = await prisma.$transaction(async (tx) => {
      await tx.kontrakItem.deleteMany({ where: { kontrakId: id } });
      return tx.kontrak.update({
        where: { id },
        data: { ...head, status: 'draft', approvals: [], level: null, maxDiscount: null, items: { create: itemCreateData(items) } },
        include: { items: true },
      });
    });
    await logKontrak(id, 'diubah', null, user.name);
    return NextResponse.json({ kontrak: toKontrak(row) });
  }
  if (k.status === 'batal') return NextResponse.json({ error: 'Kontrak sudah dibatalkan.' }, { status: 409 });
  // Adendum cakupan.
  const changes: string[] = [];
  const addE = input.entitas.filter((e) => !k.entitas.includes(e));
  const delE = k.entitas.filter((e) => !input.entitas.includes(e));
  const addC = input.cabangs.filter((c) => !k.cabangs.includes(c));
  const delC = k.cabangs.filter((c) => !input.cabangs.includes(c));
  if (addE.length) changes.push(`+ entitas ${addE.join(', ')}`);
  if (delE.length) changes.push(`− entitas ${delE.join(', ')}`);
  if (addC.length) changes.push(`+ cabang ${addC.join(', ')}`);
  if (delC.length) changes.push(`− cabang ${delC.join(', ')}`);
  const data: Prisma.KontrakUpdateInput = { entitas: input.entitas, cabangs: input.cabangs, noCustomer: input.noCustomer, top: input.top, franco: input.franco, catatan: input.catatan, skemaCatatan: input.skemaCatatan };
  const row = await prisma.kontrak.update({ where: { id }, data, include: { items: true } });
  await logKontrak(id, 'adendum', changes.join(' · ') || 'keterangan diperbarui', user.name);
  await logActivity({ user, action: 'update', entity: 'kontrak', entityId: id, summary: `Adendum kontrak ${k.nomor}${changes.length ? `: ${changes.join(' · ')}` : ''}` });
  return NextResponse.json({ kontrak: toKontrak(row) });
}

/**
 * Aksi: { action: 'ajukan' } · { action: 'setuju' | 'tolak', jenis: 'diskon' | 'pasokan', catatan }
 * · { action: 'batal', catatan } · { action: 'perpanjang' } (buat draft lanjutan, kembalikan id).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const k = await load(user, id);
  if (k instanceof NextResponse) return k;
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const action = String(b.action || '');
  const catatan = String(b.catatan || '').trim().slice(0, 500);

  if (action === 'ajukan') {
    if ((await guard(user, 'kontrak', 'e')) || !canEditKontrak(user, k)) return NextResponse.json({ error: 'Kontrak diajukan oleh Admin Sales cabangnya.' }, { status: 403 });
    if (k.status !== 'draft' && k.status !== 'ditolak') return NextResponse.json({ error: 'Hanya draft yang bisa diajukan.' }, { status: 409 });
    const need = await neededApprovals(k);
    if (need.missing.length) return NextResponse.json({ error: `Harga acuan belum ada untuk: ${need.missing.slice(0, 5).join('; ')}. Ambil dari jawaban RFQ / stok, atau isi manual.` }, { status: 400 });
    const now = new Date().toISOString();
    const approvals: KontrakApproval[] = [];
    if (need.level) approvals.push({ jenis: 'diskon', level: need.level, status: 'menunggu' });
    if (need.butuhPasokan) approvals.push({ jenis: 'pasokan', level: 'gmops', status: 'menunggu' });
    approvals.forEach((a) => {
      if (selfApproves(user, a)) Object.assign(a, { status: 'disetujui', byId: user.id, byName: user.name, note: 'diajukan oleh pemberi persetujuan', at: now });
    });
    const allOk = approvals.every((a) => a.status === 'disetujui');
    const row = await prisma.kontrak.update({
      where: { id },
      data: { status: allOk ? 'aktif' : 'menunggu', level: need.level, maxDiscount: need.maxDisc, butuhPasokan: need.butuhPasokan, approvals: approvals as unknown as Prisma.InputJsonValue },
      include: { items: true },
    });
    const pend = approvals.filter((a) => a.status === 'menunggu');
    await logKontrak(id, allOk ? 'aktif' : 'diajukan', pend.length ? `menunggu ${pend.map(apprLabel).join(' & ')}${need.maxDisc != null ? ` · diskon maks ${String(need.maxDisc).replace('.', ',')}%` : ''}` : need.maxDisc != null ? `diskon maks ${String(need.maxDisc).replace('.', ',')}% — tanpa persetujuan` : null, user.name);
    for (const a of pend) {
      await notify({
        userIds: await approverIds(k, a), type: 'kontrak_request', entity: 'kontrak', entityId: id,
        title: `Persetujuan ${a.jenis === 'pasokan' ? 'pasokan material baru' : 'diskon'} kontrak ${k.nomor}`,
        message: `${k.grupNama} · ${k.cabangs.join(', ')} · ${k.tglMulai} s.d. ${k.tglAkhir}${a.jenis === 'diskon' && need.maxDisc != null ? ` · diskon maks ${String(need.maxDisc).replace('.', ',')}%` : ''}. Diajukan ${user.name}.`.slice(0, 300),
      });
    }
    if (allOk) await logActivity({ user, action: 'status_change', entity: 'kontrak', entityId: id, summary: `Kontrak ${k.nomor} aktif` });
    return NextResponse.json({ kontrak: toKontrak(row) });
  }

  if (action === 'setuju' || action === 'tolak') {
    const jenis = String(b.jenis || 'diskon');
    const approvals = k.approvals.map((a) => ({ ...a }));
    const a = approvals.find((x) => x.jenis === jenis && x.status === 'menunggu');
    if (!a || k.status !== 'menunggu') return NextResponse.json({ error: 'Tidak ada persetujuan yang menunggu.' }, { status: 409 });
    if (!(await canDecideKontrak(user, k, a))) return NextResponse.json({ error: `Persetujuan ini untuk ${apprLabel(a)}.` }, { status: 403 });
    if (action === 'tolak' && catatan.length < 5) return NextResponse.json({ error: 'Tulis alasan penolakan.' }, { status: 400 });
    Object.assign(a, { status: action === 'setuju' ? 'disetujui' : 'ditolak', byId: user.id, byName: user.name, note: catatan || null, at: new Date().toISOString() });
    const allOk = approvals.every((x) => x.status === 'disetujui');
    const status = action === 'tolak' ? 'ditolak' : allOk ? 'aktif' : 'menunggu';
    const row = await prisma.kontrak.update({ where: { id }, data: { status, approvals: approvals as unknown as Prisma.InputJsonValue }, include: { items: true } });
    await logKontrak(id, action === 'setuju' ? `disetujui · ${a.jenis}` : `ditolak · ${a.jenis}`, catatan || null, user.name);
    const to = status === 'aktif' ? await kontrakRecipients(k) : [k.createdById];
    await notify({
      userIds: to, type: 'kontrak_decided', entity: 'kontrak', entityId: id,
      title: status === 'aktif' ? `✓ Kontrak ${k.nomor} aktif` : action === 'tolak' ? `✕ Kontrak ${k.nomor} ditolak` : `✓ ${apprLabel(a)} disetujui · ${k.nomor}`,
      message: `${k.grupNama} · ${user.name}${catatan ? ` — ${catatan}` : ''}${status === 'aktif' ? `. Berlaku ${k.tglMulai} s.d. ${k.tglAkhir}.` : action === 'tolak' ? '. Perbaiki lalu ajukan lagi.' : '. Menunggu persetujuan lain.'}`.slice(0, 300),
    });
    await logActivity({ user, action: 'status_change', entity: 'kontrak', entityId: id, summary: `${action === 'setuju' ? 'Menyetujui' : 'Menolak'} ${apprLabel(a)} kontrak ${k.nomor}` });
    return NextResponse.json({ kontrak: toKontrak(row) });
  }

  if (action === 'batal') {
    if ((await guard(user, 'kontrak', 'e')) || !canEditKontrak(user, k)) return NextResponse.json({ error: 'Kontrak dibatalkan oleh Admin Sales cabangnya.' }, { status: 403 });
    if (catatan.length < 5) return NextResponse.json({ error: 'Tulis alasan pembatalan.' }, { status: 400 });
    const row = await prisma.kontrak.update({ where: { id }, data: { status: 'batal' }, include: { items: true } });
    await logKontrak(id, 'dibatalkan', catatan, user.name);
    await logActivity({ user, action: 'status_change', entity: 'kontrak', entityId: id, summary: `Membatalkan kontrak ${k.nomor} — ${catatan}` });
    return NextResponse.json({ kontrak: toKontrak(row) });
  }

  if (action === 'perpanjang') {
    if ((await guard(user, 'kontrak', 'e')) || !canEditKontrak(user, k)) return NextResponse.json({ error: 'Perpanjangan dibuat oleh Admin Sales.' }, { status: 403 });
    const ex = await prisma.kontrak.findFirst({ where: { prevId: id, status: { not: 'batal' } }, select: { id: true } });
    if (ex) return NextResponse.json({ id: ex.id });
    const mulai = k.tglAkhir >= jakartaToday() ? addMonths(k.tglAkhir, 0) : jakartaToday();
    const start = new Date(Date.parse(`${mulai}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const nomor = await nextNomor(start);
    const row = await prisma.kontrak.create({
      data: {
        nomor, noCustomer: null, jenis: k.jenis, skemaHarga: k.skemaHarga, skemaCatatan: k.skemaCatatan, groupId: k.groupId, grupNama: k.grupNama, entitas: k.entitas, cabangs: k.cabangs,
        cabang: k.cabang, reg: k.reg, tglMulai: start, tglAkhir: defaultAkhir(start), top: k.top, franco: k.franco, catatan: null, prevId: k.id, createdById: user.id, createdByName: user.name,
        items: { create: itemCreateData(k.items.map(({ id: _id, ...it }) => ({ ...it, saldoQty: 0, saldoNilai: 0, saldoTgl: null, saldoKet: null, vendorBerlaku: null }))) },
      },
    });
    await logKontrak(row.id, 'dibuat', `perpanjangan dari ${k.nomor}`, user.name);
    await logKontrak(id, 'perpanjangan', `draft ${nomor}`, user.name);
    return NextResponse.json({ id: row.id });
  }
  return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
}

/** Hapus draft (pembuat / Admin). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'd');
  if (denied) return denied;
  const { id } = await params;
  const k = await load(user, id);
  if (k instanceof NextResponse) return k;
  if (k.status !== 'draft') return NextResponse.json({ error: 'Hanya draft yang bisa dihapus; kontrak lain dibatalkan.' }, { status: 409 });
  if (user.role !== 'admin' && !(canEditKontrak(user, k) && k.createdById === user.id)) return NextResponse.json({ error: 'Draft dihapus oleh pembuatnya.' }, { status: 403 });
  await prisma.kontrak.delete({ where: { id } });
  await logActivity({ user, action: 'delete', entity: 'kontrak', entityId: id, summary: `Menghapus draft kontrak ${k.nomor}` });
  return NextResponse.json({ ok: true });
}
