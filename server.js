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

// Di belakang Nginx / Cloudflare set TRUST_PROXY=1 supaya alamat klien diambil
// dari X-Forwarded-For; tanpa proxy header itu bisa dipalsukan, jadi diabaikan.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_SOCKETS_PER_USER = 10;
const MAX_SOCKETS_PER_IP = 60;
function clientIp(req) {
  if (TRUST_PROXY) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf);
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
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
    // Alamat klien untuk log & batas login: jangan percaya header kiriman klien.
    delete req.headers['x-client-ip'];
    req.headers['x-client-ip'] = clientIp(req);
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  // Koneksi lambat (slowloris) tidak boleh menahan server lama-lama.
  httpServer.headersTimeout = 20 * 1000;
  httpServer.requestTimeout = 120 * 1000;

  const io = new Server(httpServer, {
    path: '/socket.io',
    // Browser hanya menerima push; tidak ada pesan besar dari klien.
    maxHttpBufferSize: 16 * 1024,
    connectTimeout: 10 * 1000,
  });

  // Hanya browser yang sudah login boleh tersambung. Sesi diperiksa oleh
  // /api/auth/socket (cookie diteruskan apa adanya; akun dijeda ditolak).
  const selfHost = hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;
  const perIp = new Map();
  io.use(async (socket, nextFn) => {
    try {
      const ip = clientIp(socket.request);
      if ((perIp.get(ip) || 0) >= MAX_SOCKETS_PER_IP) return nextFn(new Error('too_many_connections'));
      const cookie = socket.handshake.headers.cookie;
      if (!cookie) return nextFn(new Error('unauthorized'));
      const r = await fetch(`http://${selfHost}:${port}/api/auth/socket`, { headers: { cookie, 'x-client-ip': ip } });
      if (!r.ok) return nextFn(new Error('unauthorized'));
      const me = await r.json();
      if (!me || !me.id) return nextFn(new Error('unauthorized'));
      if ((await io.in(`u:${me.id}`).fetchSockets()).length >= MAX_SOCKETS_PER_USER) return nextFn(new Error('too_many_connections'));
      socket.data.user = me;
      socket.data.ip = ip;
      nextFn();
    } catch (err) {
      console.error('[socket] auth:', err.message);
      nextFn(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    const ip = socket.data.ip;
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    socket.on('disconnect', () => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    });
    // "crm" = semua user login; "vendor" = role yang boleh melihat data vendor;
    // "u:<id>" = untuk memutus koneksi saat akun dijeda / dihapus.
    socket.join('crm');
    socket.join(`u:${me.id}`);
    if (me.vendors) socket.join('vendor');
  });

  globalThis.__io = io;

  httpServer.listen(port, () => {
    console.log(`> CRM TIRA ready on http://${hostname}:${port} (${dev ? 'dev' : 'production'})`);
    startEmailScheduler();
  });
});
