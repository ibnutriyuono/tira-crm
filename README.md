# CRM TIRA · Steel Division (Next.js)

Next.js rewrite of the original single-file HTML CRM (`crmTira final fix bug test run 2x.html`), with the same
functionality — auth & role-based access, prospect pipeline (table + kanban), quotation letters, RFQ workflow,
customer/user management, Excel import/export, and full database backup/restore — but backed by a real
**PostgreSQL** database via **Prisma**, with **Socket.IO** pushing live updates to every connected user the moment
anyone else changes data.

## Stack

- Next.js 16 (App Router) + TypeScript, React 19
- PostgreSQL + Prisma ORM
- Custom Node server (`server.js`) wrapping Next.js + Socket.IO — needed because Socket.IO requires a persistent
  Node process, not serverless functions
- Cookie-based sessions (JWT via `jose`) + `bcryptjs` password hashing
- `xlsx` (SheetJS) for Excel import/export, all client-side

## Local development

Prerequisites: Node 20+, a running PostgreSQL server.

```bash
npm install
cp .env.example .env      # edit DATABASE_URL / JWT_SECRET
npx prisma migrate dev    # creates the schema
npx prisma db seed        # demo users + seed prospects (same as the original app)
npm run dev               # starts server.js on :3000
```

Demo accounts (same as the original app, now with hashed passwords):

| Username | Password | Role |
|---|---|---|
| admin | admin123 | Admin — full access, incl. Kelola User/Database |
| gm | gm123 | GM — sees all data |
| rm | rm123 | RM — Regional 2 only |
| bm | bm123 | BM — Cabang DKI only |
| sales | sales123 | Sales — own SE code only |

Admins can add/remove accounts from **Kelola User** in the app.

## Production deploy on a VPS

1. **Provision PostgreSQL** (locally on the VPS or a managed instance) and set `DATABASE_URL` in `.env`.
2. **Set a strong `JWT_SECRET`** (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. Build and run the migrations:
   ```bash
   npm ci
   npx prisma migrate deploy
   npx prisma db seed   # first deploy only
   npm run build
   ```
4. **Run the app as a persistent process** (it's a custom server, not a static/serverless build) — e.g. with pm2:
   ```bash
   pm2 start npm --name crm-tira -- start
   ```
   or a systemd unit running `npm start` (which runs `node server.js` with `NODE_ENV=production`).
5. **Put a reverse proxy with TLS in front of it** (Nginx or Caddy). This matters for two things:
   - Session cookies are set `Secure` in production — browsers silently drop them over plain HTTP, so login won't
     "stick" without HTTPS.
   - The proxy must forward WebSocket upgrade requests for realtime sync to work, e.g. in Nginx:
     ```nginx
     location /socket.io/ {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
     }
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
     ```

## How realtime sync works

Every mutation (add/edit/delete a prospect, customer, RFQ, user, or the purchasing contact) goes through a Next.js
API route, writes to Postgres via Prisma, then broadcasts a small event over the Socket.IO server embedded in
`server.js`. Every other open browser tab is subscribed (`src/hooks/useCrmSocket.ts`) and patches its local state
in place — so a status dragged on one person's kanban board, or a new prospect added by someone else, shows up
immediately for everyone else without a page refresh.

## Notable differences from the original single-file app

- The original ran inside a hosted "Artifact" sandbox with a `window.storage` API providing shared key/value
  storage; that API doesn't exist outside that sandbox, so it's replaced here with Postgres + Socket.IO.
- Passwords are hashed with bcrypt server-side instead of a simple client-side hash, and auth is a real httpOnly
  session cookie rather than data the client could inspect or forge.
- Role-based data scoping (Sales sees own SE, BM sees own Cabang, RM sees own Regional) is enforced server-side in
  the API routes, not just hidden in the UI.
