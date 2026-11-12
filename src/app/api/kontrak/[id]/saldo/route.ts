import { NextResponse } from 'next/server';
import { isResponse, requireUser, num } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';
import { canEditKontrak, logKontrak, scopeFilter, toKontrak } from '@/lib/kontrak-server';

/** Realisasi awal per item: { items: [{ id, saldoQty, saldoNilai, saldoTgl, saldoKet }] }. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'e');
  if (denied) return denied;
  const { id } = await params;
  const row = await prisma.kontrak.findUnique({ where: { id }, include: { items: true } });
  if (!row) return NextResponse.json({ error: 'Kontrak tidak ditemukan' }, { status: 404 });
  const k = toKontrak(row);
  if (!(await scopeFilter(user))(k) || !canEditKontrak(user, k)) return NextResponse.json({ error: 'Realisasi awal diisi oleh Admin Sales cabangnya.' }, { status: 403 });
  const b = ((await req.json().catch(() => null)) || {}) as { items?: Record<string, unknown>[] };
  const list = Array.isArray(b.items) ? b.items : [];
  const changed: string[] = [];
  for (const x of list) {
    const it = k.items.find((i) => i.id === String(x.id || ''));
    if (!it) continue;
    const q = Math.max(0, num(x.saldoQty));
    const v = Math.max(0, num(x.saldoNilai));
    const empty = q === 0 && v === 0;
    const tgl = !empty && /^\d{4}-\d{2}-\d{2}$/.test(String(x.saldoTgl || '')) ? String(x.saldoTgl) : null;
    const ket = empty ? null : String(x.saldoKet || '').trim().slice(0, 300) || null;
    if (q > 0 && !ket) return NextResponse.json({ error: 'Isi keterangan realisasi awal (asal data).' }, { status: 400 });
    if (q === it.saldoQty && v === it.saldoNilai && tgl === it.saldoTgl && ket === it.saldoKet) continue;
    await prisma.kontrakItem.update({ where: { id: it.id }, data: { saldoQty: q, saldoNilai: v, saldoTgl: tgl, saldoKet: ket } });
    changed.push(`${it.grade || it.nama}: ${q}`);
  }
  if (changed.length) await logKontrak(id, 'realisasi awal', changed.join(' · '), user.name);
  return NextResponse.json({ ok: true, changed: changed.length });
}
