FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client redis-tools \
  && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.base.json tsconfig.build.json types-node-compat.d.ts ./
COPY apps ./apps
COPY packages ./packages

RUN npm install --no-audit --no-fund
RUN npm run build

ENV NODE_ENV=development
CMD ["node", "apps/gateway/dist/server.js"]
