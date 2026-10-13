import { NextResponse } from 'next/server';
import { diffFields, logActivity, PROSPECT_FIELD_LABELS } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { canSetFaktur } from '@/lib/roles';
import { emitCrmEvent } from '@/lib/socket';
import { guard } from '@/lib/permissions-server';

/**
 * Tandai terfaktur massal (Antrian Admin): { ids, tglFaktur, noFaktur? }.
 * Hanya DO (status 5) dalam cakupan pemanggil; noFaktur berlaku untuk semua
 * yang dipilih (satu faktur gabungan) bila diisi.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'faktur', 'e');
  if (denied) return denied;
  if (!canSetFaktur(user.role)) return NextResponse.json({ error: 'Status faktur diisi oleh Admin Sales / BM.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? Array.from(new Set((body.ids as unknown[]).map(String))).slice(0, 200) : [];
  const tglFaktur = String(body?.tglFaktur || '');
  const noFaktur = String(body?.noFaktur || '').trim().slice(0, 60) || null;
  if (!ids.length) return NextResponse.json({ error: 'Pilih minimal satu DO' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tglFaktur)) return NextResponse.json({ error: 'Tanggal faktur wajib diisi' }, { status: 400 });

  const updated = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const scoped = await assertProspectInScope(user, id);
    if (scoped.error || Number(scoped.existing.status) !== 5) {
      skipped.push(id);
      continue;
    }
    const prospect = await prisma.prospect.update({ where: { id }, data: { terfaktur: true, tglFaktur, noFaktur: noFaktur ?? scoped.existing.noFaktur ?? null } });
    emitCrmEvent('prospect:updated', prospect);
    await logActivity({
      user,
      action: 'update',
      entity: 'prospect',
      entityId: id,
      summary: `Menandai DO "${prospect.customer}" terfaktur ${tglFaktur}${noFaktur ? ` (${noFaktur})` : ''}${prospect.se ? ` — SE ${prospect.se}` : ''}`,
      changes: diffFields(scoped.existing, prospect, PROSPECT_FIELD_LABELS),
    });
    updated.push(prospect);
  }
  return NextResponse.json({ prospects: updated, skipped });
}
