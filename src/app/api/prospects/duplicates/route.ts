import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { guard } from '@/lib/permissions-server';
import { findDuplicatesFor } from '@/lib/prospect-duplicates-server';
import type { Material } from '@/lib/types';

/**
 * POST { id?, customer, materials } → { matches }
 * Peringatan prospek ganda / mirip sebelum menyimpan (lihat lib/prospect-duplicates.ts).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', 'e');
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const materials = (Array.isArray(body?.materials) ? body.materials : []) as Material[];
  const { views } = await findDuplicatesFor(user, {
    id: body?.id ? String(body.id) : null,
    customer: String(body?.customer || ''),
    materials: materials.slice(0, 200).map((m) => ({ uraian: String(m?.uraian || ''), qty: Number(m?.qty) || 0 })),
  });
  return NextResponse.json({ matches: views });
}
