import { stripPurchSecrets } from './rfq-price';
import type { Server } from 'socket.io';

// server.js (the custom Node server) stashes the Socket.IO instance here once
// it's created. API route handlers run in the same long-lived process (this
// app is deployed on a VPS with a persistent Node process, not serverless),
// so they can reach it straight off `globalThis` without any extra wiring.
type GlobalWithIO = typeof globalThis & { __io?: Server };

export function emitCrmEvent(event: string, payload: unknown) {
  const io = (globalThis as GlobalWithIO).__io;
  if (!io) return; // e.g. running `next build` — no server attached yet
  // Satu room untuk semua: dokumen RFQ / FUP A selalu dikirim tanpa HPP,
  // margin, vendor & catatan internal; client ber-hak mengambil versi lengkap
  // lewat API bila `hppHidden` (lihat lib/rfq-price.ts, useCrmSocket).
  if ((event.startsWith('rfq:') || event.startsWith('fupa:')) && payload && typeof payload === 'object' && 'items' in payload) {
    payload = stripPurchSecrets(payload as { items?: unknown; purchNotes?: string | null });
  }
  io.to('crm').emit(event, payload);
}
