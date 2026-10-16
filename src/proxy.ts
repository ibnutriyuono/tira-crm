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
    if (authed) {
      const home = new URL('/', req.url);
      const n = req.nextUrl.searchParams.get('n');
      if (n) home.searchParams.set('n', n);
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/auth/')) return NextResponse.next();
  // Penjadwal ringkasan email (server.js) — rute ini memeriksa kuncinya sendiri.
  if (pathname === '/api/notifications/digest') return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    if (!authed) return NextResponse.json({ error: 'Sesi tidak valid. Silakan login kembali.' }, { status: 401 });
    return NextResponse.next();
  }

  if (!authed) {
    // Link "Buka di CRM" dari email (/?n=<id>): ingat tujuannya sampai selesai login.
    const login = new URL('/login', req.url);
    const n = req.nextUrl.searchParams.get('n');
    if (n) login.searchParams.set('n', n);
    return NextResponse.redirect(login);
  }
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
