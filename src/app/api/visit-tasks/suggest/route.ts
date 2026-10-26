import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canAssignVisits } from '@/lib/roles';
import { visitSuggestions } from '@/lib/visit-task-server';

/** Saran tugas kunjungan (BM cabangnya, GM semua / per cabang). */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canAssignVisits(user.role) && user.role !== 'admin' && user.role !== 'rm') return NextResponse.json({ suggestions: [] });
  const cabang = new URL(req.url).searchParams.get('cabang') || undefined;
  return NextResponse.json({ suggestions: await visitSuggestions(user, cabang) });
}
