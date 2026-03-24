# Deploy GroceryClaw lên TOSE.sh — Hướng dẫn từng bước

## Yêu cầu
- Node.js >= 18 (trên máy local)
- Tài khoản TOSE.sh (miễn phí $10 credit)
- Git repo đã push lên GitHub

---

## Bước 1: Cài TOSE CLI + đăng nhập

```bash
npm install -g @tosesh/tose
tose login
```

Làm theo hướng dẫn trên terminal để đăng nhập.

---

## Bước 2: Tạo Database (PostgreSQL + Redis)

```bash
# Tạo PostgreSQL
tose db create
# Chọn: postgresql
# Đặt tên: groceryclaw-pg

# Tạo Redis
tose db create
# Chọn: redis
# Đặt tên: groceryclaw-redis
```

Sau đó lấy connection URL:

```bash
tose db info groceryclaw-pg
# Ghi lại: postgresql://user:pass@host:5432/dbname

tose db info groceryclaw-redis
# Ghi lại: redis://:pass@host:6379
```

**LƯU GIỮ 2 URL này** — sẽ dùng ở bước tiếp theo.

---

## Bước 3: Init project + set environment variables

```bash
cd groceryclaw
tose init
# Đặt tên project: groceryclaw-gateway
```

Set tất cả env vars (thay `<DB_URL>` và `<REDIS_URL>` bằng URL từ bước 2):

```bash
tose env set NODE_ENV=production
tose env set LOG_LEVEL=info
tose env set GENERIC_TIMEZONE=Asia/Ho_Chi_Minh

# --- Server ---
tose env set GATEWAY_HOST=0.0.0.0
tose env set GATEWAY_PORT=8080

# --- Database ---
tose env set DB_APP_URL="<DB_URL từ bước 2>"
tose env set DB_ADMIN_URL="<DB_URL từ bước 2>"
tose env set DB_STATEMENT_TIMEOUT_MS=5000

# --- Redis ---
tose env set REDIS_URL="<REDIS_URL từ bước 2>"
tose env set BULLMQ_QUEUE_NAME=process-inbound

# --- Webhook ---
tose env set V2_GATEWAY_WEBHOOK_ENABLED=true
tose env set WEBHOOK_VERIFY_MODE=mode1
tose env set WEBHOOK_SIGNATURE_HEADERS=x-zalo-signature
tose env set WEBHOOK_ENFORCE_TIMESTAMP=false
tose env set WEBHOOK_TIMESTAMP_MAX_DRIFT_SECONDS=300
tose env set WEBHOOK_REPLAY_TTL_SECONDS=86400

# --- Zalo ---
tose env set ZALO_APP_ID=3187879314271762859
tose env set ZALO_OA_SECRET=XYhj4f5kGBlXxlGOJENB

# --- KiotViet ---
tose env set KIOTVIET_CLIENT_ID=5908aa9e-56f0-40bc-b283-faff7e938f1c

# --- Security secrets (generate mới) ---
# Chạy trên terminal để generate:
#   openssl rand -hex 32
# Rồi set:
tose env set WEBHOOK_SIGNATURE_SECRET="<paste hex ở đây>"
tose env set INVITE_PEPPER_B64="$(openssl rand -base64 32)"
tose env set ADMIN_MEK_B64="$(openssl rand -base64 32)"
tose env set WORKER_MEK_B64="$(openssl rand -base64 32)"

# --- Feature flags ---
tose env set WORKER_XML_PARSE_ENABLED=true
tose env set WORKER_MAPPING_ENABLED=true
tose env set WORKER_KIOTVIET_SYNC_ENABLED=true
tose env set WORKER_NOTIFIER_ENABLED=true
tose env set ADMIN_ENABLED=true
tose env set ADMIN_BREAKGLASS_ENABLED=true
tose env set ADMIN_SECRETS_ENABLED=true
tose env set V2_ONBOARDING_ENABLED=true
tose env set READYZ_STRICT=true
```

---

## Bước 4: Deploy

```bash
tose deploy
```

Đợi deploy xong (~2-3 phút). TOSE sẽ trả về URL dạng:

```
https://groceryclaw-gateway.tose.sh
```

---

## Bước 5: Chạy database migrations

Nếu TOSE hỗ trợ chạy lệnh trực tiếp:

```bash
tose exec -- npm run db:v2:migrate
```

Nếu không, bạn cần chạy migration từ local (đảm bảo local có thể kết nối tới DB trên TOSE):

```bash
DB_APP_URL="<DB_URL từ bước 2>" npm run db:v2:migrate
```

---

## Bước 6: Kiểm tra

```bash
# Health check
curl https://groceryclaw-gateway.tose.sh/healthz

# Readiness
curl https://groceryclaw-gateway.tose.sh/readyz
```

Nếu trả về `200 OK` → deploy thành công!

---

## Bước 7: Callback URL cho Zalo

Quay lại [developers.zalo.me](https://developers.zalo.me), vào app settings, điền:

```
Callback URL: https://groceryclaw-gateway.tose.sh/webhooks/zalo
```

---

## Xem logs

```bash
tose logs -f
```

---

## Thông tin còn thiếu (hỏi thêm bạn cửa hàng)

| Biến | Trạng thái |
|------|-----------|
| ZALO_APP_ID | ✅ Đã có |
| ZALO_OA_SECRET | ✅ Đã có |
| ZALO_OA_ACCESS_TOKEN | ❌ Cần lấy sau khi set callback URL |
| KIOTVIET_CLIENT_ID | ✅ Đã có |
| KIOTVIET_CLIENT_SECRET | ❌ Chưa có — hỏi bạn |
| KIOTVIET_RETAILER | ❌ Chưa có — hỏi bạn (tên cửa hàng) |
| OPENAI_API_KEY | Tuỳ chọn |
| TELEGRAM_BOT_TOKEN | Tuỳ chọn |
