import { prisma } from './prisma';
import { DEFAULT_SEGMENTS, SEG_OTHERS, canEditSegment, normalizeTaxonomy, segmentChoices, subOptions, type SegmentDef } from './customer-segments';
import type { SafeUser } from './types';

const KEY = 'customerSegments';

export async function getSegmentTaxonomy(): Promise<SegmentDef[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } }).catch(() => null);
  return normalizeTaxonomy(row?.value && Array.isArray(row.value) ? row.value : DEFAULT_SEGMENTS);
}

export async function saveSegmentTaxonomy(list: SegmentDef[]): Promise<SegmentDef[]> {
  const tax = normalizeTaxonomy(list);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: tax as never }, update: { value: tax as never } });
  return tax;
}

export async function userCanEditSegment(user: SafeUser): Promise<boolean> {
  const label = user.customRole ? (await prisma.roleDef.findUnique({ where: { key: user.customRole }, select: { label: true } }).catch(() => null))?.label : null;
  return canEditSegment(user.role, user.customRole, label);
}

/**
 * Segmen & sub-segmen dari body form customer, sesudah dicek:
 * - user tanpa hak segmen → undefined (field tidak diubah);
 * - segmen harus ada di daftar (atau sama dengan yang sudah terpasang);
 * - sub-segmen harus salah satu pilihan segmen itu; Others tanpa sub.
 * Mengembalikan { error } bila tidak valid.
 */
export async function segmentFieldsFor(
  user: SafeUser,
  body: unknown,
  existing: { segmen: string | null; subSegmen: string | null } | null,
): Promise<{ segmen?: string | null; subSegmen?: string | null } | { error: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!('segmen' in b)) return {};
  if (!(await userCanEditSegment(user))) return {};
  const tax = await getSegmentTaxonomy();
  const seg = String(b.segmen ?? '').trim();
  const sub = String(b.subSegmen ?? '').trim();
  if (!seg) return { segmen: null, subSegmen: null };
  if (!segmentChoices(tax, existing?.segmen).includes(seg)) return { error: `Segmen "${seg}" tidak ada di daftar.` };
  if (seg === SEG_OTHERS) return { segmen: seg, subSegmen: null };
  const opts = subOptions(tax, seg, existing?.segmen === seg ? existing?.subSegmen : null);
  if (sub && !opts.includes(sub)) return { error: `Sub-segmen "${sub}" tidak ada untuk segmen ${seg}.` };
  return { segmen: seg, subSegmen: sub || null };
}
