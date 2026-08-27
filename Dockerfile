# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/agente-core/package.json packages/agente-core/package.json
COPY packages/happie-package-ia/package.json packages/happie-package-ia/package.json
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# packages/*/dist está en .gitignore — sin este paso, Next no puede resolver
# "@sempertex/agente-core" ni "@sempertex/happie-package-ia" en una imagen
# construida desde un checkout limpio (antes funcionaba por un dist/ suelto
# que había quedado en el disco del servidor de una build manual anterior).
RUN npm run build --workspace=@sempertex/agente-core --workspace=@sempertex/happie-package-ia
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
