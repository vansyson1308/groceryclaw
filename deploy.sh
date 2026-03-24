#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# GroceryClaw V2 — Deploy script for tose.sh (or any fresh VPS)
# ============================================================
# Yêu cầu: docker, docker compose, node >= 20, npm, make, openssl, curl
# Chạy từ BÊN TRONG thư mục repo (groceryclaw/).
# ============================================================

# --- 0. Kiểm tra prerequisites -------------------------------------------
for cmd in docker node npm make openssl curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $cmd" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' plugin not found. Install Docker Compose V2." >&2
  exit 1
fi

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "ERROR: Node >= 20 required, found v$(node -v)" >&2
  exit 1
fi

# --- 1. Generate secrets (chỉ tạo lần đầu) --------------------------------
SECRETS_FILE="secrets.txt"
if [[ -f "$SECRETS_FILE" ]]; then
  echo "INFO: $SECRETS_FILE already exists — reusing. Delete it to regenerate."
else
  echo "Generating secrets..."
  # Dùng tr để loại bỏ ký tự đặc biệt, giữ alphanumeric an toàn cho sed/shell
  gen_secret() { openssl rand -base64 48 | tr -d '/+=' | head -c 32; }

  cat <<EOF > "$SECRETS_FILE"
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=$(gen_secret)
APP_DB_USER=app_user
APP_DB_PASSWORD=$(gen_secret)
REDIS_PASSWORD=$(gen_secret)
WEBHOOK_SIGNATURE_SECRET=$(gen_secret)
INVITE_PEPPER_B64=$(openssl rand -base64 32)
ADMIN_MEK_B64=$(openssl rand -base64 32)
WORKER_MEK_B64=$(openssl rand -base64 32)
EOF
  echo "Secrets saved to $SECRETS_FILE — keep this file safe!"
fi

# --- 2. Build .env from example + secrets ----------------------------------
ENV_FILE="infra/compose/v2/.env"
ENV_EXAMPLE="infra/compose/v2/.env.example"

cp "$ENV_EXAMPLE" "$ENV_FILE"

# Load secrets into shell variables
set -a
source "$SECRETS_FILE"
set +a

# Inject secrets vào .env — dùng delimiter '|' để tránh lỗi với base64 (+/=)
# Chỉ match dòng bắt đầu bằng KEY= (anchor ^) để không replace nhầm
sed -i "s|^POSTGRES_SUPERUSER=.*|POSTGRES_SUPERUSER=${POSTGRES_SUPERUSER}|" "$ENV_FILE"
sed -i "s|^POSTGRES_SUPERUSER_PASSWORD=.*|POSTGRES_SUPERUSER_PASSWORD=${POSTGRES_SUPERUSER_PASSWORD}|" "$ENV_FILE"
sed -i "s|^APP_DB_USER=.*|APP_DB_USER=${APP_DB_USER}|" "$ENV_FILE"
sed -i "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=${APP_DB_PASSWORD}|" "$ENV_FILE"
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" "$ENV_FILE"
sed -i "s|^WEBHOOK_SIGNATURE_SECRET=.*|WEBHOOK_SIGNATURE_SECRET=${WEBHOOK_SIGNATURE_SECRET}|" "$ENV_FILE"
sed -i "s|^INVITE_PEPPER_B64=.*|INVITE_PEPPER_B64=${INVITE_PEPPER_B64}|" "$ENV_FILE"
sed -i "s|^ADMIN_MEK_B64=.*|ADMIN_MEK_B64=${ADMIN_MEK_B64}|" "$ENV_FILE"
sed -i "s|^WORKER_MEK_B64=.*|WORKER_MEK_B64=${WORKER_MEK_B64}|" "$ENV_FILE"

# Cập nhật DB_APP_URL và DB_ADMIN_URL với credentials thực tế
sed -i "s|^DB_APP_URL=.*|DB_APP_URL=postgresql://${APP_DB_USER}:${APP_DB_PASSWORD}@postgres:5432/${POSTGRES_DB:-groceryclaw_v2}|" "$ENV_FILE"
sed -i "s|^DB_ADMIN_URL=.*|DB_ADMIN_URL=postgresql://admin_reader:${APP_DB_PASSWORD}@postgres:5432/${POSTGRES_DB:-groceryclaw_v2}|" "$ENV_FILE"

# Cập nhật REDIS_URL với password thực tế (Docker Compose không resolve nested vars)
sed -i "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0|" "$ENV_FILE"

echo ".env created at $ENV_FILE"

# --- 3. Install dependencies -----------------------------------------------
echo "Installing npm dependencies..."
npm install

# --- 4. Build & start containers -------------------------------------------
echo "Starting Docker Compose stack..."
make v2-up

# --- 5. Wait for services to be healthy (thay vì sleep cứng) ---------------
echo "Waiting for services to become healthy..."
COMPOSE_CMD="docker compose --env-file $ENV_FILE -f infra/compose/v2/docker-compose.yml"
MAX_WAIT=120
ELAPSED=0

while (( ELAPSED < MAX_WAIT )); do
  # Kiểm tra tất cả services đã healthy chưa
  # Dùng cả 2 pattern để tương thích nhiều Docker Compose version
  UNHEALTHY=$($COMPOSE_CMD ps 2>/dev/null \
    | grep -ciE 'starting|unhealthy' || true)

  if (( UNHEALTHY == 0 )); then
    echo "All services healthy after ${ELAPSED}s."
    break
  fi

  echo "  ... waiting (${ELAPSED}s / ${MAX_WAIT}s, ${UNHEALTHY} service(s) not ready)"
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if (( ELAPSED >= MAX_WAIT )); then
  echo "WARNING: Timed out waiting for healthy services after ${MAX_WAIT}s."
  echo "Current status:"
  $COMPOSE_CMD ps
  echo "Check logs with: $COMPOSE_CMD logs"
  exit 1
fi

# --- 6. Run database migrations --------------------------------------------
echo "Running V2 database migrations..."
npm run db:v2:migrate

# --- 7. Smoke test ----------------------------------------------------------
echo "Running smoke tests..."
make v2-smoke

# --- 8. Done ----------------------------------------------------------------
echo ""
echo "=========================================="
echo " DEPLOY COMPLETE"
echo "=========================================="
echo " Gateway exposed at: http://<your-server-ip>:${GATEWAY_HOST_PORT:-8081}"
echo " Health check:       curl http://localhost:${GATEWAY_HOST_PORT:-8081}/healthz"
echo " Readiness check:    curl http://localhost:${GATEWAY_HOST_PORT:-8081}/readyz"
echo ""
echo " Useful commands:"
echo "   make v2-down          # Stop all services"
echo "   make v2-up            # Restart services"
echo "   npm run v2:logs       # Tail logs"
echo "   npm run db:v2:status  # Check migration status"
echo "=========================================="
