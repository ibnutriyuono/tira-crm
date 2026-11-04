import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { approvalView, canDecideMargin } from '@/lib/margin-server';
import { MARGIN_LEVEL_LABEL, asLevel } from '@/lib/margin-tier';
import { canSeeHpp } from '@/lib/roles';
import { notify } from '@/lib/notify';
import { emitCrmEvent } from '@/lib/socket';
import { logActivity } from '@/lib/activity';

/** Penyetuju (BM / RM / GM / VP sesuai tingkat) memutuskan: { action: 'setuju' | 'tolak', catatan }. Tolak wajib catatan. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const a = await prisma.marginApproval.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: 'Pengajuan tidak ditemukan' }, { status: 404 });
  if (!(await canDecideMargin(user, a))) return NextResponse.json({ error: `Margin ini perlu persetujuan ${MARGIN_LEVEL_LABEL[asLevel(a.level)]} atau di atasnya${a.level === 'bm' ? ' (BM cabangnya)' : a.level === 'rm' ? ' (RM regionalnya)' : ''}.` }, { status: 403 });
  if (a.status !== 'menunggu') return NextResponse.json({ error: 'Pengajuan ini sudah diputuskan.' }, { status: 409 });
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
  const action = String(b.action || '');
  const catatan = String(b.catatan || '').trim().slice(0, 500);
  if (action !== 'setuju' && action !== 'tolak') return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
  if (action === 'tolak' && catatan.length < 5) return NextResponse.json({ error: 'Tulis alasan penolakan.' }, { status: 400 });
  const fresh = await prisma.marginApproval.update({
    where: { id },
    data: { status: action === 'setuju' ? 'disetujui' : 'ditolak', decidedById: user.id, decidedByName: user.name, decisionNote: catatan || null, decidedAt: new Date() },
  });
  emitCrmEvent('marginApproval:updated', { id });
  await notify({
    userIds: [a.requestedById],
    type: 'margin_decided',
    entity: 'prospect',
    entityId: a.prospectId,
    title: `${action === 'setuju' ? '✓ Margin disetujui' : '✕ Margin ditolak'}: ${a.customer}`,
    message: `${user.name}${catatan ? ` — ${catatan}` : ''}. ${action === 'setuju' ? 'Surat Penawaran dengan harga tersebut sudah bisa diunduh / dikirim.' : 'Revisi harga lalu ajukan lagi bila perlu.'}`.slice(0, 300),
  });
  await logActivity({ user, action: 'status_change', entity: 'quotation', entityId: a.prospectId, summary: `${action === 'setuju' ? 'Menyetujui' : 'Menolak'} margin Surat Penawaran ${a.customer}${catatan ? ` — ${catatan}` : ''}` });
  return NextResponse.json({ approval: approvalView(fresh, canSeeHpp(user.role) ? true : user.role === 'bm' ? 'margin' : false) });
}
