import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { OPS_RULE_FIELDS, normalizeOpsRules } from '@/lib/ops-rules';
import { OPS_RULES_KEY, getOpsRules } from '@/lib/ops-escalation';

/** Batas waktu & margin Operation — dibaca semua user, diubah Admin. */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  return NextResponse.json({ opsRules: await getOpsRules() });
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.role !== 'admin') return NextResponse.json({ error: 'Hanya Admin yang dapat mengubah batas waktu & margin.' }, { status: 403 });
  const before = await getOpsRules();
  const rules = normalizeOpsRules(await req.json().catch(() => null));
  const value = rules as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: OPS_RULES_KEY }, update: { value }, create: { key: OPS_RULES_KEY, value } });
  emitCrmEvent('opsRules:updated', rules);
  const diff = OPS_RULE_FIELDS.filter((f) => before[f.key] !== rules[f.key]).map((f) => `${f.label}: ${before[f.key]} → ${rules[f.key]} ${f.unit}`);
  await logActivity({ user, action: 'update', entity: 'setting', entityId: OPS_RULES_KEY, summary: `Mengubah batas waktu & margin${diff.length ? ` (${diff.join('; ')})` : ''}` });
  return NextResponse.json({ opsRules: rules });
}
