# Requirements Document

## Introduction

Judges of the Build, Ship, Shape hackathon must be able to try ShopVoice from a browser, with no account and nothing installed. This feature packages the existing MCP server and Alexa+ simulator as a hosted demo on Render:

- the simulator at a public URL;
- the MCP endpoint at `/mcp`, public with bearer auth;
- Postgres with row-level security;
- a demo shop whose dates always end "today".

Judges who want to test the MCP server directly (MCP Inspector) get a **read-only** bearer token, so the shared demo shop cannot be changed through it.

Decision on the demo shop:
- **One shared seeded shop, reset every night.** It is not a shop per visitor.
- Reason: confirming a reorder does not change stock levels, so one visitor cannot break the 5-phrase demo for the next. The nightly reset clears the drafts that visitors create.

Out of scope:
- AWS of any kind;
- payments;
- the OAuth/Claude-connector flow;
- the invoice pipeline (`gateway`, `worker`, `admin`).

## Requirements

### Requirement 1: Read-only MCP bearer tokens

**User Story:** As a judge testing with MCP Inspector, I want a demo bearer token that can read the shop but not place orders, so that I can explore every read tool safely and the shared demo stays intact.

#### Acceptance Criteria

1. WHEN a static bearer token is registered with the read-only option THE SYSTEM SHALL store its scopes as `shop.read` only, next to its SHA-256 hash.
2. WHEN a static bearer token is registered without the read-only option THE SYSTEM SHALL store its scopes as `shop.read shop.write`, so existing tokens keep working unchanged.
3. WHEN a request authenticated with a read-only token calls `create_reorder_draft` or `confirm_reorder` THE SYSTEM SHALL refuse it with the existing insufficient-scope response and SHALL NOT change any data.
4. WHEN a request authenticated with a read-only token calls any read tool, resource or prompt THE SYSTEM SHALL answer exactly as for a read-write token.
5. WHEN migration 019 is rolled back THE SYSTEM SHALL return the schema and `resolve_mcp_access_token` to their migration-018 state.
6. THE SYSTEM SHALL support read-only tokens in both data backends (`postgres` and `memory`).

### Requirement 2: Database preparation on deploy

**User Story:** As the operator, I want one idempotent pre-deploy command, so that every Render deploy migrates the database, keeps the runtime role safe and registers the demo tokens without manual SQL.

#### Acceptance Criteria

1. WHEN `node scripts/deploy/db_prepare.mjs` runs THE SYSTEM SHALL apply all pending migrations using the Postgres superuser credentials from the environment.
2. WHEN `db_prepare` runs THE SYSTEM SHALL create or update the login role named by `MCP_DB_USER`:
   - with the password `MCP_DB_PASSWORD`;
   - as a member of `groceryclaw_app_user`;
   - with `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`.
3. WHEN the demo tenant has no shop profile THE SYSTEM SHALL apply the demo seed anchored to today in `DEMO_SHOP_TIMEZONE` (default `Asia/Ho_Chi_Minh`).
4. WHEN `SIM_MCP_TOKEN` is set THE SYSTEM SHALL register it for the demo tenant as read-write. WHEN `MCP_JUDGE_TOKEN` is set THE SYSTEM SHALL register it as read-only. Both registrations are idempotent.
5. WHEN `db_prepare` runs twice in a row THE SYSTEM SHALL succeed both times and leave the same state.
6. THE SYSTEM SHALL NOT print or log any password or token value.
7. WHEN the MCP server starts with the `postgres` backend and its database user is a superuser or has `BYPASSRLS` THE SYSTEM SHALL refuse to start with a clear error.
8. WHEN `MCP_DB_URL` is unset and `MCP_DB_HOST`, `MCP_DB_NAME`, `MCP_DB_USER` and `MCP_DB_PASSWORD` are set THE SYSTEM SHALL build the connection string from them, URL-encoding the user and password, with `MCP_DB_PORT` defaulting to 5432.

### Requirement 3: Demo data that is always current

**User Story:** As a judge opening the demo on any day of the judging period, I want "today" and "last Friday" to have data, so that the five demo phrases always work.

#### Acceptance Criteria

