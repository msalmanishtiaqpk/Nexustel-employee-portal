# syntax=docker/dockerfile:1
# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
# DATABASE_URL is only needed at runtime; a placeholder keeps `prisma generate` happy.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate && npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/* \
  && groupadd -r nexustel && useradd -r -g nexustel -d /app nexustel

# Standalone server + static assets
COPY --from=builder --chown=nexustel:nexustel /app/.next/standalone ./
COPY --from=builder --chown=nexustel:nexustel /app/.next/static ./.next/static
COPY --from=builder --chown=nexustel:nexustel /app/public ./public
# Prisma CLI + migrations + seed (for `migrate deploy` and `db seed` at startup)
COPY --from=builder --chown=nexustel:nexustel /app/prisma ./prisma
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/.bin/tsx ./node_modules/.bin/tsx
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=builder --chown=nexustel:nexustel /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
COPY --chown=nexustel:nexustel docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nexustel
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
