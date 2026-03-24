FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client redis-tools \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json tsconfig.build.json types-node-compat.d.ts ./
COPY apps ./apps
COPY packages ./packages
COPY db ./db
COPY scripts/v2/remote_migrate.mjs ./scripts/v2/remote_migrate.mjs

RUN npm install --no-audit --no-fund
RUN npm run build

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "entrypoint.sh"]
