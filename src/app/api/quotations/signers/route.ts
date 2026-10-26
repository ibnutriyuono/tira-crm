import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { guard } from '@/lib/permissions-server';
import { quotePermAct } from '@/lib/roles';
import { assertProspectInScope } from '@/lib/prospect-access';
import { defaultQuoteSigner, quoteSignersFor } from '@/lib/quote-signers';

/**
 * GET ?prospectId= → penanda tangan yang boleh dipakai di Surat Penawaran
 * prospek ini. Admin Sales / BM: Sales pemilik prospek, BM cabang, dan diri
 * sendiri. Role lain: diri sendiri saja.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', quotePermAct(user.role));
  if (denied) return denied;
  const prospectId = new URL(req.url).searchParams.get('prospectId') || '';
  if (!prospectId) return NextResponse.json({ error: 'prospectId wajib diisi' }, { status: 400 });
  const scoped = await assertProspectInScope(user, prospectId);
  if (scoped.error) return scoped.error;

  const signers = await quoteSignersFor(user, scoped.existing);
  return NextResponse.json({ signers, defaultId: defaultQuoteSigner(user, signers)?.id ?? null });
}
