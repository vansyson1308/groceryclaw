# Kubernetes Monitoring (V2)

This guide adds private, in-cluster metrics scraping and SLO-aligned alerts.

## 1) Install kube-prometheus-stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace
```

Verify components:

```bash
kubectl get pods -n monitoring
```

## 2) Apply GroceryClaw observability manifests

```bash
kubectl apply -k infra/k8s/observability -n groceryclaw-v2
kubectl get servicemonitor,prometheusrule -n groceryclaw-v2
```

Installed resources:

- `ServiceMonitor` for `gateway-metrics` (`/metrics` on port `9100`)
- `ServiceMonitor` for `admin-metrics` (`/metrics` on port `9101`)
- `ServiceMonitor` for `worker-metrics` (`/metrics` on port `9090`)
- `PrometheusRule` groups for availability and SLO-risk alerts.

## 3) Privacy model

Metrics remain private:

- metrics services are `ClusterIP` only
- no metrics ingress is created
- gateway ingress still points to app service only (`gateway:80`), not `gateway-metrics`

## 4) Alert coverage

`infra/k8s/observability/prometheusrules.yaml` includes:

- `GroceryclawGatewayReadyDown` / `GroceryclawAdminReadyDown`
- `GroceryclawDbDependencyFailureSpike`
- `GroceryclawRedisDependencyFailureSpike`
- `GroceryclawAckLatencyProxyHigh` (average ACK latency proxy using total/count)
- `GroceryclawQueueLagHigh`
- `GroceryclawWebhookAuthFailSpike`
- `GroceryclawNotifierPendingBacklogHigh`
- `GroceryclawDlqSpike` (disabled placeholder until explicit DLQ metric exists)

> Note: ACK p95 histogram is not exported yet. The ACK alert currently uses average latency as a conservative proxy.

## 5) Grafana quick checks

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```

Suggested queries:

- `rate(groceryclaw_gateway_webhook_ack_ms_total[5m]) / clamp_min(rate(groceryclaw_gateway_webhook_ack_ms_count[5m]),1)`
- `increase(groceryclaw_gateway_webhook_auth_failures_total[10m])`
- `rate(groceryclaw_worker_queue_lag_ms_total[5m]) / clamp_min(rate(groceryclaw_worker_queue_lag_samples_total[5m]),1)`
- `groceryclaw_notifier_pending_backlog`
- `increase(groceryclaw_gateway_dependency_failures_total[10m])`

## 6) Tuning knobs

Tune alert thresholds in `infra/k8s/observability/prometheusrules.yaml`:

- time windows (`[5m]`, `[10m]`)
- thresholds (`> 500`, `> 30`, backlog limits)
- severity labels (`info`, `warning`, `critical`)

Keep thresholds conservative to avoid noisy paging.

## 7) Validation

CI validates renderability for both production and observability kustomizations via:

```bash
npm run k8s:kustomize:check
```

## 8) Troubleshooting

```bash
kubectl describe servicemonitor groceryclaw-gateway -n groceryclaw-v2
kubectl describe servicemonitor groceryclaw-admin -n groceryclaw-v2
kubectl describe servicemonitor groceryclaw-worker -n groceryclaw-v2
kubectl get endpoints gateway-metrics admin-metrics worker-metrics -n groceryclaw-v2
```

If endpoints are empty, confirm pods are Ready and metrics ports are listening.
