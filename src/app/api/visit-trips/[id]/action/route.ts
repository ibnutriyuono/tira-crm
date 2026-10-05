import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { notifyTripChange } from '@/lib/visit-trip-notify';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import type { TripVisit } from '@/lib/types';
import { canApproveTrip, finishBlocker } from '@/lib/visit-trip';

/**
 * Status transitions: submit (owner, draft/ditolak -> diajukan; a GM's own
 * trip goes straight to disetujui), approve / reject (the approver, see
 * canApproveTrip), finish (owner, disetujui -> selesai once every visit has
 * realisasi), cancel (owner, anything not yet selesai).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const trip = await prisma.visitTrip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: 'Perjalanan tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = String(body?.action || '');
  const note = String(body?.note || '').trim().slice(0, 1000) || null;
  const isOwner = trip.ownerId === user.id;
  const deny = (msg: string) => NextResponse.json({ error: msg }, { status: 403 });
  const label = `perjalanan ${trip.ownerName} ke ${trip.cabang} (${trip.tglBerangkat})`;

  let data: Record<string, unknown>;
  let summary: string;
  switch (action) {
    case 'submit':
      if (!isOwner || (trip.status !== 'draft' && trip.status !== 'ditolak')) return deny('Hanya draft/ditolak milik sendiri yang dapat diajukan.');
      if (trip.ownerRole === 'gm') {
        data = { status: 'disetujui', submittedAt: new Date(), approverName: `${trip.ownerName} (GM)`, approvedAt: new Date(), approvalNote: null };
        summary = `Menetapkan ${label} (GM, tanpa persetujuan)`;
      } else {
        data = { status: 'diajukan', submittedAt: new Date(), approverName: null, approvedAt: null, approvalNote: null };
        summary = `Mengajukan ${label}`;
      }
      break;
    case 'approve':
    case 'reject':
      if (!canApproveTrip(user, { ...trip, ownerRole: trip.ownerRole as never })) return deny('Anda tidak berwenang menyetujui perjalanan ini.');
      if (action === 'reject' && !note) return NextResponse.json({ error: 'Isi alasan penolakan.' }, { status: 400 });
      data = { status: action === 'approve' ? 'disetujui' : 'ditolak', approverName: user.name || user.username, approvedAt: action === 'approve' ? new Date() : null, approvalNote: note };
      summary = `${action === 'approve' ? 'Menyetujui' : 'Menolak'} ${label}`;
      break;
    case 'finish': {
      if (!isOwner || trip.status !== 'disetujui') return deny('Hanya perjalanan disetujui milik sendiri yang dapat diselesaikan.');
      const blocker = finishBlocker(trip.visits as unknown as TripVisit[]);
      if (blocker) return NextResponse.json({ error: blocker }, { status: 400 });
      data = { status: 'selesai', finishedAt: new Date() };
      summary = `Menyelesaikan ${label}`;
      break;
    }
    case 'cancel':
      if (!isOwner || trip.status === 'selesai' || trip.status === 'batal') return deny('Perjalanan ini tidak dapat dibatalkan.');
      data = { status: 'batal', approvalNote: note ?? trip.approvalNote };
      summary = `Membatalkan ${label}`;
      break;
    default:
      return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
  }

  const updated = await prisma.visitTrip.update({ where: { id }, data });
  await logActivity({ user, action: 'status_change', entity: 'visitTrip', entityId: id, summary });

  // Notifications are best-effort: a failed notification must not undo or
  // fail a status change that has already been saved.
  try {
    await notifyTripChange(trip, updated.status, user.id, user.name || user.username, note);
  } catch (err) {
    console.error('[visit-trip] notify failed', err);
  }
  return NextResponse.json({ trip: updated });
}
