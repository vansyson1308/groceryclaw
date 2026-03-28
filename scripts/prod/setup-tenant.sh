#!/usr/bin/env bash
set -euo pipefail

# ==============================================================
# GroceryClaw Tenant Setup Script
# Creates tenant, links KiotViet, stores credentials, generates invite.
#
# Usage:
#   GC_KIOTVIET_CLIENT_ID=xxx GC_KIOTVIET_CLIENT_SECRET=yyy bash scripts/prod/setup-tenant.sh
# ==============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/infra/compose/v2"
ENV_FILE="$COMPOSE_DIR/.env.prod"

DC="docker compose -f $COMPOSE_DIR/docker-compose.yml -f $COMPOSE_DIR/docker-compose.prod.yml --env-file $ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi

# Load env vars
OPS_KEY=$(grep '^OPS_KEY=' "$ENV_FILE" | cut -d= -f2-)
ADMIN_API_KEY=$(grep '^ADMIN_BREAKGLASS_API_KEY=' "$ENV_FILE" | cut -d= -f2-)
GATEWAY_PORT=$(grep '^GATEWAY_HOST_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "8081")
GATEWAY_PORT="${GATEWAY_PORT:-8081}"
GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"

# --- Configurable tenant details ---
RETAILER="${GC_RETAILER:-taphoatuyetbachd}"
KIOTVIET_CLIENT_ID="${GC_KIOTVIET_CLIENT_ID:?Set GC_KIOTVIET_CLIENT_ID}"
KIOTVIET_CLIENT_SECRET="${GC_KIOTVIET_CLIENT_SECRET:?Set GC_KIOTVIET_CLIENT_SECRET}"

echo "==> GroceryClaw Tenant Setup"
echo "    Gateway: $GATEWAY_URL"
echo "    Retailer: $RETAILER"

# --- Step 1: Create tenant + invite code ---
echo ""
echo "==> Step 1: Creating tenant and invite code..."
INVITE_RESPONSE=$(curl -sf "${GATEWAY_URL}/ops/create-invite?key=${OPS_KEY}" 2>&1) || {
  echo "ERROR: Failed to create invite. Is gateway running?"
  exit 1
}
echo "    Response: $INVITE_RESPONSE"

TENANT_ID=$(echo "$INVITE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant_id'])" 2>/dev/null || echo "")
INVITE_CODE=$(echo "$INVITE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])" 2>/dev/null || echo "")

if [ -z "$TENANT_ID" ] || [ -z "$INVITE_CODE" ]; then
  echo "ERROR: Could not parse tenant_id or code from response."
  exit 1
fi

echo "    Tenant ID: $TENANT_ID"
echo "    Invite Code: $INVITE_CODE"

# --- Step 2: Link KiotViet retailer ---
echo ""
echo "==> Step 2: Linking KiotViet retailer: $RETAILER"
LINK_RESPONSE=$(curl -sf "${GATEWAY_URL}/ops/link-kiotviet?key=${OPS_KEY}&retailer=${RETAILER}" 2>&1) || {
  echo "ERROR: Failed to link KiotViet."
  exit 1
}
echo "    Response: $LINK_RESPONSE"

# --- Step 3: Store KiotViet credentials via Admin API ---
echo ""
echo "==> Step 3: Storing KiotViet credentials..."

STORE_RESPONSE=$($DC exec -T gateway node -e "
  const payload = JSON.stringify({
    client_id: '${KIOTVIET_CLIENT_ID}',
    client_secret: '${KIOTVIET_CLIENT_SECRET}',
    retailer: '${RETAILER}'
  });
  fetch('http://admin:3001/tenants/${TENANT_ID}/secrets/kiotviet', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ${ADMIN_API_KEY}'
    },
    body: payload
  })
  .then(r => r.text())
  .then(t => process.stdout.write(t))
  .catch(e => { process.stderr.write(e.message); process.exit(1); })
" 2>&1) || {
  echo "WARNING: Could not store KiotViet credentials via admin API."
  echo "         You may need to store credentials manually."
}
echo "    Response: $STORE_RESPONSE"

# --- Summary ---
echo ""
echo "============================================================"
echo "  TENANT SETUP COMPLETE"
echo "============================================================"
echo ""
echo "  Tenant ID:    $TENANT_ID"
echo "  Retailer:     $RETAILER"
echo "  Invite Code:  $INVITE_CODE"
echo ""
echo "  Next steps:"
echo "  1. Send this invite code to the store owner on Telegram"
echo "  2. They send the code to the bot to link their account"
echo "  3. Then they can send Excel invoices for processing"
echo "============================================================"
