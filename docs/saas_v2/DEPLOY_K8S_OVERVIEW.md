# Kubernetes Deployment Overview (V2 Option B)

This document explains the additive Kubernetes templates under `infra/k8s/`.

## Scope and boundary rules

- **Gateway is the only public surface.**
- **Admin, Postgres, and Redis are private/internal only.**
- Prod overlay creates Ingress for Gateway only (`api.<domain>`).
- No `LoadBalancer`/`NodePort` services for app pods.

## Directory layout

```text
infra/k8s/
  prereqs/
    cluster-issuers.yaml
    ingress-certmanager-annotations-example.yaml
  observability/
    service-monitor-worker.yaml
    prometheus-rules-v2.yaml
  backup/
    pgdump-cronjob.example.yaml
  base/
    namespace.yaml
    serviceaccounts.yaml
    rbac.yaml
    configmap.yaml
    gateway-deployment.yaml
    worker-deployment.yaml
    admin-deployment.yaml
    services.yaml
    hpa.yaml
    pdb.yaml
    networkpolicy.yaml
    migrate-job.yaml
  overlays/
    prod/
      kustomization.yaml
      ingress.yaml
      patches/
      secrets.example.yaml
      external-secrets.example.yaml
    prod-admin-ingress/
      kustomization.yaml
      admin-ingress.yaml
```

## Base resources

- `base/configmap.yaml`: canonical non-secret env defaults and feature flags.
- Deployments (`gateway`, `worker`, `admin`) include:
  - readiness/liveness probes
  - requests/limits
  - pod/container security context (`runAsNonRoot`, dropped caps, read-only root fs)
  - `automountServiceAccountToken: false`
- `base/rbac.yaml`: minimal no-API-access role bindings for app service accounts.
- `base/services.yaml`:
  - `gateway` ClusterIP service
  - `admin` ClusterIP service
  - `worker-metrics` ClusterIP service (private Prometheus scraping)
  - no public worker service
- `base/networkpolicy.yaml`:
  - default deny ingress
  - gateway ingress only from ingress-nginx namespace
  - DNS egress allowed
  - app->postgres/redis egress allowed
  - worker HTTPS internet egress allowed (for external APIs)
- `base/hpa.yaml`: CPU-based HPAs for gateway and worker.
- `base/pdb.yaml`: disruption budgets to preserve availability.
- `base/migrate-job.yaml`: one-off migration job using `npm run db:v2:migrate`.

## Prod overlay

- `overlays/prod/ingress.yaml` routes only `api.example.com` to `gateway`.
- TLS enabled and cert-manager issuer annotation included.
- nginx rate-limit annotations included as placeholders.
- `secrets.example.yaml` and `external-secrets.example.yaml` are templates only.

## Optional admin ingress overlay (off by default)

`overlays/prod-admin-ingress` adds restricted Admin Ingress with source IP allowlist.

> Not recommended unless you fully understand the risk model. Preferred access is port-forward + OIDC.

## How to deploy

1. Follow prerequisites in `docs/saas_v2/DEPLOY_K8S_PREREQS.md`.
2. Review image tags in `infra/k8s/overlays/prod/kustomization.yaml`.
3. Create secrets via External Secrets (recommended) or manual Secret (dev-only).
4. Dry render:
   ```bash
   kubectl kustomize infra/k8s/overlays/prod
   ```
5. Apply manifests:
   ```bash
   kubectl apply -k infra/k8s/overlays/prod
   ```
6. Run migration job before app rollout:
   ```bash
   kubectl create job --from=job/db-v2-migrate db-v2-migrate-$(date +%s) -n groceryclaw-v2
   ```

## Validation checks

```bash
kubectl get ingress,svc,deploy,pods,hpa,pdb,networkpolicy -n groceryclaw-v2
kubectl get ingress -n groceryclaw-v2
kubectl get svc -n groceryclaw-v2
```

Expected:
- Ingress exists only for `gateway` (unless admin ingress overlay explicitly applied).
- `gateway` and `admin` services are `ClusterIP`.
- pods become `Ready` based on probes.


## Monitoring and backups

- Monitoring install + alerts: `docs/saas_v2/DEPLOY_K8S_MONITORING.md`
- Backup/restore strategy + CronJob example: `docs/saas_v2/DEPLOY_K8S_BACKUP.md`
- Observability manifests: `infra/k8s/observability/`
- Backup CronJob template (disabled by default): `infra/k8s/backup/pgdump-cronjob.example.yaml`

## Post-deploy smoke

Run after each deploy:

```bash
WEBHOOK_SIGNATURE_SECRET='<secret>' npm run k8s:smoke
```

## Rollback

```bash
kubectl rollout undo deployment/gateway -n groceryclaw-v2
kubectl rollout undo deployment/worker -n groceryclaw-v2
kubectl rollout undo deployment/admin -n groceryclaw-v2
```

Also see:
- `docs/saas_v2/DEPLOY_K8S_PREREQS.md`
- `docs/saas_v2/ROLLBACK_DRILL.md`
- `docs/saas_v2/RELEASE_CHECKLIST.md`
