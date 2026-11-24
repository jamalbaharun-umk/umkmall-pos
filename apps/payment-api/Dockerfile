# Build from the repo ROOT:  docker build -f apps/payment-api/Dockerfile .
# debian-slim, not alpine: glibc native modules break on musl (same rule as UMKMall apps/api).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json turbo.json ./
COPY apps/payment-api/package.json apps/payment-api/package.json
COPY apps/pos-api/package.json apps/pos-api/package.json
COPY apps/pos-web/package.json apps/pos-web/package.json
RUN npm ci --workspace payment-api --include-workspace-root
COPY apps/payment-api apps/payment-api
RUN npm run build -w payment-api && npm prune --omit=dev --workspace payment-api --include-workspace-root

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/payment-api/dist ./dist
COPY --from=build /repo/apps/payment-api/drizzle ./drizzle
COPY --from=build /repo/apps/payment-api/package.json ./package.json
USER node
EXPOSE 3001
# Pre-deploy command `node dist/db/migrate.js`, start command below.
CMD ["node", "dist/main"]
