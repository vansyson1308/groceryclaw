---
inclusion: always
---

# Tech stack and commands

## Stack

- Node.js 22, TypeScript strict, ES2022, NodeNext ESM.
- npm workspaces: `apps/*`, `packages/common`.
- HTTP servers use raw `node:http` `createServer`. No Express or Fastify.
- MCP uses `@modelcontextprotocol/sdk` 1.x: `McpServer` with `StreamableHTTPServerTransport` on the server, and `Client` with `StreamableHTTPClientTransport` in the simulator.
- PostgreSQL 16 with RLS. Migrations are numbered SQL files in `db/v2/migrations/` with `-- migrate:up` / `-- migrate:down` sections.
- Tests use the Node built-in runner (`node:test`, `node:assert/strict`). Test files are `tests/v2/*.test.mjs`; Postgres tests are `tests/v2/db/*.test.mjs` and skip when `DATABASE_URL` is unset.
- Apps import the shared library from compiled output: `../../../packages/common/dist/index.js`.

## Commands (run from the repo root)

```bash
npm ci
npm run build            # tsc -b tsconfig.build.json
npm run lint             # tools/v2/lint.mjs: no explicit `any` in apps/ and packages/ TypeScript
npm run format:check     # no trailing whitespace, no tabs, final newline (apps, packages, tests, docs)
npm run sql:guard        # no string-interpolated SQL in hot paths
npm test                 # build + every unit test (+ DB tests when DATABASE_URL is set)
node --test tests/v2/<file>.test.mjs   # one test file (run `npm run build` first)
```

## Verifying a task

In a fresh checkout or git worktree, run `npm ci` first; `node_modules` is not shared between worktrees.


After each task, run:

```bash
npm run build && npm run lint && npm run format:check && npm run sql:guard && node --test tests/v2/*.test.mjs
```

Every command must pass. When the task touches SQL or `scripts/deploy/`, also run the DB tests:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2 npm run db:v2:migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2 node --test --test-concurrency=1 tests/v2/db/*.test.mjs
```

On Windows without Postgres, the DB tests skip, and GitHub CI (`v2-ci`) runs them on the pull request.

## Conventions

- Parameterize SQL (`$1`, `$2`). Role names and passwords in DDL go through `format('%I')` / `format('%L')` inside a `DO` block, never JS string interpolation.
- Never use explicit `any`. Prefer `unknown` plus narrowing.
- Log with the shared `createLogger` as structured JSON. Never log secrets.
- Config comes from `process.env` through a `load…Config(env)` function that takes `env` as an argument, so tests can pass a plain object.
- Keep changes small. Add or extend a test for every behaviour you add.
- Commit messages use Conventional Commits (`feat(mcp-server): …`, `test(deploy): …`, `docs(hackathon): …`).
