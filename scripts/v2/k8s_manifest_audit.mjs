import fs from 'node:fs';
import path from 'node:path';

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

const read = (p) => fs.readFileSync(p, 'utf8');

const prodIngress = read('infra/k8s/overlays/prod/ingress.yaml');
if (!/kind:\s*Ingress/.test(prodIngress) || !/name:\s*gateway/.test(prodIngress)) {
  fail('prod overlay ingress.yaml must define gateway ingress');
}
if (/name:\s*admin\b/.test(prodIngress)) {
  fail('prod overlay ingress.yaml must not expose admin ingress');
}

const adminIngressOverlay = read('infra/k8s/overlays/prod-admin-ingress/admin-ingress.yaml');
if (!/name:\s*admin\b/.test(adminIngressOverlay) || !/whitelist-source-range/.test(adminIngressOverlay)) {
  fail('optional admin ingress overlay must include admin ingress + source allowlist');
}

const services = read('infra/k8s/base/services.yaml');
if (!/name:\s*gateway/.test(services) || !/type:\s*ClusterIP/.test(services)) {
  fail('gateway service must be ClusterIP');
}
if (!/name:\s*admin/.test(services)) {
  fail('admin service missing');
}
if (/NodePort|LoadBalancer/.test(services)) {
  fail('base services must not expose NodePort/LoadBalancer');
}

for (const file of [
  'infra/k8s/base/gateway-deployment.yaml',
  'infra/k8s/base/admin-deployment.yaml',
  'infra/k8s/base/worker-deployment.yaml'
]) {
  const c = read(file);
  if (!/readinessProbe:/m.test(c) || !/livenessProbe:/m.test(c)) {
    fail(`${file} missing probes`);
  }
  if (!/resources:\n\s+requests:/m.test(c) || !/limits:/m.test(c)) {
    fail(`${file} missing resource requests/limits`);
  }
  if (!/runAsNonRoot:\s*true/.test(c) || !/readOnlyRootFilesystem:\s*true/.test(c)) {
    fail(`${file} missing required securityContext hardening`);
  }
}

const netpol = read('infra/k8s/base/networkpolicy.yaml');
for (const token of ['default-deny-ingress', 'allow-gateway-from-ingress-nginx', 'allow-egress-dns']) {
  if (!netpol.includes(token)) fail(`network policy missing ${token}`);
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log('PASS: static k8s manifest audit checks passed.');
