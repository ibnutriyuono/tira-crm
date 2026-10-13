import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canManageKam, cleanGroupInput } from '@/lib/kam';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { CustomerGroup, KamTierChange } from '@/lib/types';
import { guard } from '@/lib/permissions-server';

/**
 * Upsert groups from the KAM analysis workbook (parsed client-side into rows
 * with the same field names as the form). Matched by group name; tier moves
 * are recorded with the import as their reason. Team (ketua/sekretaris/
 * anggota) is never overwritten by an import.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kam', 'e');
  if (denied) return denied;
  if (!canManageKam(user.role)) return NextResponse.json({ error: 'Hanya GM, RM dan Admin yang dapat mengimpor Key Account.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const rows = (Array.isArray(body?.rows) ? body.rows : []) as Record<string, unknown>[];
  const source = String(body?.source || 'Impor analisa KAM').slice(0, 120);
  if (!rows.length) return NextResponse.json({ error: 'Tidak ada baris untuk diimpor' }, { status: 400 });
  if (rows.length > 2000) return NextResponse.json({ error: 'Maksimal 2000 baris per impor' }, { status: 400 });

  let created = 0;
  let updated = 0;
  let tierMoves = 0;
  const skipped: string[] = [];
  for (const raw of rows) {
    const d = cleanGroupInput(raw) as Record<string, unknown>;
    delete d.ketuaId;
    delete d.sekretarisId;
    delete d.anggotaIds;
    delete d.actions;
    if (!d.name) {
      skipped.push('(tanpa nama)');
      continue;
    }
    const existing = (await prisma.customerGroup.findUnique({ where: { name: d.name as string } })) as unknown as CustomerGroup | null;
    const now = new Date().toISOString();
    if (!existing) {
      const tier = (d.tier as string) || 'monitor';
      await prisma.customerGroup.create({ data: { ...d, tier, tierHistory: [{ at: now, from: null, to: tier, reason: source, by: user.name }] } as never });
      created++;
    } else {
      if (d.tier && d.tier !== existing.tier) {
        const change: KamTierChange = { at: now, from: existing.tier, to: d.tier as CustomerGroup['tier'], reason: source, by: user.name };
        d.tierHistory = [change, ...(existing.tierHistory || [])].slice(0, 50);
        tierMoves++;
      }
      // Entities from the workbook are added to the ones typed in the CRM, never replace them.
      if (Array.isArray(d.entities)) d.entities = Array.from(new Set([...(existing.entities || []), ...(d.entities as string[])]));
      await prisma.customerGroup.update({ where: { id: existing.id }, data: d as never });
      updated++;
    }
  }
  emitCrmEvent('customerGroup:bulk', {});
  await logActivity({ user, action: 'import', entity: 'customerGroup', summary: `Impor Key Account: ${created} baru, ${updated} diperbarui, ${tierMoves} perubahan tier` });
  const groups = await prisma.customerGroup.findMany({ orderBy: [{ skor: 'desc' }, { name: 'asc' }] });
  return NextResponse.json({ created, updated, tierMoves, skipped, groups });
}
