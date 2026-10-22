import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { guard } from '@/lib/permissions-server';
import { prisma } from '@/lib/prisma';
import { assertProspectInScope } from '@/lib/prospect-access';
import { quoteSignersFor } from '@/lib/quote-signers';

/**
 * GET ?prospectId=&userId= → PNG tanda tangan penanda tangan yang dipilih,
 * hanya bila orang itu memang boleh dipakai untuk prospek ini (Sales pemilik
 * prospek / BM cabang, dibuka oleh Admin Sales / BM cabang yang sama).
 * Tanda tangan sendiri tetap lewat /api/account/signature.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', 'x');
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const prospectId = sp.get('prospectId') || '';
  const userId = sp.get('userId') || '';
  if (!prospectId || !userId) return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 });
  const scoped = await assertProspectInScope(user, prospectId);
  if (scoped.error) return scoped.error;

  const signers = await quoteSignersFor(user, scoped.existing);
  if (!signers.some((s) => s.id === userId)) return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 });
  const row = await prisma.userSignature.findUnique({ where: { userId } });
  if (!row) return NextResponse.json({ error: 'Belum ada tanda tangan' }, { status: 404 });
  return new NextResponse(new Uint8Array(row.png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
}
