# Workflow Versioning Discipline

## Rules
1. Every workflow change must be exported to `n8n/workflows/*.json` in same PR.
2. Workflow exports must remain secret-free.
3. Run `./scripts/validate_workflows.sh` before commit.
4. Keep workflow names stable; if replacing behavior, document in workflow runbook.

## Validation gate
`validate_workflows.sh` enforces:
- valid JSON for all exported workflow files
- no suspicious secrets/token patterns in exports

## Recommended PR checklist
- [ ] Workflow JSON updated
- [ ] Related docs updated
- [ ] `validate_workflows.sh` passed
- [ ] no secrets/tokens in diff
