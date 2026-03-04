# Kubernetes Prerequisites & Hardening (V2 Production)

This guide is a copy/paste path for operators. It keeps **Gateway public only** and keeps **Admin private by default**.

## 0) Safety defaults (read first)

- Only `gateway` gets Ingress.
- `admin` stays internal (`ClusterIP`) and is accessed via port-forward by default.
- Never commit plaintext secrets.
- Use External Secrets operator (recommended) for production.

## 1) Install tools locally

```bash
kubectl version --client
helm version
```

If missing, install `kubectl` and `helm` from official docs.

## 2) Create a managed cluster

Create any managed Kubernetes cluster (EKS/GKE/AKS/DO, etc.).

Then set context:

```bash
kubectl config get-contexts
kubectl config use-context <your-context>
```

## 3) Install ingress-nginx

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

## 4) Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true
```

Apply ClusterIssuers:

```bash
kubectl apply -k infra/k8s/prereqs
kubectl get clusterissuer
```

## 5) Install metrics-server

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system
```

## 6) Install external-secrets operator (recommended)

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update
helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace
```

Create your own `ClusterSecretStore` for your cloud provider (outside this repo).

## 7) Secrets modes

### Mode A (recommended): External Secrets

1. Configure your cloud secret store.
2. Create `ClusterSecretStore` named `cloud-secret-store`.
3. Apply example mapping after editing keys:

```bash
kubectl apply -n groceryclaw-v2 -f infra/k8s/overlays/prod/external-secrets.example.yaml
```

### Mode B (dev only): manual secret creation

```bash
kubectl create namespace groceryclaw-v2
kubectl -n groceryclaw-v2 create secret generic app-secrets \
  --from-literal=POSTGRES_URL='postgres://...' \
  --from-literal=REDIS_URL='redis://...' \
  --from-literal=WEBHOOK_SIGNATURE_SECRET='replace-me' \
  --from-literal=ADMIN_INVITE_PEPPER='replace-me' \
  --from-literal=ADMIN_MEK_B64='replace-me-b64' \
  --from-literal=WORKER_MEK_B64='replace-me-b64'
```

## 8) Deploy app manifests

```bash
kubectl apply -k infra/k8s/overlays/prod
kubectl get deploy,svc,ingress,networkpolicy -n groceryclaw-v2
```

Run migrations before rollout:

```bash
kubectl create job --from=job/db-v2-migrate db-v2-migrate-$(date +%s) -n groceryclaw-v2
```

## 9) DNS + TLS verification

1. Point `api.<your-domain>` to ingress controller external IP.
2. Confirm certificate:

```bash
kubectl describe certificate -n groceryclaw-v2
kubectl get ingress -n groceryclaw-v2
```

## 10) Admin access (private by default)

```bash
kubectl -n groceryclaw-v2 port-forward svc/admin 8081:80
```

Access admin on `http://127.0.0.1:8081` (OIDC still required at app layer).

> Optional (not recommended): `infra/k8s/overlays/prod-admin-ingress` enables restricted Admin Ingress with IP allowlist.

## 11) Network policy notes

- Base policies default-deny ingress and allow only required ingress/egress.
- Worker requires internet egress to reach KiotViet/Zalo.
- Restricting worker egress to exact FQDNs requires CNI support for FQDN policies (Cilium/Calico variants).
- Safe default in this template: allow `443` egress for worker, keep SSRF guard and monitoring enabled.

## 12) Rollback/uninstall commands

Helm components:

```bash
helm uninstall ingress-nginx -n ingress-nginx
helm uninstall cert-manager -n cert-manager
helm uninstall metrics-server -n kube-system
helm uninstall external-secrets -n external-secrets
```

App overlay:

```bash
kubectl delete -k infra/k8s/overlays/prod
```

Network policies can be removed independently if you need emergency recovery:

```bash
kubectl delete -f infra/k8s/base/networkpolicy.yaml -n groceryclaw-v2
```