1. WHEN `node scripts/deploy/reseed_demo.mjs` runs THE SYSTEM SHALL replace the demo tenant's data with the demo seed anchored to today in `DEMO_SHOP_TIMEZONE`.
2. WHEN the reseed finishes THE SYSTEM SHALL have re-registered `SIM_MCP_TOKEN` (read-write) and `MCP_JUDGE_TOKEN` (read-only), so both tokens still work.
3. WHEN the reseed runs THE SYSTEM SHALL leave every other tenant's rows unchanged.
4. THE SYSTEM SHALL run the reseed once a day at 00:05 shop time (17:05 UTC for `Asia/Ho_Chi_Minh`) as a Render cron job.

### Requirement 4: Health covering the simulator and the MCP server

**User Story:** As the operator and as a judge, I want one health URL on the simulator that also reports the MCP server, so that I can see at a glance whether the whole demo path works.

#### Acceptance Criteria

1. WHEN `GET /healthz` is called on the simulator THE SYSTEM SHALL return HTTP 200 with JSON: `status`, `service`, `brain` (`kind`, `model`) and `mcp` (`status` `ok` or `fail`, `protocolVersion`, `tools`).
2. WHEN the MCP server is unreachable THE SYSTEM SHALL still return HTTP 200 from `/healthz` with `mcp.status = "fail"`, and SHALL return HTTP 503 from `/readyz`.
3. THE SYSTEM SHALL bound the MCP check to 2 seconds and cache its result for 15 seconds, so health checks cannot overload the MCP server.
4. THE SYSTEM SHALL NOT include any token, URL credential or secret in the `/healthz` body.

### Requirement 5: Judge landing panel and access without accounts

**User Story:** As a judge who has never seen the project, I want the page to tell me exactly what to say and let me click instead of speaking, so that I can see the whole flow in under a minute.

#### Acceptance Criteria

1. WHEN the simulator page loads THE SYSTEM SHALL show a "Try these 5 phrases" panel listing, in order, the five phrases in `DEMO_UTTERANCES` of `scripts/demo/e2e_voice_flow.mjs`.
2. WHEN a judge clicks a phrase THE SYSTEM SHALL send it through the same path as typed input (`POST /api/turn`) and show the reply, the tool calls and any confirmation card.
3. THE SYSTEM SHALL let the panel be used with keyboard only: buttons, visible focus, Enter/Space.
4. WHILE `SIM_ACCESS_CODE` is empty THE SYSTEM SHALL serve the simulator with no login or access code, keeping the per-IP and global rate limits.
5. THE SYSTEM SHALL show one plain sentence explaining the simulation: the page is a simulated Alexa+ experience whose server is an MCP client calling the ShopVoice MCP server over Streamable HTTP. It shows the MCP protocol version from `/api/config`.
6. THE SYSTEM SHALL keep the strict Content-Security-Policy: no inline scripts or styles.

### Requirement 6: Render Blueprint and deploy guide

**User Story:** As the owner, I want to deploy everything from one Blueprint, pasting only the secrets, so that the hosted demo can be recreated in minutes.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide `render.yaml` at the repo root defining:
   - a private Postgres 16 service with a 1 GB disk;
   - the MCP server web service with `preDeployCommand: node scripts/deploy/db_prepare.mjs` and `healthCheckPath: /healthz`;
   - the simulator web service with `healthCheckPath: /healthz`;
   - the daily reseed cron job.
2. THE SYSTEM SHALL give every secret in `render.yaml` as either `generateValue: true` or `sync: false`, never as a literal value.
3. WHEN the services run on Render THE SYSTEM SHALL connect the simulator to the MCP server over Render's private network (`fromService … property: hostport`).
4. WHEN deployed behind Render's proxy THE SYSTEM SHALL key rate limits on the viewer's address. The MCP server's `MCP_TRUST_PROXY` accepts a hop count N, and the client IP is the Nth entry from the right of `X-Forwarded-For`. `true` still means 1.
5. THE SYSTEM SHALL provide `docs/hackathon/DEPLOY_RENDER.md`:
   - steps: connect GitHub, New → Blueprint, paste secrets;
   - how to generate the two tokens;
   - a monthly cost table (≤ $25);
   - how to verify with `scripts/demo/e2e_voice_flow.mjs --sim-url` and `scripts/demo/inspector_evidence.mjs --label deployed`;
   - a cold-start note.
6. THE SYSTEM SHALL list every new environment variable in `.env.example` and `docs/ENV_VARS.md`, with no real values.
