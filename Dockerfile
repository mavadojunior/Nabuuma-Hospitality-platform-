# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,id=nabuuma-npm-build,target=/root/.npm,sharing=locked \
    npm ci


FROM dependencies AS builder

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build


FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,id=nabuuma-npm-production,target=/root/.npm,sharing=locked \
    npm ci --omit=dev


FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:f991e86a080567b6ab7c3392e36f7a0a4f9300639e526b48ee81b92d523af62e AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=production-dependencies \
    --chown=nonroot:nonroot \
    /app/node_modules ./node_modules

COPY --from=builder \
    --chown=nonroot:nonroot \
    /app/dist ./dist

COPY --chown=nonroot:nonroot \
    package.json ./package.json

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

USER nonroot:nonroot

CMD ["dist/server.js"]
