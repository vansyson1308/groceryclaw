# Telegram Ingress Router

Workflow: `n8n/workflows/telegram_ingress_router.json`

## Purpose
Add Telegram channel support **without duplicating core business logic**.

Telegram ingress normalizes updates and calls existing core workflows:
- Photo → `invoice_image_vision_parse`
- XML document → `invoice_xml_parse_normalize`
- Text/callback → session/help route stub (for existing handlers integration)

## Bot setup (BotFather)
1. Open Telegram and chat with `@BotFather`.
2. Run `/newbot` and create your bot.
3. Copy bot token and set in env:
   - `TELEGRAM_BOT_TOKEN=...`

## Webhook configuration
Telegram requires a public HTTPS webhook.

### Local dev with ngrok
1. Start n8n locally (`docker compose up -d`).
2. Expose n8n:
   ```bash
   ngrok http 5678
   ```
3. Set `.env`:
   - `N8N_WEBHOOK_BASE_URL=https://<your-ngrok-domain>/`
4. Configure Telegram webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://<your-ngrok-domain>/webhook/telegram"
   ```

> Note: exact webhook path may vary by n8n Telegram Trigger internals; verify in n8n node panel after activation.

## Testing
### 1) Text message
- Send any text to your bot.
- Expect: `ops_events` row with `workflow='telegram_ingress_router'`, `event_type='text_event'`.

### 2) Photo message
- Send a photo.
- Expect:
  - router downloads Telegram file binary
  - calls `invoice_image_vision_parse`
  - `invoice_log.source_type='telegram_image'`
  - `invoice_log.source_url='telegram:file_id:<id>'`

### 3) XML document
- Send `.xml` as file attachment.
- Expect:
  - router downloads file
  - converts binary→`xml_text`
  - calls `invoice_xml_parse_normalize`
  - `invoice_log.source_type='telegram_xml'`.

## Security notes
- Workflow exports contain no real tokens.
- Telegram bot token must come from runtime env only.
- No tokenized Telegram URLs are persisted; source is logged as `telegram:file_id:<id>`.
