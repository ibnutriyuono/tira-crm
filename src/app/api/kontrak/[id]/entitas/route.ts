import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { logActivity } from '@/lib/activity';
import { cabUp, customerInKontrak } from '@/lib/kontrak';
import { canEditKontrak, logKontrak, scopeFilter, toKontrak } from '@/lib/kontrak-server';

/**
 * Tautkan customer ke kontrak yang ada (dari Kelola Customer): { customer, cabang?, tambahCabang }.
 * Menambah entitas (dan cabangnya bila diminta) — adendum cakupan, harga & qty tidak berubah.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'e');
  if (denied) return denied;
  const { id } = await params;
  const row = await prisma.kontrak.findUnique({ where: { id }, include: { items: true } });
  if (!row) return NextResponse.json({ error: 'Kontrak tidak ditemukan' }, { status: 404 });
  const k = toKontrak(row);
  if (!(await scopeFilter(user))(k) || !canEditKontrak(user, k)) return NextResponse.json({ error: 'Kontrak diubah oleh Admin Sales cabangnya.' }, { status: 403 });
  if (!['aktif', 'draft', 'menunggu'].includes(k.status)) return NextResponse.json({ error: 'Kontrak tidak aktif.' }, { status: 409 });
  const b = ((await req.json().catch(() => null)) || {}) as { customer?: string; cabang?: string; tambahCabang?: boolean };
  const name = String(b.customer || '').trim().slice(0, 200);
  if (!name) return NextResponse.json({ error: 'Customer kosong' }, { status: 400 });
  const entitas = customerInKontrak(k, name) ? k.entitas : [...k.entitas, name];
  const cab = cabUp(b.cabang);
  const cabangs = b.tambahCabang && cab && !k.cabangs.includes(cab) ? [...k.cabangs, cab] : k.cabangs;
  await prisma.kontrak.update({ where: { id }, data: { entitas, cabangs } });
  const ket = [entitas.length > k.entitas.length ? `+ entitas ${name}` : '', cabangs.length > k.cabangs.length ? `+ cabang ${cab}` : ''].filter(Boolean).join(' · ') || 'tidak ada perubahan';
  await logKontrak(id, 'adendum', ket, user.name);
  await logActivity({ user, action: 'update', entity: 'kontrak', entityId: id, summary: `Adendum kontrak ${k.nomor}: ${ket}` });
  return NextResponse.json({ ok: true });
}
