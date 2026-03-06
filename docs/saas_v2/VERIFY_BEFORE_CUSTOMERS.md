# Verify Before Customers (V2)

Use this short checklist before onboarding real customer traffic.

## 1) Deployment and runtime health

- [ ] `kubectl get deploy,pods,svc,ingress -n groceryclaw-v2` shows healthy resources.
- [ ] Gateway `/healthz` returns `200`.
- [ ] Gateway `/readyz` returns `200` (DB + Redis healthy).
- [ ] Migration job completed successfully.
- [ ] Smoke job completed successfully (`v2-smoke`).

## 2) Security boundaries

- [ ] Admin is private-only (ClusterIP, no default public ingress).
- [ ] Postgres and Redis are private-only.
- [ ] `WEBHOOK_VERIFY_MODE=mode1` in production.
- [ ] Real secrets are in secret manager / Kubernetes secrets (not in Git).

## 3) Functional correctness

- [ ] Webhook endpoint configured to `https://api.<domain>/webhooks/zalo`.
- [ ] Signed webhook test accepted (HTTP 200) and job processing confirmed.
- [ ] Invite onboarding works for test tenant.
- [ ] Canary tenant mode switch (`legacy` <-> `v2`) verified.

## 4) Observability and alerts

- [ ] `kubectl apply -k infra/k8s/observability -n groceryclaw-v2` applied.
- [ ] ServiceMonitors present and targets up.
- [ ] PrometheusRules loaded; alert routes configured in Alertmanager.
- [ ] Runbooks linked in on-call docs.

## 5) Reliability / rollback readiness

- [ ] Rollback commands tested (`kubectl rollout undo ...`).
- [ ] Backup/restore process reviewed.
- [ ] On-call knows where runbook/troubleshooting docs live.

## Must-read references

- Release checklist: `docs/saas_v2/RELEASE_CHECKLIST.md`
- Runbook: `docs/saas_v2/RUNBOOK.md`
- Security checklist: `docs/saas_v2/SECURITY_CHECKLIST.md`
- SLO gates: `docs/saas_v2/SLO_GATES.md`
- Troubleshooting: `docs/saas_v2/TROUBLESHOOTING_K8S.md`
