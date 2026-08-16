'use client';

import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * One shared Socket.IO connection for the whole tab. Both the global store
 * subscription (useCrmSocket) and individual views that want their own live
 * feed (the activity log) attach handlers to this same socket.
 */
export function getSocket(): Socket {
  if (!socket) socket = io({ path: '/socket.io' });
  return socket;
}
