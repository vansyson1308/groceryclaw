# ShopVoice on the Claude directory: status

Updated at the end of every phase. The plan is in `SPEC.md` (source: SPEC 04), the requirements in `REQUIREMENTS_DIGEST.md`, and deviations in `DECISIONS.md`.

**Last update:** 2026-09-27, Phase 0 done.
**Branch:** `feat/claude-directory`

## Checklist

- [x] Phase 0: branch; SPEC, STATUS, DECISIONS, BLOCKERS and REQUIREMENTS_DIGEST written; AWS check (fails, DB1); Checkpoint A asked
- [ ] Phase 1: OAuth 2.1 authorization server (migration 018, metadata, DCR, CIMD, authorize/consent, token, revoke, account page) and tests
- [ ] Phase 2: MCP adjustments (protocol decision, Claude reorder path, markdown content, instructions, Origin regression test, errors, description audit)
- [ ] Phase 3: deploy (CDK: OAuth routes, `/.well-known` at the root, pages, backups, alarms), smoke test, reviewer account, `DEPLOYMENT.md`, deployed Devpost evidence
- [ ] Phase 4: public pages (`/docs`, `/privacy`, `/terms`, `/support`), icon, `REVIEWER_WALKTHROUGH.md`
- [ ] Phase 5: plugin bundle, validate, evals, zip, `shopvoice-plugin` repo
- [ ] Phase 6: Inspector OAuth evidence, every tool called on the deployed server, `OWNER_CLAUDE_TEST.md`, Checkpoint B
- [ ] Phase 7: `SUBMISSION_KIT.md` with limits checked by a script, Devpost update, PR, Checkpoint C

## Done

- Read the Anthropic connector and plugin docs plus the MCP authorization spec, and wrote the digest.
- Protocol check: MCP `2026-07-28` is current, but no SDK supports it yet, so we stay on `2025-11-25` (DD2).
- Recon: the server is stateful Streamable HTTP with static bearer tokens resolved by SHA-256 through `resolve_mcp_access_token`. There are 9 tools with annotations.

## Next

Phase 1: write the tests for the security code first, then migration 018 and `apps/mcp-server/src/oauth/`.

## Blockers

See `BLOCKERS.md`: DB1 (AWS credentials rejected) and DB2 (Checkpoint A answers).

## Unverified / owner-only

- Custom-connector test in Claude, portal submission, and "Published" status: only the owner can confirm these.
