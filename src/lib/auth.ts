import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { prisma } from './prisma';
import type { SafeUser } from './types';

export const SESSION_COOKIE = 'crm_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function toSafeUser(u: { id: string; username: string; name: string; role: string; se: string | null; cabang: string | null; reg: number | null }): SafeUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role as SafeUser['role'], se: u.se, cabang: u.cabang, reg: u.reg };
}

/** Server Component / Route Handler helper: reads the session cookie via next/headers. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return toSafeUser(user);
}

/** Middleware helper: reads the session cookie straight off the NextRequest. */
export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// Secure cookies are silently dropped by browsers over plain HTTP (e.g.
// serving straight off an IP:port without TLS in front) — deliberately not
// tied to NODE_ENV. Set COOKIE_SECURE=false in .env for any deployment
// that isn't behind TLS; defaults to secure (true) otherwise.
const cookieSecure = process.env.COOKIE_SECURE !== 'false';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: cookieSecure,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
};

/** Mirrors the original app's per-role data scoping (getFiltered()'s role branch). */
export function prospectScopeWhere(user: SafeUser) {
  if (user.role === 'sales') return { se: { equals: user.se || '', mode: 'insensitive' as const } };
  if (user.role === 'bm') return { cabang: { equals: user.cabang || '', mode: 'insensitive' as const } };
  if (user.role === 'rm') return { reg: user.reg ?? -1 };
  return {}; // gm & admin see everything
}
