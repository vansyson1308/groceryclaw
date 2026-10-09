# Implementation Plan

Run the tasks in order. After each task:

- run the verification commands in `.kiro/steering/tech.md`;
- commit with a Conventional Commit message ending in the trailer `Built-with: Kiro`.

Each task is sized for one run and leaves the repo green.

- [ ] 1. Read-only MCP bearer tokens
  - Add `db/v2/migrations/019_v2_mcp_token_scopes.sql` with `-- migrate:up` and `-- migrate:down` sections, per design §1.
  - `resolveTokenHash` returns `{ tenantId, scopes }`, in `apps/mcp-server/src/store.ts`, `pg-store.ts` and `memory-store.ts`. `buildDemoDataset` in `scripts/v2/gen_demo_seed.mjs` accepts `readOnlyTokens`.
  - `apps/mcp-server/src/http.ts`: the static principal uses the token's scopes, and the token cache stores them.
  - `apps/mcp-server/src/server.ts` (memory backend): register `MCP_JUDGE_TOKEN` as read-only when it is set.
  - `scripts/v2/mcp_token_lib.mjs` gets `readOnly` (upsert scopes); `scripts/v2/create_mcp_token.mjs` gets `--read-only`.
  - Tests:
    - `tests/v2/mcp-http.test.mjs`: a read-only token can call `get_low_stock`; it gets insufficient scope on `create_reorder_draft` and `confirm_reorder`; a read-write token is unchanged.
    - New `tests/v2/db/mcp-token-scopes.test.mjs`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Database preparation for deploys
  - `apps/mcp-server/src/config.ts`: build the DB URL from `MCP_DB_HOST`, `MCP_DB_PORT`, `MCP_DB_NAME`, `MCP_DB_USER` and `MCP_DB_PASSWORD` when no URL is set.
  - `apps/mcp-server/src/server.ts`: refuse to start as a superuser or `BYPASSRLS` user unless `MCP_ALLOW_PRIVILEGED_DB_USER=true`. Set that variable in the local dev paths that connect as `postgres` (README quickstart, `tests/v2/db` helpers if they start the server, `infra/compose/v2` only if needed).
  - New `scripts/deploy/demo_tokens.mjs` (`registerDemoTokens(client)`) and `scripts/deploy/db_prepare.mjs`, per design §2.
  - Tests:
    - config URL building, in `tests/v2/mcp-http.test.mjs` or a new `tests/v2/mcp-config.test.mjs`;
    - new `tests/v2/db/deploy-prepare.test.mjs`: idempotent twice, role flags, tokens and scopes.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [ ] 3. Daily demo reseed
  - New `scripts/deploy/reseed_demo.mjs`, exporting `reseedDemo(client, { today })`, per design §3.
  - Extend `tests/v2/db/deploy-prepare.test.mjs`:
    - after a reseed, today's `sales_daily` row exists for the demo tenant;
    - both tokens still resolve;
    - a second tenant's rows are untouched.
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Simulator `/healthz` covering the MCP server
  - `apps/alexa-sim/src/server.ts`: `mcpHealth()` with a 2 s timeout and a 15 s cache; `/healthz` body per Requirement 4.1; `/readyz` unchanged.
  - Tests in `tests/v2/alexa-sim.test.mjs` with a fake toolbox:
    - healthy → 200 and `mcp.status: "ok"`;
    - failing → 200 and `"fail"`, with `/readyz` returning 503;
    - the body contains no token.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 5. Judge landing panel
  - `apps/alexa-sim/static/index.html`, `app.js`, `styles.css`: the "Try these 5 phrases" panel and the one-sentence explanation, per design §5. Clicking a phrase sends it like typed input. Keyboard accessible, no inline script or style.
  - Test in `tests/v2/alexa-sim.test.mjs`: `index.html` lists every `DEMO_UTTERANCES` text in order.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 6. Render Blueprint, proxy hops and deploy guide
  - `apps/mcp-server/src/client-ip.ts` and `config.ts`: `MCP_TRUST_PROXY` hop count, per design §6. Tests for 0, 1, 2 and short headers.
  - `apps/mcp-server/Dockerfile`: copy `scripts/deploy/`, `scripts/v2/remote_migrate.mjs`, `scripts/v2/db_v2_lib.mjs` if imported, and `db/v2/` into the image.
  - New `render.yaml` per design §6.
  - New `docs/hackathon/DEPLOY_RENDER.md`.
  - Update `.env.example` and `docs/ENV_VARS.md`.
  - New `tests/v2/render-blueprint.test.mjs`.
  - _Requirements: 2.1, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
