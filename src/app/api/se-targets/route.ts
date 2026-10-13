import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, num, requireUser } from '@/lib/api-helpers';
import { canEditBudgetTarget, seTargetScopeWhere } from '@/lib/auth';
import { yearMonthTarget } from '@/lib/kpi';
import { prisma } from '@/lib/prisma';
import { restOfYear } from '@/lib/se-target';
import { notify } from '@/lib/notify';
import { periodeLabel } from '@/lib/se-target-server';
import { emitCrmEvent } from '@/lib/socket';
import type { BudgetTarget } from '@/lib/types';
import { guard } from '@/lib/permissions-server';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'forecast', 'v');
  if (denied) return denied;
  const seTargets = await prisma.seTarget.findMany({ where: await seTargetScopeWhere(user), orderBy: [{ periode: 'desc' }, { se: 'asc' }] });
  return NextResponse.json({ seTargets });
}

type Row = { id: string; se: string; cabang: string; periode: string; amount: number; updatedBy: string | null };

/**
 * Simpan pembagian target satu cabang untuk satu bulan: { cabang, periode,
 * rows: [{ se, amount }], applyRest? }. amount 0 menghapus target SE itu.
 * applyRest: proporsi yang sama (amount / target cabang bulan ini) diterapkan
 * ke bulan-bulan berikutnya s.d. Desember mengikuti target cabang tiap bulan.
 * Hanya BM cabang itu, RM regionalnya, GM/Admin.
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'forecast', 'e');
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const cabang = String(body?.cabang || '').trim().toUpperCase();
  const periode = String(body?.periode || '').trim();
  const applyRest = body?.applyRest === true;
  const input: { se: string; amount: number }[] = Array.isArray(body?.rows)
    ? (body.rows as { se?: unknown; amount?: unknown }[])
        .map((r) => ({ se: String(r?.se || '').trim().toUpperCase().slice(0, 40), amount: Math.max(0, Math.round(num(r?.amount))) }))
        .filter((r) => r.se)
    : [];
  if (!cabang || !/^\d{4}-\d{2}$/.test(periode)) return NextResponse.json({ error: 'Cabang dan periode (YYYY-MM) wajib diisi' }, { status: 400 });
  if (!input.length) return NextResponse.json({ error: 'Tidak ada Sales yang diisi' }, { status: 400 });
  if (new Set(input.map((r) => r.se)).size !== input.length) return NextResponse.json({ error: 'Sales ganda pada daftar' }, { status: 400 });
  if (!(await canEditBudgetTarget(user, cabang))) return NextResponse.json({ error: 'Anda tidak berhak membagi target cabang ini.' }, { status: 403 });

  // SE yang sudah punya target di cabang lain pada bulan ini tidak boleh dipindah diam-diam.
  const clash = await prisma.seTarget.findMany({ where: { periode, se: { in: input.map((r) => r.se) }, NOT: { cabang } } });
  if (clash.length) {
    return NextResponse.json({ error: `Sales ${clash.map((c: Row) => `${c.se} (${c.cabang})`).join(', ')} sudah punya target di cabang lain bulan ini.` }, { status: 409 });
  }

  const periodes = [periode, ...(applyRest ? restOfYear(periode) : [])];
  const budgets = (await prisma.budgetTarget.findMany({ where: { cabang: { equals: cabang, mode: 'insensitive' }, periode: { startsWith: periode.slice(0, 5) } } })) as BudgetTarget[];
  const year = periode.slice(0, 4);
  const baseTarget = yearMonthTarget(budgets, cabang, year, Number(periode.slice(5, 7)));
  const who = user.name || user.username;

  const { saved, removed }: { saved: Row[]; removed: Row[] } = await prisma.$transaction(async (tx) => {
    const saved: Row[] = [];
    const removed: Row[] = [];
    for (const p of periodes) {
      const factor = p === periode || !(baseTarget > 0) ? 1 : yearMonthTarget(budgets, cabang, year, Number(p.slice(5, 7))) / baseTarget;
      for (const r of input) {
        const amt = p === periode ? r.amount : Math.round((r.amount * factor) / 1000) * 1000;
        if (amt > 0) {
          saved.push(
            (await tx.seTarget.upsert({
              where: { se_periode: { se: r.se, periode: p } },
              create: { se: r.se, cabang, periode: p, amount: amt, updatedBy: who },
              update: { cabang, amount: amt, updatedBy: who },
            })) as Row,
          );
        } else {
          const ex = (await tx.seTarget.findUnique({ where: { se_periode: { se: r.se, periode: p } } })) as Row | null;
          if (ex) {
            await tx.seTarget.delete({ where: { id: ex.id } });
            removed.push(ex);
          }
        }
      }
    }
    return { saved, removed };
  });

  saved.forEach((t) => emitCrmEvent('seTarget:updated', t));
  removed.forEach((t) => emitCrmEvent('seTarget:deleted', { id: t.id }));

  // Beri tahu tiap Sales target bulan ini.
  const mine = saved.filter((t) => t.periode === periode);
  if (mine.length) {
    const users = await prisma.user.findMany({ where: { role: 'sales', se: { in: mine.map((t) => t.se), mode: 'insensitive' } }, select: { id: true, se: true } });
    await Promise.all(
      users.map((u: { id: string; se: string | null }) => {
        const t = mine.find((x) => x.se === (u.se || '').toUpperCase());
        if (!t) return null;
        return notify({
          userIds: [u.id],
          type: 'target_assigned',
          entity: 'target',
          entityId: periode,
          title: `Target Anda ${periodeLabel(periode)}: Rp ${Math.round(t.amount).toLocaleString('id-ID')}`,
          message: `Ditetapkan oleh ${who} (cabang ${cabang})${applyRest ? '; proporsi yang sama berlaku s.d. Desember' : ''}.`,
        });
      }),
    );
  }

  await logActivity({ user, action: 'update', entity: 'budget', entityId: `${cabang}-${periode}`, summary: `Membagi target ${cabang} ${periode} ke ${input.length} Sales${applyRest ? ' (s.d. Desember)' : ''}` });
  return NextResponse.json({ seTargets: saved, removedIds: removed.map((r) => r.id) });
}
