# ADR-0001: Minimal Stack and Repository Structure

- **Status:** Accepted
- **Date:** 2026-02-27
- **Deciders:** Engineering
- **Context Source:** `KIOTVIET-TAPHOA_TECHNICAL_PRD_V4.md`

## Context
The repository currently starts from PRD-first documentation with no implementation scaffold. The PRD mandates n8n orchestration, PostgreSQL persistence, KiotViet integration, Zalo webhook handling, and optional OpenAI Vision parsing.

We need a minimal, production-leaning structure that supports incremental delivery, testing, and secure operations without over-engineering phase 0.

## Decision
Adopt a **workflow-first architecture** with lightweight supporting code:

1. **Runtime platform:** Docker Compose with `n8n` + `postgres`.
2. **Data evolution:** SQL migrations under a dedicated migrations folder (append-only, reversible where possible).
3. **Workflow source control:** export n8n workflows to versioned JSON files under `n8n/workflows/`.
4. **Pure logic tests:** if custom code nodes grow beyond trivial snippets, add a minimal Node/TypeScript harness for unit tests of:
   - signature verification
   - invoice normalization
   - 3-tier mapping decision logic
   - conversion-rate calculations
5. **Docs-first governance:** maintain ADRs and runbooks under `/docs` to record assumptions and secure defaults.

## Proposed Repository Structure
```text
/docs
  /decisions
    ADR-0001-stack.md
  ROADMAP.md
  ARCHITECTURE.md
  ENV_VARS.md

/n8n
  /workflows
    (exported workflow JSON)

/db
  /migrations
    (SQL migration files)

/tests
  (optional Node/TS pure logic tests when introduced)
```

## Consequences
### Positive
- Fastest route to Phase 0→3 delivery with clear source control.
- Low operational overhead while preserving production migration path.
- Enables deterministic tests for security-critical logic (signature + mapping rules).

### Trade-offs
- n8n code-node logic can become harder to maintain if not extracted early.
- Requires disciplined workflow export/versioning to avoid drift.

## Security Notes
- Never commit real secrets.
- Keep `.env` ignored and provide `.env.example` placeholders.
- Enforce signature verification and dedup guards before downstream side effects.
- Restrict DB privileges and audit token storage lifecycle.

## Revisit Trigger
Revisit this ADR when:
- Multiple services beyond n8n are added.
- Throughput/SLA requires moving core logic from code nodes into a dedicated service.
- Compliance requirements demand stricter secret management or audit trails.
