# ShopVoice on the Claude directory: status

Updated at the end of every phase. The plan is in `SPEC.md` (source: SPEC 04), the requirements in `REQUIREMENTS_DIGEST.md`, and deviations in `DECISIONS.md`.

**Last update:** 2026-09-27. Phases 0–2, 4, 5 and 7 are done; Phase 6 is done locally. The deploy (Phase 3) and everything that needs the public URL are **blocked on AWS credentials (DB1)**.
**Branch:** `feat/claude-directory` (PR #27, merged into `main` once green, at the owner's request). Deploy follow-ups go on a new branch from `main`

## Checklist

- [x] Phase 0: branch; SPEC, STATUS, DECISIONS, BLOCKERS and REQUIREMENTS_DIGEST written; AWS check (fails, DB1); Checkpoint A asked
- [x] Phase 1: OAuth 2.1 authorization server (migration 018, metadata, DCR, CIMD, authorize/consent, token, revoke, account page) and tests
- [x] Phase 2: MCP adjustments (protocol decision, Claude reorder path, markdown content, instructions, Origin regression test, errors, description audit)
- [ ] Phase 3: deploy. **Code ready and synthesized; the deploy itself is BLOCKED on AWS credentials (DB1).** CDK changes: OAuth/pages routes, `/.well-known` at the root, SSM `public-base-url`, S3 backups, alarms. Also done: reviewer script, smoke tooling, `DEPLOYMENT.md`
- [x] Phase 4: public pages (`/docs`, `/privacy`, `/terms`, `/support`), icon, `REVIEWER_WALKTHROUGH.md`. They are live only once Phase 3 deploys
- [x] Phase 5: plugin bundle (`plugins/shopvoice`): `claude plugin validate` passes; evals score 1.00 with the plugin, mean Δ +0.71; `build_plugin.mjs` produces the repo root and the zip. **Not done: pushing to `vansyson1308/shopvoice-plugin` (the repo exists and is empty). It waits for the deployed host, because `.mcp.json` must carry the real URL (DB1)**
- [ ] Phase 6: done **locally**: Inspector OAuth flow, and every tool called over OAuth with a reviewer account on Postgres. `OWNER_CLAUDE_TEST.md` is written. **Not done:** the same runs on the deployed URL (DB1), and Checkpoint B, where the owner runs the Claude test
- [x] Phase 7: `SUBMISSION_KIT.md`, with limits checked by `scripts/directory/check_kit.mjs`; the host is filled in by `--host` after deploy. Devpost doc and evidence index updated. PR to `main` opened. Checkpoint C (hand-off) reported

## Done

- Read the Anthropic connector and plugin docs plus the MCP authorization spec, and wrote the digest.
- Protocol check: MCP `2026-07-28` is current, but no SDK supports it yet, so we stay on `2025-11-25` (DD2).
- Recon: the server is stateful Streamable HTTP with static bearer tokens resolved by SHA-256 through `resolve_mcp_access_token`. There are 9 tools with annotations.

- Phase 1 (`a218948`) added:
  - migration 018 plus a rollback, verified up → down → up;
  - `apps/mcp-server/src/oauth/`: metadata, DCR, CIMD with the SSRF guard, authorize with EN/VI sign-in, sign-up and consent pages, token, revoke, and an account page with invite linking;
  - the `/mcp` 401 and 403 challenges.
  Tests: `oauth-core` 12, `oauth-flow` 24, `db/oauth-db` 10, all passing.
- Phase 2 added:
  - a chat (OAuth) profile that returns markdown next to `structuredContent`;
  - neutral tool descriptions (DD12) and neutral server instructions;
  - the Claude reorder path (DD13);
  - actionable errors;
  - an Origin regression test.
  Tests: `mcp-chat-profile` 6.
- Test counts on 2026-09-27:
  - without `DATABASE_URL`: `npm test` 221 plus 26, 0 failures;
  - with Postgres, on a fresh cluster with all migrations: 215 plus 56, 5 skipped, 0 failures, and the `db:v2:test:rls` and `db:v2:test:bootstrap` gates pass.
- The Devpost e2e voice flow (`scripts/demo/e2e_voice_flow.mjs`) still passes 5/5.
- Phase 4 added:
  - `apps/mcp-server/public/pages/*.{en,vi}.html`, served by `src/site.ts` at `/docs`, `/privacy`, `/terms` and `/support`, with `?lang=vi` for Vietnamese;
  - the icon, as `public/icon.svg` and `public/icon-512.png`;
  - self-service account deletion and 90-day audit retention, added to migration 018 so the privacy page promises only what the code does;
  - screenshots in `docs/directory/evidence/pages/`, made by `scripts/directory/screenshot_pages.mjs`;
  - `REVIEWER_WALKTHROUGH.md`, whose expected results were checked against a sandbox run.
  Tests: `site-pages` 3, plus deletion tests in `oauth-flow` and `db/oauth-db`.

- Phase 3 prep:
  - The CDK stack (29 resources) passes `cdk synth`.
  - `scripts/directory/{oauth_smoke,create_reviewer,inspector_oauth_evidence}.mjs` all ran against a **local** server on Postgres, using the least-privilege runtime role:
    - `oauth_smoke`: 31/31 checks, including every tool (`evidence/oauth-smoke-local-postgres.json`);
    - MCP Inspector 2.8.0 OAuth flow: 401 → DCR → sign-in → consent → connected → tool call (`evidence/inspector-oauth-local-*`).
  - **Not yet run against a deployed URL.**

- Phase 5 added:
  - `plugins/shopvoice`: `plugin.json`, `.mcp.json` (placeholder host `SHOPVOICE_HOST`), 4 skills, 2 commands, a README and the MIT LICENSE;
  - `evals/`: 4 cases, with mocks generated from the real server output;
  - `PLUGIN_EVAL.md`, recording that the restock skill was fixed after scoring 0.58 and now scores 1.00;
  - `scripts/directory/build_plugin.mjs`, which fills in the host, adds the plugin repo's CI (`claude plugin validate` plus the directory rules), validates and zips.
  - In Claude Code, `claude --plugin-dir` against the local server loads the 4 skills and 2 commands, and the server is correctly reported as needing OAuth.

## Next

Phase 3: the deploy is blocked on AWS (DB1). The owner confirmed on 2026-09-27 that the CloudFront domain is fine. `AWS_SETUP_CHROME.md` is the owner's step-by-step guide, for Claude in Chrome:
- budget alert;
- IAM user and access key;
- Bedrock Nova access;
- replacing the key in the Claude Code environment;
- a hand-off prompt for a new session;
- a keyless CloudShell fallback.

Once a new session has a working key: deploy → reviewer → smoke/Inspector evidence → push the plugin repo → `check_kit --host` → Checkpoint B.

## Blockers

See `BLOCKERS.md`: DB1 (AWS credentials rejected). DB2 is resolved: Checkpoint A was answered on 2026-09-27.

## Unverified / owner-only

- Custom-connector test in Claude, portal submission, and "Published" status: only the owner can confirm these.

## Definition of Done (SPEC §8): state on 2026-09-27

- [x] `npm run typecheck && npm run lint && npm test` are green:
  - without a DB: 225 plus 26 tests, 0 failures;
  - with Postgres: 215 plus 56 (5 skipped), and the RLS and bootstrap gates pass.
  - New tests: `oauth-core`, `oauth-flow`, `mcp-chat-profile`, `site-pages` and `db/oauth-db`.
- [ ] Deployed public HTTPS, `/.well-known/*` reachable, and the 401 handshake shown with `curl -i`. **Blocked (DB1).** Locally, `oauth_smoke` checks all three.
- [ ] End-to-end OAuth in MCP Inspector against the **deployed** URL. Done against the **local** server (`evidence/inspector-oauth-local-*`); the deployed run is blocked (DB1).
- [ ] Every tool called on the deployed server with the reviewer account. Done **locally** against Postgres (`evidence/oauth-smoke-local-postgres.json`, 31/31); the deployed run is blocked (DB1).
- [ ] Custom-connector test in Claude. The steps are in `OWNER_CLAUDE_TEST.md`; it is **owner-only and not yet verified**.
- [ ] Plugin:
  - `claude plugin validate` passes, and the README and LICENSE are present;
  - `.mcp.json` gets the deployed URL at build time;
  - **the repo is not pushed yet** (DB3, waiting for the host).
- [ ] Docs, privacy, terms and support pages, and the icon, are committed and served. The kit is complete, and its lengths are checked by a script. **Live only after the deploy.**
- [x] The Alexa simulator and the e2e voice flow still pass (5/5). `DEVPOST_SUBMISSION.md` is updated, with ⚠️ markers where the deploy is pending, and claims neither "submitted" nor "listed".
- [x] No secrets in git:
  - each commit was scanned before push;
  - `.env.example` and `docs/ops/SECRETS.md` are updated;
  - the reviewer password lives only in SSM or a 0600 file.
