import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { guard } from '@/lib/permissions-server';
import { assertProspectInScope } from '@/lib/prospect-access';
import { kontrakForProspect } from '@/lib/kontrak-server';

/** Kontrak yang berlaku untuk satu prospek + kecocokan per item: GET ?id=prospectId. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'kontrak', 'v');
  if (denied) return NextResponse.json({ kontrak: [] });
  const id = String(new URL(req.url).searchParams.get('id') || '');
  const scope = await assertProspectInScope(user, id);
  if ('error' in scope) return scope.error;
  return NextResponse.json({ kontrak: await kontrakForProspect(scope.existing as never, user) });
}
