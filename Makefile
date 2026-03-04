V2_ENV_FILE ?= infra/compose/v2/.env
V2_ENV_EXAMPLE := infra/compose/v2/.env.example
V2_COMPOSE_FILE := infra/compose/v2/docker-compose.yml
V2_COMPOSE := docker compose --env-file $(V2_ENV_FILE) -f $(V2_COMPOSE_FILE)

.PHONY: v2-up v2-down v2-reset v2-smoke

v2-up:
	@if [ ! -f "$(V2_ENV_FILE)" ]; then cp "$(V2_ENV_EXAMPLE)" "$(V2_ENV_FILE)"; fi
	$(V2_COMPOSE) up -d --build

v2-down:
	@if [ -f "$(V2_ENV_FILE)" ]; then $(V2_COMPOSE) down; else echo "No $(V2_ENV_FILE) found; nothing to stop."; fi

v2-reset:
	@if [ ! -f "$(V2_ENV_FILE)" ]; then cp "$(V2_ENV_EXAMPLE)" "$(V2_ENV_FILE)"; fi
	$(V2_COMPOSE) down -v --remove-orphans

v2-smoke: v2-up
	./scripts/v2/v2_smoke.sh
