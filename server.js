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
  });
});
