# Kubernetes Monitoring (V2)

This guide adds monitoring without exposing private metrics publicly.

## 1) Install kube-prometheus-stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace
```

Expected:
- Prometheus, Alertmanager, Grafana pods in `monitoring` namespace.

```bash
kubectl get pods -n monitoring
```

## 2) Apply GroceryClaw monitors and alert rules

```bash
kubectl apply -k infra/k8s/observability -n groceryclaw-v2
kubectl get servicemonitor,prometheusrule -n groceryclaw-v2
```

What gets installed:
- `ServiceMonitor` for private `worker-metrics` service.
- `PrometheusRule` alerts for queue lag, worker failure ratio, notifier backlog.
- Placeholder (disabled) rules for gateway ACK p95, webhook auth failures, and DLQ spikes until those metrics are exported.

## 3) Keep metrics private

- Worker metrics are exposed only on in-cluster `ClusterIP` service (`worker-metrics:9090`).
- No public ingress is created for metrics.

## 4) Grafana quick checks

After port-forward:

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```

Look for these signals:
- `groceryclaw_worker_queue_lag_ms_total / ...samples_total` trend up.
- `groceryclaw_worker_job_failures_total` spikes.
- `groceryclaw_notifier_pending_backlog` sustained above alert threshold.

## 5) Alert tuning notes

Current worker metrics export counters and gauges, not histograms.
- Queue lag alert uses moving average (proxy for p95).
- For strict ACK p95 SLO alerting, add gateway histogram metric export and then enable the placeholder rules.

## 6) Troubleshooting

```bash
kubectl describe servicemonitor groceryclaw-worker -n groceryclaw-v2
kubectl logs deploy/worker -n groceryclaw-v2 --tail=200
kubectl get endpoints worker-metrics -n groceryclaw-v2
```

If `worker-metrics` has no endpoints, check worker pod readiness and container port `9090`.
