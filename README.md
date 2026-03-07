# GroceryClaw

[![V2 CI](https://github.com/vansyson1308/groceryclaw/actions/workflows/v2-ci.yml/badge.svg)](https://github.com/vansyson1308/groceryclaw/actions/workflows/v2-ci.yml)
[![Security Baseline](https://github.com/vansyson1308/groceryclaw/actions/workflows/security-baseline.yml/badge.svg)](https://github.com/vansyson1308/groceryclaw/actions/workflows/security-baseline.yml)

**GroceryClaw** la nen tang xu ly hoa don va van hanh tu dong cho cac cua hang tap hoa, tich hop voi Zalo (kenh nhan tin) va KiotViet (quan ly ban hang). He thong nhan don hang tu Zalo, phan tich hoa don, dong bo vao KiotViet va gui thong bao lai cho khach.

> **Phien ban hien tai:** `v0.1.0-rc.1` (Release Candidate)
> **Changelog:** `CHANGELOG.md` | **Release notes:** `docs/saas_v2/RELEASE_NOTES_v0.1.0-rc.1.md`

---

## Muc luc

- [GroceryClaw lam gi?](#groceryclaw-lam-gi)
- [Kien truc tong quan](#kien-truc-tong-quan)
- [Chon che do nao? Legacy hay V2?](#chon-che-do-nao-legacy-hay-v2)
- [PHAN 1: Chay thu tren may tinh ca nhan (Local)](#phan-1-chay-thu-tren-may-tinh-ca-nhan-local)
- [PHAN 2: Deploy len VPS don (1 may chu)](#phan-2-deploy-len-vps-don-1-may-chu)
- [PHAN 3: Deploy len Kubernetes (Production)](#phan-3-deploy-len-kubernetes-production)
- [Van hanh hang ngay](#van-hanh-hang-ngay)
- [Cap nhat phien ban moi](#cap-nhat-phien-ban-moi)
- [Xu ly su co thuong gap](#xu-ly-su-co-thuong-gap)
- [Danh cho developer](#danh-cho-developer)
- [Tai lieu tham khao](#tai-lieu-tham-khao)

---

## GroceryClaw lam gi?

GroceryClaw tu dong hoa quy trinh xu ly don hang tu Zalo:

1. **Nhan tin nhan** — Khach gui don hang qua Zalo OA, he thong nhan webhook tu Zalo.
2. **Xac thuc** — Kiem tra chu ky so (signature) de dam bao tin nhan that, khong bi gia mao.
3. **Phan tich hoa don** — Doc noi dung don hang, trich xuat san pham, so luong, gia.
4. **Dong bo KiotViet** — Tu dong tao don hang trong he thong KiotViet.
5. **Thong bao** — Gui xac nhan lai cho khach qua Zalo.

He thong ho tro nhieu cua hang (multi-tenant), moi cua hang co du lieu rieng biet, bao mat boi Row-Level Security (RLS) trong database.

---

## Kien truc tong quan

GroceryClaw gom 5 thanh phan chinh:

| Thanh phan | Vai tro | Truy cap |
|---|---|---|
| **Gateway** | Cua ngo duy nhat, nhan webhook tu Zalo, xac thuc va dua vao hang doi | **Public** (mo ra internet) |
| **Worker** | Xu ly ngam: phan tich don, dong bo KiotViet, gui thong bao | Private (noi bo) |
| **Admin** | Quan ly cua hang, moi thanh vien, xoay secret | Private (noi bo) |
| **PostgreSQL** | Co so du lieu chinh (schema V2 + RLS) | Private (noi bo) |
| **Redis** | Hang doi xu ly (BullMQ queue) | Private (noi bo) |

**Quan trong:** Chi co Gateway duoc mo ra internet. Admin, PostgreSQL va Redis phai nam trong mang noi bo, khong bao gio expose ra ngoai.

---

## Chon che do nao? Legacy hay V2?

### Legacy (n8n) — Cho nguoi dang dung

Dung khi ban da co he thong cu chay tren n8n va chua muon chuyen doi. Tai lieu: `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`.

### V2 SaaS (Khuyen dung) — Cho trien khai moi

Dung khi ban muon: quan ly nhieu cua hang, bao mat RLS, canary rollout (chuyen tung cua hang sang V2), va co day du cong cu van hanh (backup, restore, DLQ replay). Day la README nay huong dan.

---

## PHAN 1: Chay thu tren may tinh ca nhan (Local)

> Thoi gian uoc tinh: 10-15 phut

### Ban can chuan bi gi?

Truoc khi bat dau, hay dam bao may tinh cua ban da cai dat:

| Phan mem | Phien ban toi thieu | Cach kiem tra |
|---|---|---|
| Docker Desktop | Moi nhat | `docker --version` |
| Docker Compose | Di kem Docker Desktop | `docker compose version` |
| Node.js | 20 tro len | `node --version` |
| npm | Di kem Node.js | `npm --version` |
| Git | Bat ky | `git --version` |

**Cau hinh may khuyen nghi:** 4 CPU, 8 GB RAM, 10 GB o dia trong.

**Port can dung:** `8081` (Gateway se chay o day).

### Buoc 1: Tai ma nguon va cai dat

Mo Terminal (hoac Command Prompt / PowerShell) va chay:

```bash
git clone https://github.com/vansyson1308/groceryclaw.git
cd groceryclaw
npm install
```

**Ket qua mong doi:** Khong co loi mau do. Dong cuoi hien gi do nhu `added xxx packages`.

### Buoc 2: Tao file cau hinh

```bash
cp infra/compose/v2/.env.example infra/compose/v2/.env
```

Lenh nay tao ban sao file cau hinh mau. Bay gio ban can mo file `infra/compose/v2/.env` bang bat ky text editor nao (Notepad, VS Code, ...) va dien cac gia tri bat buoc:

```
# --- BAT BUOC: Thong tin database ---
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=matkhau_admin_db_cua_ban
APP_DB_USER=app_user
APP_DB_PASSWORD=matkhau_app_cua_ban

# --- BAT BUOC: Mat khau Redis ---
REDIS_PASSWORD=matkhau_redis_cua_ban

# --- BAT BUOC: Secret xac thuc webhook ---
WEBHOOK_SIGNATURE_SECRET=secret_test_local_cua_ban

# --- TUY CHON: Pepper cho invite flow (tao bang lenh ben duoi) ---
INVITE_PEPPER_B64=
ADMIN_MEK_B64=
WORKER_MEK_B64=
```

De tao gia tri cho `INVITE_PEPPER_B64`, `ADMIN_MEK_B64`, `WORKER_MEK_B64`, chay:

```bash
openssl rand -base64 32
```

Chay lenh 3 lan, moi lan copy ket qua vao mot bien tuong ung.

### Buoc 3: Khoi dong he thong

```bash
make v2-up
```

**Ket qua mong doi:** Docker tai images va build containers. Sau vai phut, ban se thay cac container `postgres`, `redis`, `gateway`, `admin`, `worker` dang chay. Kiem tra bang:

```bash
docker ps
```

Ban phai thay 5 container voi trang thai `Up` hoac `healthy`.

### Buoc 4: Chay migration database

```bash
npm run db:v2:migrate
```

**Ket qua mong doi:** In ra cac buoc migration thanh cong, khong co loi.

### Buoc 5: Kiem tra he thong (Smoke test)

```bash
make v2-smoke
```

**Ket qua mong doi:** Dong cuoi in ra:
```
Smoke check passed: gateway healthy, signed webhook accepted, queue length=<n>
```

Neu thay dong nay, he thong da chay dung.

### Buoc 6: Kiem tra thu cong (tuy chon)

Kiem tra Gateway co song khong:

```bash
curl -i http://127.0.0.1:8081/healthz
curl -i http://127.0.0.1:8081/readyz
```

**Ket qua mong doi:** Ca hai tra ve HTTP `200` va JSON `{"status":"ok"}`.

### Tat he thong

```bash
make v2-down
```

Neu muon xoa toan bo du lieu local (database + Redis) de bat dau lai tu dau:

```bash
make v2-reset
```

### Bang tom tat lenh (Local)

| Lenh | Tac dung |
|---|---|
| `make v2-up` | Khoi dong he thong |
| `make v2-down` | Tat he thong (giu du lieu) |
| `make v2-reset` | Tat + xoa toan bo du lieu |
| `make v2-smoke` | Chay kiem tra tu dong |
| `npm run v2:logs` | Xem log realtime |
| `npm run db:v2:migrate` | Chay migration database |

---

## PHAN 2: Deploy len VPS don (1 may chu)

> Phu hop cho team nho, 1-5 cua hang, VPS tu 2 vCPU / 4 GB RAM tro len.

### Buoc 1: Chuan bi VPS

- Thue VPS (DigitalOcean, Vultr, AWS Lightsail, Linode, ...) chay Ubuntu 22+.
- Cai Docker + Compose: theo huong dan chinh thuc cua Docker tai [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
- Cai Node.js 20+: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- Cai Git: `sudo apt install -y git`
- Co domain (vi du `api.cuahang.vn`) tro DNS ve IP cua VPS.

### Buoc 2: Tai ma nguon va cau hinh

```bash
git clone https://github.com/vansyson1308/groceryclaw.git
cd groceryclaw
npm install
cp infra/compose/v2/.env.example infra/compose/v2/.env
```

Chinh sua `infra/compose/v2/.env` voi cac gia tri production that (mat khau manh, secret that). **Dung dung gia tri test.**

### Buoc 3: Khoi dong va migrate

```bash
make v2-up
npm run db:v2:migrate
make v2-smoke
```

**Ket qua mong doi:** Smoke test passed.

### Buoc 4: Cau hinh HTTPS (Bat buoc cho production)

Gateway can duoc dat sau mot reverse proxy de co HTTPS. Cach don gian nhat la dung **Caddy**:

```bash
sudo apt install -y caddy
```

Tao file `/etc/caddy/Caddyfile`:

```
api.cuahang.vn {
    reverse_proxy 127.0.0.1:8081
}
```

Khoi dong lai Caddy:

```bash
sudo systemctl restart caddy
```

Caddy tu dong lay chung chi SSL tu Let's Encrypt. Sau buoc nay, Gateway cua ban co the truy cap qua `https://api.cuahang.vn`.

**Cac lua chon thay the Caddy:** Nginx + Certbot, hoac Traefik. Xem them tai `docs/DEPLOYMENT.md`.

### Buoc 5: Dam bao an toan

- Admin, PostgreSQL, Redis **KHONG DUOC** mo port ra ngoai. Chi Gateway (port 8081) duoc expose.
- Trong `docker-compose.yml` cua V2, Admin va Worker khong co `ports:` mapping ra host — day la mac dinh an toan, khong can chinh.
- Dat tuong lua (firewall) chi cho phep port 80, 443 (Caddy) va 22 (SSH) tu ben ngoai.

### Buoc 6: Cau hinh Zalo webhook

Vao trang quan tri Zalo OA, dat webhook URL thanh:

```
https://api.cuahang.vn/webhooks/zalo
```

Dam bao signature secret trong Zalo OA khop voi `WEBHOOK_SIGNATURE_SECRET` trong file `.env`.

### Buoc 7: Kiem tra truoc khi cho khach dung

Doc va lam theo checklist:
- `docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md`
- `docs/saas_v2/RELEASE_CHECKLIST.md`
- `docs/saas_v2/SECURITY_CHECKLIST.md`

---

## PHAN 3: Deploy len Kubernetes (Production)

> Cho team lon, nhieu cua hang, can auto-scaling va high availability.

### Ban can chuan bi gi?

| Phan mem/Dich vu | Mo ta |
|---|---|
| Kubernetes cluster | EKS (AWS), GKE (Google), AKS (Azure), hoac DigitalOcean Kubernetes |
| Domain | Vi du `example.com`, ban co quyen tao DNS record |
| `kubectl` | Cong cu dong lenh quan ly Kubernetes |
| `helm` | Cong cu cai dat packages cho Kubernetes |
| `dig` hoac `nslookup` | Kiem tra DNS |
| `curl` | Test API |

Kiem tra cac cong cu da cai chua:

```bash
kubectl version --client
helm version
curl --version
```

**Ket qua mong doi:** Moi lenh in ra phien ban va thoat khong loi.

### Buoc 1: Ket noi vao Kubernetes cluster

Neu ban da tao cluster tren cloud console, tai kubeconfig ve va ket noi:

```bash
kubectl config get-contexts
kubectl config use-context <ten-context-cua-ban>
kubectl get nodes
```

**Ket qua mong doi:** `kubectl get nodes` hien danh sach node voi trang thai `Ready`.

### Buoc 2: Cai dat cac thanh phan can thiet (Ingress, TLS, External Secrets)

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true

helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace
```

**Ket qua mong doi:** Moi lenh `helm` ket thuc voi `STATUS: deployed`.

Tiep theo, ap dung cac template tu repo:

```bash
kubectl apply -k infra/k8s/prereqs
kubectl get clusterissuer
```

**Ket qua mong doi:** Hien `letsencrypt-staging` va `letsencrypt-prod`.

### Buoc 3: Cau hinh DNS

Lay dia chi IP cong (public) cua ingress:

```bash
kubectl -n ingress-nginx get svc
```

Vao trang quan ly DNS cua domain ban, tao record:

- **Type:** A (hoac CNAME neu la hostname)
- **Name:** `api`
- **Value:** IP/hostname tu lenh tren

Kiem tra:

```bash
dig +short api.<domain-cua-ban>
```

**Ket qua mong doi:** Tra ve IP cua ingress.

### Buoc 4: Tao secrets cho ung dung

**Cach 1: Dung External Secrets (khuyen dung cho production)**

1. Cau hinh cloud secret manager (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault).
2. Chinh sua `infra/k8s/overlays/prod/external-secrets.example.yaml` voi ten key cua ban.
3. Ap dung:

```bash
kubectl create namespace groceryclaw-v2 --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n groceryclaw-v2 -f infra/k8s/overlays/prod/external-secrets.example.yaml
```

**Cach 2: Tao secret thu cong (cho team nho / dev)**

```bash
kubectl create namespace groceryclaw-v2 --dry-run=client -o yaml | kubectl apply -f -

kubectl -n groceryclaw-v2 create secret generic app-secrets \
  --from-literal=DB_APP_URL='postgresql://app_user:PASSWORD@postgres:5432/groceryclaw_v2' \
  --from-literal=DB_ADMIN_URL='postgresql://admin_user:PASSWORD@postgres:5432/groceryclaw_v2' \
  --from-literal=REDIS_URL='redis://:PASSWORD@redis:6379/0' \
  --from-literal=WEBHOOK_SIGNATURE_SECRET='thay-bang-secret-that' \
  --from-literal=INVITE_PEPPER_B64='thay-bang-base64-32byte' \
  --from-literal=ADMIN_MEK_B64='thay-bang-base64-32byte' \
  --from-literal=WORKER_MEK_B64='thay-bang-base64-32byte'
```

**Luu y:** Thay tat ca gia tri `PASSWORD` va `thay-bang-*` bang gia tri that. Khong bao gio commit secret vao Git.

### Buoc 5: Deploy GroceryClaw

```bash
npm run k8s:audit
kubectl apply -k infra/k8s/overlays/prod
kubectl get deploy,svc,ingress -n groceryclaw-v2
```

**Ket qua mong doi:** Thay 3 Deployments (`gateway`, `worker`, `admin`), Ingress chi cho `gateway`, cac service con lai la ClusterIP (noi bo).

### Buoc 6: Chay migration database

```bash
kubectl create job --from=job/db-v2-migrate db-v2-migrate-$(date +%s) -n groceryclaw-v2
kubectl get jobs -n groceryclaw-v2
```

Doi job hoan thanh, xem log:

```bash
kubectl logs -n groceryclaw-v2 job/<ten-job-migration>
```

**Ket qua mong doi:** Job trang thai `Complete`, log hien cac buoc migration thanh cong.

### Buoc 7: Kiem tra he thong

```bash
curl -i https://api.<domain-cua-ban>/healthz
curl -i https://api.<domain-cua-ban>/readyz
```

**Ket qua mong doi:** HTTP `200` voi `{"status":"ok"}`.

Chay smoke test trong cluster:

```bash
kubectl apply -f infra/k8s/overlays/prod/smoke-job.yaml
kubectl wait --for=condition=complete -n groceryclaw-v2 job/v2-smoke --timeout=180s
kubectl logs -n groceryclaw-v2 job/v2-smoke
```

**Ket qua mong doi:** Log chua `smoke passed`.

### Buoc 8: Kiem tra TLS (HTTPS)

```bash
kubectl get certificate -n groceryclaw-v2
kubectl describe certificate gateway-tls -n groceryclaw-v2
```

**Ket qua mong doi:** Certificate hien `Ready=True`.

### Buoc 9: Cau hinh Zalo webhook

Dat URL webhook trong Zalo OA console:

```
https://api.<domain-cua-ban>/webhooks/zalo
```

### Buoc 10: Canary rollout (chuyen tung cua hang sang V2)

Chuyen 1 cua hang sang V2 de test:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode v2 --apply
npm run canary:status -- --tenants <tenant-uuid>
```

Neu co van de, rollback ngay:

```bash
npm run canary:set-mode -- --tenants <tenant-uuid> --mode legacy --apply
```

Rollback toan bo infrastructure neu can:

```bash
kubectl rollout undo deployment/gateway -n groceryclaw-v2
kubectl rollout undo deployment/worker -n groceryclaw-v2
kubectl rollout undo deployment/admin -n groceryclaw-v2
```

---

## Van hanh hang ngay

### Xem log

```bash
# Local (Docker Compose)
npm run v2:logs

# Kubernetes
kubectl logs -f deployment/gateway -n groceryclaw-v2
kubectl logs -f deployment/worker -n groceryclaw-v2
```

### Xu ly don that bai (DLQ — Dead Letter Queue)

Khi mot don hang xu ly loi, no duoc chuyen vao DLQ. De xem va xu ly lai:

```bash
# Xem danh sach don loi
npm run dlq:list -- --tenant-id <tenant-id> --status dead_letter --limit 100

# Xem truoc se replay nhung gi (dry-run)
npm run dlq:replay -- --tenant-id <tenant-id> --job-ids <job1,job2>

# Thuc su replay (them --apply)
npm run dlq:replay -- --tenant-id <tenant-id> --job-ids <job1,job2> --apply
```

### Backup va restore database

```bash
# Backup
DB_V2_BACKUP_URL="$DATABASE_URL" npm run db:v2:backup -- backups/v2/latest.dump

# Restore
DB_V2_BACKUP_URL="$DATABASE_URL" npm run db:v2:restore -- --yes backups/v2/latest.dump
```

Chi tiet: `docs/saas_v2/RUNBOOK.md`

---

## Cap nhat phien ban moi

```bash
git pull
npm install
make v2-up
npm run db:v2:migrate
make v2-smoke
```

Neu phien ban moi co loi, rollback nhu sau:
1. Chuyen cac cua hang ve `legacy` bang canary scripts.
2. Lam theo `docs/saas_v2/ROLLBACK_DRILL.md`.

---

## Xu ly su co thuong gap

| Van de | Nguyen nhan co the | Cach xu ly |
|---|---|---|
| `make v2-up` bao loi port | Port 8081 da bi chiem | Doi `GATEWAY_HOST_PORT` trong `.env` sang port khac (vi du `8082`) |
| Container gateway khong `healthy` | DB hoac Redis chua san sang | Doi 30 giay roi chay `docker ps` lai. Neu van loi, xem `npm run v2:logs` |
| Migration loi | Database chua chay hoac sai mat khau | Kiem tra container postgres dang `healthy`, kiem tra lai DB credentials trong `.env` |
| Webhook bi tu choi (403/401) | Sai signature secret | Dam bao `WEBHOOK_SIGNATURE_SECRET` trong `.env` khop voi cau hinh tren Zalo OA |
| Smoke test fail o queue length | Worker chua chay hoac Redis bi ngat | Kiem tra container worker va redis dang `healthy` |

Tai lieu xu ly su co chi tiet:
- `docs/saas_v2/TROUBLESHOOTING.md`
- `docs/saas_v2/TROUBLESHOOTING_K8S.md`

---

## Danh cho developer

### Cau truc du an

```
groceryclaw/
  apps/
    gateway/       # Cua ngo nhan webhook (public)
    admin/         # API quan tri (private)
    worker/        # Xu ly ngam (private)
  packages/
    common/        # Code dung chung
  db/
    v2/            # Migration files cho V2
  infra/
    compose/v2/    # Docker Compose config cho V2
    k8s/           # Kubernetes manifests
  scripts/         # CLI scripts (canary, DLQ, backup, ...)
  tests/           # Unit + integration tests
  tools/           # Lint, format, audit tools
  docs/            # Tai lieu
    saas_v2/       # Tai lieu V2 chi tiet
  n8n/             # Legacy n8n workflows
  data/            # Du lieu mau, master data
```

### Kiem tra chat luong code

```bash
npm run lint           # Kiem tra code style
npm run format:check   # Kiem tra format
npm run typecheck      # Kiem tra TypeScript types
npm run test           # Chay unit tests
```

### Test database that (voi Postgres that)

```bash
# Tu dong: khoi dong Postgres, migrate, test, don dep
npm run test:v2:db:real:compose

# Thu cong (neu da co DATABASE_URL)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/groceryclaw_v2_ci npm run test:v2:db:real
```

### Test end-to-end day du

```bash
npm run e2e
```

Test nay khoi dong toan bo stack (Postgres + Redis + Gateway + Admin + Worker + stubs), chay migration va kiem tra toan bo luong: invite -> onboarding -> webhook -> parse -> sync -> notify -> idempotency.

### Test hieu nang

```bash
npm run load:light    # Load test nhe
npm run perf:gate     # Kiem tra nguong hieu nang
```

### Cau hinh Redis

Dung `REDIS_URL` cho tat ca services. Vi du:

```
REDIS_URL=redis://:matkhau@redis:6379/0
```

Neu thieu `REDIS_URL`, runtime se dung fallback `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` va in canh bao deprecation.

### Readiness endpoints

- `/healthz` — Kiem tra process con song.
- `/readyz` — Kiem tra ket noi DB + Redis (khi `READYZ_STRICT=true`, mac dinh).
- Dat `READYZ_STRICT=false` tam thoi trong truong hop khan cap de dung shallow readiness.

### Security audit

```bash
npm audit --omit=dev --audit-level=high
```

CI cung chay cac security/perf gates tai `.github/workflows/`.

> **Luu y CI:** Khong xoa `package-lock.json` — CI can no de dam bao cai dat nhat quan.

---

## Tai lieu tham khao

### Tai lieu V2 (chinh)

| Tai lieu | Mo ta |
|---|---|
| `docs/saas_v2/RUNBOOK.md` | Huong dan van hanh hang ngay |
| `docs/saas_v2/RELEASE_CHECKLIST.md` | Checklist truoc khi release |
| `docs/saas_v2/SECURITY_CHECKLIST.md` | Checklist bao mat |
| `docs/saas_v2/SLO_GATES.md` | Cac nguong chat luong dich vu |
| `docs/saas_v2/TROUBLESHOOTING.md` | Xu ly su co |
| `docs/saas_v2/TROUBLESHOOTING_K8S.md` | Xu ly su co Kubernetes |
| `docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md` | Kiem tra truoc khi cho khach dung |
| `docs/saas_v2/DEPLOY_K8S_OVERVIEW.md` | Tong quan deploy Kubernetes |
| `docs/saas_v2/DEPLOY_K8S_PREREQS.md` | Dieu kien tien quyet deploy K8s |
| `docs/saas_v2/DEPLOY_K8S_SMOKE.md` | Smoke test tren K8s |
| `docs/saas_v2/DEPLOY_K8S_MONITORING.md` | Monitoring va alerts |
| `docs/saas_v2/ROLLBACK_DRILL.md` | Quy trinh rollback |
| `docs/saas_v2/CHAOS_DRILLS.md` | Test kha nang chiu loi |
| `docs/saas_v2/RETRY_POLICY.md` | Chinh sach retry |

### Tai lieu Legacy

| Tai lieu | Mo ta |
|---|---|
| `docs/ARCHITECTURE.md` | Kien truc legacy |
| `docs/RUNBOOK.md` | Van hanh legacy |
| `docs/SMOKE_TESTS.md` | Smoke test legacy |

### Tai lieu tong quan

| Tai lieu | Mo ta |
|---|---|
| `ARCHITECTURE_V2.md` | Kien truc V2 chi tiet |
| `KIOTVIET-TAPHOA_TECHNICAL_PRD_V4.md` | PRD ky thuat day du |
| `MASTER_DESIGN_PACK.md` | Thiet ke tong the |
| `CODE_OF_CONDUCT.md` | Quy tac ung xu |
| `CONTRIBUTING.md` | Huong dan dong gop |

---

## An toan va bao mat — Nhung dieu KHONG DUOC lam

1. **KHONG** expose Admin, PostgreSQL, hoac Redis ra internet.
2. **KHONG** commit file `.env` co chua mat khau/secret that vao Git.
3. **KHONG** dung mat khau yeu (nhu `password`, `123456`) cho production.
4. **KHONG** tat `WEBHOOK_VERIFY_MODE=mode1` tren production.
5. **KHONG** chay production khong co HTTPS.

Cach tao mat khau/secret manh:

```bash
# Tao mat khau ngau nhien 32 ky tu
openssl rand -base64 32
```

De xoay (rotate) hoac thu hoi (revoke) secret, su dung Admin API hoac:

```bash
npm run secrets:revoke -- --secret-id <id>
```

Chi tiet: `docs/saas_v2/SECURITY_CHECKLIST.md`
