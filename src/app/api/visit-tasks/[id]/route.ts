import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser, resolveProspectScope } from '@/lib/api-helpers';
import { parseActivityExtras } from '@/lib/activity-contact-server';
import { syncCustomerPics } from '@/lib/customer-sync';
import { jakartaToday } from '@/lib/followup-notify';
import { notify } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { activityOwner, normalizeActivityPics, validTanggal } from '@/lib/sales-activity';
import { emitCrmEvent } from '@/lib/socket';
import type { VisitReschedule } from '@/lib/visit-task';
import { bmIdsOf, canAssignTo } from '@/lib/visit-task-server';
import { isGmLevel } from '@/lib/roles';

/**
 * Satu tugas kunjungan.
 *   lapor       (Sales): { tanggal, keterangan, pics[{nama,jabatan}], langkah?, lat?, lng? }
 *                → Aktivitas Harian "kunjungan" (sumber "tugas") + status dilaporkan
 *   jadwal_ulang (Sales): { dueDate, alasan } — alasan wajib, penugas diberi tahu
 *   batal       (penugas / BM / GM): { alasan }
 *   ubah        (penugas / BM / GM): { dueDate?, tujuan?, catatan? }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const t = await prisma.visitTask.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'Tugas tidak ditemukan' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(b.action || '');
  const mine = t.assigneeId === user.id;
  const assignee = await prisma.user.findUnique({ where: { id: t.assigneeId }, select: { role: true, cabang: true, se: true } });
  const boss = t.assignedById === user.id || (!!assignee && canAssignTo(user, assignee));
  if (t.status !== 'ditugaskan') return NextResponse.json({ error: 'Tugas ini sudah ditutup.' }, { status: 409 });

  if (action === 'lapor') {
    if (!mine) return NextResponse.json({ error: 'Laporan diisi oleh Sales yang ditugaskan.' }, { status: 403 });
    const tanggal = validTanggal(b.tanggal);
    if (!tanggal) return NextResponse.json({ error: 'Tanggal kunjungan tidak valid (tidak boleh lebih dari hari ini).' }, { status: 400 });
    const keterangan = String(b.keterangan || '').trim();
    if (keterangan.length < 5) return NextResponse.json({ error: 'Tulis hasil kunjungan (min. 5 karakter).' }, { status: 400 });
    const picRes = normalizeActivityPics(b.pics);
    if ('error' in picRes) return NextResponse.json({ error: picRes.error }, { status: 400 });
    if (!picRes.pics.length) return NextResponse.json({ error: 'Isi minimal satu PIC yang ditemui (nama & jabatan).' }, { status: 400 });
    const ex = parseActivityExtras(b, 'kunjungan', tanggal, picRes.pics);
    if ('error' in ex) return NextResponse.json({ error: ex.error }, { status: 400 });
    const { followUp, ...extraCols } = ex.extras;
    void followUp;
    const { reg, cabang } = await resolveProspectScope(user, null);
    const act = await prisma.salesActivity.create({
      data: {
        tanggal,
        se: activityOwner(user) as string,
        cabang: cabang || null,
        reg,
        tipe: 'kunjungan',
        customer: t.customer,
        keterangan: `${keterangan}`.slice(0, 1000),
        pics: picRes.pics as unknown as Prisma.InputJsonValue,
        prospectId: t.prospectId,
        sumber: 'tugas',
        refNo: t.id,
        ...extraCols,
        createdBy: user.name,
      },
    });
    const done = await prisma.visitTask.update({ where: { id }, data: { status: 'dilaporkan', activityId: act.id, hasil: keterangan.slice(0, 500), reportedAt: new Date() } });
    emitCrmEvent('visitTask:updated', { id: done.id });
    await syncCustomerPics(user, [{ customer: t.customer, pics: picRes.pics, cabang }], 'Tugas Kunjungan');
    await notify({ userIds: [t.assignedById], type: 'visit_update', entity: 'visitTask', entityId: id, title: `Kunjungan dilaporkan: ${t.customer}`, message: `${user.name} (${tanggal}): ${keterangan}`.slice(0, 300) });
    await logActivity({ user, action: 'create', entity: 'salesActivity', entityId: act.id, summary: `Melaporkan tugas kunjungan ke "${t.customer}" (${tanggal})` });
    return NextResponse.json({ task: done, activity: act });
  }

  if (action === 'jadwal_ulang') {
    if (!mine && !boss) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
    const dueDate = String(b.dueDate || '');
    const alasan = String(b.alasan || '').trim().slice(0, 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < jakartaToday()) return NextResponse.json({ error: 'Tanggal baru tidak valid.' }, { status: 400 });
    if (dueDate === t.dueDate) return NextResponse.json({ error: 'Tanggal baru sama dengan tenggat sekarang.' }, { status: 400 });
    if (alasan.length < 5) return NextResponse.json({ error: 'Alasan jadwal ulang wajib diisi.' }, { status: 400 });
    const log: VisitReschedule[] = [...((t.reschedules as unknown as VisitReschedule[]) || []), { at: new Date().toISOString(), from: t.dueDate, to: dueDate, alasan, by: user.name }];
    const u = await prisma.visitTask.update({ where: { id }, data: { dueDate, reschedules: log as unknown as Prisma.InputJsonValue } });
    emitCrmEvent('visitTask:updated', { id: u.id });
    await notify({
      userIds: mine ? [t.assignedById, ...(isGmLevel(t.assignedByRole) ? await bmIdsOf(t.cabang) : [])] : [t.assigneeId],
      type: 'visit_update',
      entity: 'visitTask',
      entityId: id,
      title: `Kunjungan dijadwal ulang: ${t.customer}`,
      message: `${user.name}: ${t.dueDate} → ${dueDate}. Alasan: ${alasan}`,
    });
    return NextResponse.json({ task: u });
  }

  if (action === 'batal' || action === 'ubah') {
    if (!boss) return NextResponse.json({ error: 'Hanya penugas / BM / GM.' }, { status: 403 });
    if (action === 'batal') {
      const alasan = String(b.alasan || '').trim().slice(0, 300);
      if (alasan.length < 3) return NextResponse.json({ error: 'Alasan pembatalan wajib.' }, { status: 400 });
      const u = await prisma.visitTask.update({ where: { id }, data: { status: 'dibatalkan', cancelReason: alasan } });
      emitCrmEvent('visitTask:updated', { id: u.id });
      await notify({ userIds: [t.assigneeId], type: 'visit_update', entity: 'visitTask', entityId: id, title: `Tugas kunjungan dibatalkan: ${t.customer}`, message: `${user.name}: ${alasan}` });
      return NextResponse.json({ task: u });
    }
    const data: Record<string, unknown> = {};
    if (b.tujuan) data.tujuan = String(b.tujuan).trim().slice(0, 200);
    if (b.catatan !== undefined) data.catatan = String(b.catatan || '').trim().slice(0, 500) || null;
    if (b.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate))) data.dueDate = String(b.dueDate);
    const u = await prisma.visitTask.update({ where: { id }, data });
    emitCrmEvent('visitTask:updated', { id: u.id });
    return NextResponse.json({ task: u });
  }
  return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
}
