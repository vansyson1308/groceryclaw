# V2 Security Checklist (Go/No-Go)

## CI-enforced baseline
- [ ] **CodeQL** workflow passes (`security-baseline.yml` / `codeql` job).
- [ ] **Dependency audit** passes (`npm audit --omit=dev --audit-level=high`).
  - Blocks merge on high/critical by default.
  - Temporary rollback switch: `SECURITY_AUDIT_WARN_ONLY=true`.
- [ ] **Secret scan** passes (`gitleaks` job with `.gitleaks.toml`).
- [ ] Security unit tests pass:
  - SSRF restrictions and redirect handling.
  - Webhook auth failure modes and prod mode guards.
  - Admin private-boundary checks.
  - Logger secret scrubbing checks.

## Webhook signature go/no-go (prod)
- [ ] `WEBHOOK_VERIFY_MODE=mode1` in production.
- [ ] Signature secret rotated and stored securely.
- [ ] Mode2 is disabled in production unless emergency override is explicitly approved.
- [ ] Rejection rates monitored (`webhook_auth_fail`).

## Admin plane go/no-go
- [ ] Admin remains private-only (no public bind / no host-exposed compose port).
- [ ] OIDC validation enabled with correct issuer/audience/jwks.
- [ ] Break-glass disabled by default and audited when enabled.

## Secrets lifecycle controls
- [ ] Secret rotate/revoke endpoints available and tested.
- [ ] No plaintext secrets returned by list endpoints.
- [ ] Logs and audits redact token/secret material.
- [ ] Rotation runbook validated before prod cutover.

## Incident response pointers
- Webhook spoof/auth spike: `docs/RUNBOOK.md` (V2 incident playbooks).
- Secret compromise branch and revoke flow: `docs/saas_v2/ROLLBACK_DRILL.md`.
- Canary rollback and backout commands: `docs/saas_v2/RELEASE_CHECKLIST.md`.

## Secret scan verification (manual)
- To validate scanner efficacy, add a temporary fake credential line such as `OPENAI_API_KEY=sk-test-123` in a throwaway branch and run:
  - `gitleaks detect --source . --config .gitleaks.toml`
- Expected: gitleaks fails and reports the candidate secret.
