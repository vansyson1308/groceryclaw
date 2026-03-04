FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json tsconfig.base.json tsconfig.build.json types-node-compat.d.ts ./
COPY apps ./apps
COPY packages ./packages

RUN npm install --no-audit --no-fund
RUN npm run build

ENV NODE_ENV=development
CMD ["node", "apps/worker/dist/index.js"]
