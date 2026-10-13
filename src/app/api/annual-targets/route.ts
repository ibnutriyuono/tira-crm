import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, num, requireUser } from '@/lib/api-helpers';
import { budgetTargetScopeWhere, canEditBudgetTarget } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { monthlyFromAnnual } from '@/lib/annual-target';
import { notifyBranchTargetSet } from '@/lib/se-target-server';
import { guard } from '@/lib/permissions-server';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'forecast', 'v');
  if (denied) return denied;
  const annualTargets = await prisma.annualTarget.findMany({ where: await budgetTargetScopeWhere(user), orderBy: [{ year: 'desc' }, { cabang: 'asc' }] });
  return NextResponse.json({ annualTargets });
}

/**
 * Simpan target tahunan satu cabang dan isi target bulanan default
 * (tahunan / 12) ke bulan yang kosong (0) atau masih default dari tahunan.
 * Bulan yang diisi manual tidak diubah, kecuali `overwrite: true`.
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'forecast', 'e');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const cabang = String(body?.cabang || '').trim().toUpperCase();
  const year = String(body?.year || '').trim();
  const amount = Math.max(0, num(body?.amount));
  const overwrite = body?.overwrite === true;
  if (!cabang || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'Cabang dan tahun (YYYY) wajib diisi' }, { status: 400 });
  }
  if (!(await canEditBudgetTarget(user, cabang))) {
    return NextResponse.json({ error: 'Anda tidak berhak mengubah target cabang ini.' }, { status: 403 });
  }

  const monthly = monthlyFromAnnual(amount);
  const { annualTarget, budgetTargets } = await prisma.$transaction(async (tx) => {
    const annualTarget = await tx.annualTarget.upsert({
      where: { cabang_year: { cabang, year } },
      create: { cabang, year, amount },
      update: { amount },
    });
    const existing = await tx.budgetTarget.findMany({ where: { cabang, periode: { startsWith: `${year}-` } } });
    type Row = { id: string; cabang: string; periode: string; amount: number; fromAnnual: boolean };
    const byPeriode = new Map<string, Row>((existing as Row[]).map((b) => [b.periode, b]));
    const changed: Row[] = [];
    for (let m = 1; m <= 12; m++) {
      const periode = `${year}-${String(m).padStart(2, '0')}`;
      const cur = byPeriode.get(periode);
      const value = monthly[m - 1];
      if (!cur) {
        if (value > 0) changed.push(await tx.budgetTarget.create({ data: { cabang, periode, amount: value, fromAnnual: true } }));
      } else if (cur.fromAnnual || !(cur.amount > 0) || overwrite) {
        if (cur.amount !== value || !cur.fromAnnual) changed.push(await tx.budgetTarget.update({ where: { id: cur.id }, data: { amount: value, fromAnnual: true } }));
      }
    }
    return { annualTarget, budgetTargets: changed };
  });

  emitCrmEvent('annualTarget:updated', annualTarget);
  budgetTargets.forEach((b: unknown) => emitCrmEvent('budget:updated', b));
  if (amount > 0 && user.role !== 'bm') await notifyBranchTargetSet(cabang, `tahun ${year}`, `${year}-01`);
  await logActivity({
    user,
    action: 'update',
    entity: 'budget',
    entityId: annualTarget.id,
    summary: `Menetapkan target tahunan ${cabang} ${year} (${budgetTargets.length} bulan diisi otomatis)`,
  });
  return NextResponse.json({ annualTarget, budgetTargets });
}
