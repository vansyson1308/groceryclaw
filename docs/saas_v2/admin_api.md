# Admin API (Phase 5B)

## Security
- Admin service is private-boundary only.
- OIDC JWT auth required by default.
- Break-glass API key is disabled by default.

## Endpoints

### `POST /tenants` (ops/admin)
Create a tenant.

Request body:
```json
{ "name": "Tenant A", "code": "tenant_a", "metadata": {"canary": true} }
```

### `GET /tenants/:id` (read_only/ops/admin)
Fetch tenant status and canary mode.

### `PATCH /tenants/:id` (ops/admin)
Update tenant canary/status/config.

Request body (any subset):
```json
{ "processing_mode": "legacy|v2", "enabled": true, "metadata": {} }
```

### `POST /tenants/:id/invites` (ops/admin)
Create an invite code and return plaintext code exactly once.

### `GET /tenants/:id/invites` (read_only/ops/admin)
List invite metadata only (no plaintext code).

### `POST /tenants/:id/secrets` (ops/admin)
Rotate/create a secret version using envelope encryption. Payload is accepted once and encrypted before persistence.

### `POST /tenants/:id/secrets/:secret_id/revoke` (ops/admin)
Revoke a specific secret version.

### `GET /tenants/:id/secrets` (read_only/ops/admin)
List secret version metadata only (no plaintext payload).
