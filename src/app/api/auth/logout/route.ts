import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getCurrentUser, SESSION_COOKIE } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function POST() {
  // Read the session before clearing it so the audit entry knows who left.
  const user = await getCurrentUser();

  const jar = await cookies();
  jar.delete(SESSION_COOKIE);

  if (user) {
    await logActivity({ user, action: 'logout', entity: 'session', summary: `${user.name} keluar dari sistem` });
  }
  return NextResponse.json({ ok: true });
}
