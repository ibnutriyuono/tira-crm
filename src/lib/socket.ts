import type { Server } from 'socket.io';

// server.js (the custom Node server) stashes the Socket.IO instance here once
// it's created. API route handlers run in the same long-lived process (this
// app is deployed on a VPS with a persistent Node process, not serverless),
// so they can reach it straight off `globalThis` without any extra wiring.
type GlobalWithIO = typeof globalThis & { __io?: Server };

export function emitCrmEvent(event: string, payload: unknown) {
  const io = (globalThis as GlobalWithIO).__io;
  if (!io) return; // e.g. running `next build` — no server attached yet
  io.to('crm').emit(event, payload);
}
