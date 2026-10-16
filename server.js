// Custom Next.js server with an attached Socket.IO server so every connected
// browser gets realtime pushes when another user changes data (prospects,
// customers, RFQs, users). API routes read the same Socket.IO instance off
// `globalThis.__io` (set below) and call `.emit()` after each DB write —
// see src/lib/socket.ts.
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

// Only actual local development runs Next's unoptimized dev server — every
// other NODE_ENV value (production, uat, staging, ...) serves the build
// produced by `npm run build`, which must exist first (see `npm start`).
const dev = process.env.NODE_ENV === 'development';
const hostname = process.env.HOST || 'localhost';
const port = Number(process.env.PORT) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Notifikasi email: tiap 5 menit minta server sendiri menjalankan pengecekan
// follow-up/eskalasi dan mengirim ringkasan harian yang jatuh tempo (lihat
// src/app/api/notifications/digest). Hanya aktif bila SMTP_HOST diisi.
function startEmailScheduler() {
  const key = process.env.CRON_SECRET || process.env.JWT_SECRET;
  if (!process.env.SMTP_HOST || !key) return;
  const host = hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;
  const tick = () =>
    fetch(`http://${host}:${port}/api/notifications/digest`, { method: 'POST', headers: { 'x-cron-key': key } })
      .then((r) => (r.ok ? null : console.error('[email] penjadwal:', r.status)))
      .catch((err) => console.error('[email] penjadwal:', err.message));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 5 * 60 * 1000);
  console.log('> Notifikasi email aktif (' + process.env.SMTP_HOST + ')');
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    // Single shared "crm" room — this app is a single-tenant internal CRM,
    // so every connected client should see every change.
    socket.join('crm');
  });

  globalThis.__io = io;

  httpServer.listen(port, () => {
    console.log(`> CRM TIRA ready on http://${hostname}:${port} (${dev ? 'dev' : 'production'})`);
    startEmailScheduler();
  });
});
