# Multi-stage build for the CRM TIRA app (Next.js + custom Socket.IO server).
#
# NOTE: Next's `output: 'standalone'` is deliberately NOT used — this app runs a
# custom server (server.js) that owns the Socket.IO instance, and standalone
# emits its own competing server entrypoint.
#
# Postgres is expected to run on the VPS host, outside Docker — see
# docker-compose.yml for how the container reaches it.
#
# Alpine notes: it ships musl libc rather than glibc, so two packages are
# required in every stage that runs node —
#   openssl      : Prisma's query engine links against it
#   libc6-compat : glibc-compat shim needed by Next's SWC binaries
# Prisma resolves to the linux-musl-openssl-3.0.x engine here; because the
# client is generated in an Alpine stage and run in an Alpine stage, "native"
# already matches and no explicit binaryTargets entry is needed in
# prisma/schema.prisma.

# ---------- deps ----------
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client inside the image so its engine binary matches this
# platform rather than whatever built the host's node_modules.
RUN npx prisma generate
RUN npm run build

# ---------- runner ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/server.js ./server.js

# Apply any pending migrations, then start. Safe to re-run: `migrate deploy`
# is a no-op when the schema is already up to date.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
