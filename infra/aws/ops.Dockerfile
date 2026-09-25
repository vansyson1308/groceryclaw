# One-shot migrate + demo seed job for the AWS deployment (infra/aws/compose.aws.yml "ops").
# Built from the official Postgres image (ships psql) plus the Node runtime copied from
# the official Node image, so no package manager or apt mirror is needed at build time.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS node
FROM public.ecr.aws/docker/library/postgres:16-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY package.json ./
COPY scripts/v2 ./scripts/v2
COPY db/v2 ./db/v2
USER postgres
CMD ["sh", "-c", "node scripts/v2/db_v2_migrate.mjs && node scripts/v2/db_v2_seed.mjs --demo"]
