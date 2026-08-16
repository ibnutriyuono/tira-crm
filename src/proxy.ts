import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE } from '@/lib/auth';

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = await hasValidSession(req);

  if (pathname === '/login') {
    if (authed) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    if (!authed) return NextResponse.json({ error: 'Sesi tidak valid. Silakan login kembali.' }, { status: 401 });
    return NextResponse.next();
  }

  if (!authed) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next internals)
     * - static assets in /public (favicon, logo.png, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|logo.png).*)',
  ],
};
