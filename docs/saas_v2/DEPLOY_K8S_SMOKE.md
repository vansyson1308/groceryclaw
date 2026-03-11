# Kubernetes Smoke Job (V2 Prod Overlay)

Use this smoke job after `kubectl apply -k infra/k8s/overlays/prod` to verify cluster wiring:

1. Gateway readiness endpoint is reachable from inside the cluster.
2. Gateway accepts a signed webhook.
3. The webhook creates an `inbound_events` row in Postgres.

## Manifest

- `infra/k8s/overlays/prod/smoke-job.yaml`
- Includes a dedicated `ServiceAccount` with `automountServiceAccountToken: false`.
- No Kubernetes API permissions are required.

## Run

```bash
kubectl apply -f infra/k8s/overlays/prod/smoke-job.yaml
kubectl wait --for=condition=complete -n groceryclaw-v2 job/v2-smoke --timeout=180s
kubectl logs -n groceryclaw-v2 job/v2-smoke
```

If you need to re-run:

```bash
kubectl delete job -n groceryclaw-v2 v2-smoke --ignore-not-found
kubectl apply -f infra/k8s/overlays/prod/smoke-job.yaml
```

## Requirements

The `app-secrets` secret must include:

- `DB_APP_URL`
- `WEBHOOK_SIGNATURE_SECRET`

## Notes

- This smoke job is intentionally internal-only and uses ClusterIP DNS (`http://gateway`).
- It does not require external APIs and does not expose additional ingress.
- For local operator workflow, you can still use `npm run k8s:smoke` from your workstation.
