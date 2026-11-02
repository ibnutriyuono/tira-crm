import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { getMaterialLexicon } from '@/lib/material-lexicon-server';

/**
 * GET → kamus material (grade & nama material yang pernah diinput di seluruh
 * prospek, RFQ dan FUP A). Hanya nama material — tanpa customer / harga /
 * qty — jadi sama untuk semua role.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  return NextResponse.json(await getMaterialLexicon());
}
