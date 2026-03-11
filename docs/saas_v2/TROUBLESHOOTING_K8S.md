# Kubernetes Troubleshooting (V2)

Use this guide when production template deployment is not healthy.

## 1) Pods in `CrashLoopBackOff`

Check pod state and logs:

```bash
kubectl get pods -n groceryclaw-v2
kubectl describe pod <pod-name> -n groceryclaw-v2
kubectl logs <pod-name> -n groceryclaw-v2 --previous
```

Common causes:
- missing/incorrect `app-secrets` keys (`DB_APP_URL`, `DB_ADMIN_URL`, `REDIS_URL`)
- invalid image tag in `infra/k8s/overlays/prod/kustomization.yaml`
- malformed env values (bad URL format)

## 2) cert-manager TLS remains pending

```bash
kubectl get certificate -n groceryclaw-v2
kubectl describe certificate gateway-tls -n groceryclaw-v2
kubectl get challenges -A
kubectl get orders -A
```

Check:
- DNS `api.<your-domain>` points to ingress external address
- `ClusterIssuer` exists and is healthy
- ingress annotations still include cert-manager issuer

## 3) `/readyz` returns 503

`/readyz` means dependency readiness (DB + Redis). A 503 is expected when either dependency fails.

```bash
kubectl logs deploy/gateway -n groceryclaw-v2 --tail=200
kubectl logs deploy/admin -n groceryclaw-v2 --tail=200
kubectl logs deploy/worker -n groceryclaw-v2 --tail=200
```

Then verify connectivity and credentials for DB/Redis secrets.

## 4) Worker not ready

Worker readiness/liveness must target:
- `GET /readyz`
- `GET /healthz`
- on `WORKER_HEALTH_PORT` (default `3002`)

Check probes and pod events:

```bash
kubectl describe deploy worker -n groceryclaw-v2
kubectl describe pod <worker-pod> -n groceryclaw-v2
```

## 5) Redis auth errors

Symptoms: queue auth failures, worker cannot consume jobs.

Validate secret:

```bash
kubectl -n groceryclaw-v2 get secret app-secrets -o jsonpath='{.data.REDIS_URL}' | base64 -d; echo
```

Ensure URL format includes password if required:
- `redis://:password@redis.internal:6379/0`

## 6) Invite flow fails

Usually caused by pepper mismatch.

Check both gateway/admin use the same `INVITE_PEPPER_B64` value and DB function uses that value via session setting.

## 7) Webhook auth failing (401/403)

Checklist:
- provider signs payload with the same `WEBHOOK_SIGNATURE_SECRET`
- signature header matches expected header (`x-zalo-signature` by default)
- body is raw JSON and not modified by upstream proxy
- `WEBHOOK_VERIFY_MODE=mode1` in production

## 8) Queue backlog keeps growing

Check backlog and scaling:

```bash
kubectl get hpa -n groceryclaw-v2
kubectl top pods -n groceryclaw-v2
kubectl logs deploy/worker -n groceryclaw-v2 --tail=200
```

Actions:
- increase worker replicas / HPA limits
- inspect Redis health and latency
- inspect downstream dependency latency (DB/provider)

## 9) Smoke job fails

```bash
kubectl logs -n groceryclaw-v2 job/v2-smoke
kubectl describe job v2-smoke -n groceryclaw-v2
```

Frequent causes:
- gateway not ready yet
- wrong `WEBHOOK_SIGNATURE_SECRET`
- DB not reachable from cluster network

## 10) Admin access confusion

Admin is private by default. Use port-forward:

```bash
kubectl -n groceryclaw-v2 port-forward svc/admin 8081:80
```

Do **not** expose admin publicly unless you intentionally apply optional admin-ingress overlay and understand the risk model.

## Related docs

- `docs/saas_v2/DEPLOY_K8S_PREREQS.md`
- `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md`
- `docs/saas_v2/DEPLOY_K8S_SMOKE.md`
- `docs/saas_v2/RUNBOOK.md`
