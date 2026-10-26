import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { currentKurs } from '@/lib/kurs-server';
import { canSeeHpp } from '@/lib/roles';

/** Kurs acuan USD/EUR → IDR untuk mengisi HPP di jawaban RFQ (role ber-hak HPP). */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canSeeHpp(user.role)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
  return NextResponse.json({ kurs: await currentKurs().catch(() => null) });
}
