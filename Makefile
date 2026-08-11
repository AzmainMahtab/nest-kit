.PHONY: help dev dev-down prod prod-down down build logs ps sh db-up db-down psql redis-cli clean check keygen \
        obs-up obs-down obs-logs \
        migrate-create migrate-up migrate-down migrate-status seed \
        dev-migrate dev-seed prod-migrate prod-seed

-include .env
export

DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml
# A third overlay rather than part of DEV: four extra containers that a
# feature-branch `make dev` does not need.
OBS  = docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.observability.yml

# ==========================================
# MAIN COMMANDS
# ==========================================

help: ## Show this help menu
	@echo "Nest Kit Docker Commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'

dev: ## Start the development stack with hot reload and debugger
	$(DEV) up --build -d

dev-down: ## Stop the development stack
	$(DEV) down

prod: ## Start the production stack
	$(PROD) up --build -d

prod-down: ## Stop the production stack
	$(PROD) down

# Volumes are not all declared in the base file — node_modules lives in the dev
# overlay, so a bare `docker compose down -v` silently leaves it behind and the
# next `make dev` boots against a stale node_modules.
down: ## Stop everything and remove volumes
	$(DEV) down -v

# ==========================================
# QUALITY GATES
# ==========================================

check: ## Run every gate: lint, typecheck, architecture, tests
	pnpm run check

migrate-create: ## Create an empty migration: make migrate-create NAME=CreateUsersTable
	@test -n "$(NAME)" || (echo "NAME is required, e.g. make migrate-create NAME=CreateUsersTable"; exit 1)
	pnpm run migration:create src/database/migrations/$(NAME)

migrate-up: ## Apply pending migrations
	pnpm run migration:run

migrate-down: ## Revert the last migration
	pnpm run migration:revert

migrate-status: ## Show applied and pending migrations
	pnpm run migration:show

# The relay and the consumers belong to the API; a short-lived seed process
# starting them would attach JetStream consumers it is about to abandon. The
# entrypoint sets the same two variables inside a container.
seed: ## Seed roles, permissions and the superadmin (idempotent; safe to re-run)
	OUTBOX_ENABLED=false DURABLE_CONSUMER_ENABLED=false pnpm run seed

# ==========================================
# IN-CONTAINER (same image, same config as the running API)
# ==========================================

dev-migrate: ## Apply migrations inside the development stack
	$(DEV) run --rm api migrate

dev-seed: ## Seed inside the development stack
	$(DEV) run --rm api seed

prod-migrate: ## Apply migrations inside the production stack
	$(PROD) run --rm api migrate

prod-seed: ## Seed inside the production stack
	$(PROD) run --rm api seed

keygen: ## Generate the ES256 keypair into certs/
	@mkdir -p certs
	@openssl ecparam -name prime256v1 -genkey -noout -out certs/private-ec.pem
	@openssl pkcs8 -topk8 -nocrypt -in certs/private-ec.pem -out certs/private.pem
	@openssl ec -in certs/private.pem -pubout -out certs/public.pem
	@rm -f certs/private-ec.pem
	@chmod 600 certs/private.pem
	@echo "wrote certs/private.pem (PKCS#8) and certs/public.pem (SPKI)"

# ==========================================
# BUILD & INSPECT
# ==========================================

build: ## Build the production image
	$(PROD) build

logs: ## Tail logs from all services
	docker compose logs -f

ps: ## Show service status
	docker compose ps

sh: ## Open a shell in the api container
	docker compose exec api sh

# ==========================================
# DATABASES
# ==========================================

db-up: ## Start Postgres, Redis and NATS (for running the app on the host)
	$(DEV) up -d postgres redis nats

db-down: ## Stop Postgres, Redis and NATS
	docker compose stop postgres redis nats

# ==========================================
# OBSERVABILITY
# ==========================================

obs-up: ## Start the dev stack with Prometheus, Loki, Promtail and Grafana
	$(OBS) up -d
	@echo "Grafana    http://localhost:$(or $(GRAFANA_PORT),3001)  ($(or $(GRAFANA_USER),admin) / $(or $(GRAFANA_PASSWORD),admin))"
	@echo "Prometheus http://localhost:$(or $(PROMETHEUS_PORT),9090)"
	@echo "Metrics    http://localhost:$(or $(API_PORT),3000)/metrics"

obs-down: ## Stop the observability containers, leaving the app running
	$(OBS) stop prometheus loki promtail grafana

obs-logs: ## Tail the observability containers
	$(OBS) logs -f prometheus loki promtail grafana

nats-info: ## Show JetStream stream state
	@curl -s http://127.0.0.1:$(or $(NATS_MONITOR_PORT),8222)/jsz?streams=1 | head -40

psql: ## Open a psql shell
	docker compose exec postgres psql -U $(or $(POSTGRES_USER),app) -d $(or $(POSTGRES_DB),appdb)

redis-cli: ## Open a redis-cli shell
	docker compose exec redis redis-cli

clean: ## Remove containers, volumes, and the built image
	$(DEV) down -v --remove-orphans
	-docker image rm nest-kit-api:$(or $(IMAGE_TAG),latest)
