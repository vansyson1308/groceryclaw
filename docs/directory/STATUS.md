# ShopVoice on the Claude directory: status

Updated at the end of every phase. The plan is in `SPEC.md` (source: SPEC 04), the requirements in `REQUIREMENTS_DIGEST.md`, and deviations in `DECISIONS.md`.

**Last update:** 2026-09-27, Phases 0–2 done.
**Branch:** `feat/claude-directory`

## Checklist

- [x] Phase 0: branch; SPEC, STATUS, DECISIONS, BLOCKERS and REQUIREMENTS_DIGEST written; AWS check (fails, DB1); Checkpoint A asked
- [x] Phase 1: OAuth 2.1 authorization server (migration 018, metadata, DCR, CIMD, authorize/consent, token, revoke, account page) and tests
- [x] Phase 2: MCP adjustments (protocol decision, Claude reorder path, markdown content, instructions, Origin regression test, errors, description audit)
- [ ] Phase 3: deploy (CDK: OAuth routes, `/.well-known` at the root, pages, backups, alarms), smoke test, reviewer account, `DEPLOYMENT.md`, deployed Devpost evidence
- [ ] Phase 4: public pages (`/docs`, `/privacy`, `/terms`, `/support`), icon, `REVIEWER_WALKTHROUGH.md`
- [ ] Phase 5: plugin bundle, validate, evals, zip, `shopvoice-plugin` repo
- [ ] Phase 6: Inspector OAuth evidence, every tool called on the deployed server, `OWNER_CLAUDE_TEST.md`, Checkpoint B
- [ ] Phase 7: `SUBMISSION_KIT.md` with limits checked by a script, Devpost update, PR, Checkpoint C

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

## Next

Phase 3: the deploy is blocked on AWS (DB1). Before it, do Phase 4 (pages and icon), Phase 5 (plugin) and the CDK changes that can be synthesized without credentials.

## Blockers

See `BLOCKERS.md`: DB1 (AWS credentials rejected) and DB2 (Checkpoint A answers).

## Unverified / owner-only

- Custom-connector test in Claude, portal submission, and "Published" status: only the owner can confirm these.
