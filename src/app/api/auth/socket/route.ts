import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { canSeeVendors } from '@/lib/roles';

/**
 * Dipanggil server.js saat browser membuka koneksi real-time (Socket.IO):
 * meneruskan cookie sesi browser, lalu memasukkan socket ke ruang sesuai
 * user. Tanpa sesi sah (atau akun dijeda) → 401 dan koneksi ditolak.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ id: user.id, role: user.role, vendors: canSeeVendors(user.role) });
}
