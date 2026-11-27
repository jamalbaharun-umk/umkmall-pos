# Build from the repo ROOT:  docker build -f apps/pos-api/Dockerfile .
# debian-slim, not alpine: glibc native modules break on musl (same rule as UMKMall apps/api).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json turbo.json ./
COPY apps/pos-api/package.json apps/pos-api/package.json
COPY apps/pos-web/package.json apps/pos-web/package.json
RUN npm ci --workspace pos-api --include-workspace-root
# The report PDF draws the UI package's chart components: scripts/bundle-charts.mjs bundles them (and tokens.css).
COPY packages/ui/src/primitives/Charts packages/ui/src/primitives/Charts
COPY packages/ui/tokens.css packages/ui/tokens.css
COPY apps/pos-api apps/pos-api
RUN npm run build -w pos-api && npm prune --omit=dev --workspace pos-api --include-workspace-root

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/pos-api/dist ./dist
# npm nests pdfkit's own fontkit under the workspace: it must sit where dist/ resolves it from.
COPY --from=build /repo/apps/pos-api/node_modules ./dist/node_modules
COPY --from=build /repo/apps/pos-api/generated ./generated
COPY --from=build /repo/apps/pos-api/drizzle ./drizzle
COPY --from=build /repo/apps/pos-api/package.json ./package.json
USER node
EXPOSE 3000
# Railway: pre-deploy command `node dist/db/migrate.js`, start command below.
CMD ["node", "dist/main"]
