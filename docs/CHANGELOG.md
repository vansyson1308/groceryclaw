# Changelog

## v0.1.0 - Production-ish RC
- Added runnable n8n + Postgres scaffold and migration-driven schema.
- Added workflow set for webhook ingestion, XML/image parsing, mapping fallback, PO creation, draft flow, pricing, monitoring, retention.
- Added security hardening (signature verification, replay guard, input validation, secrets/retention docs).
- Added deployment packaging (CI workflow, workflow validator, backup/restore scripts, deployment/runbook docs).
- Added onboarding docs for import order and smoke testing.

## Notes
- This is a release candidate baseline intended for controlled pilot rollout.
- Production rollout should include real secret manager integration, ingress TLS hardening, and staged environment promotion.
