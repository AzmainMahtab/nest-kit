.PHONY: help dev dev-down prod prod-down down build logs ps sh db-up db-down psql redis-cli clean check keygen \
        migrate-create migrate-up migrate-down migrate-status

-include .env
export

DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml
PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

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

db-up: ## Start only Postgres and Redis (for running the app on the host)
	$(DEV) up -d postgres redis

db-down: ## Stop Postgres and Redis
	docker compose stop postgres redis

psql: ## Open a psql shell
	docker compose exec postgres psql -U $(or $(POSTGRES_USER),app) -d $(or $(POSTGRES_DB),appdb)

redis-cli: ## Open a redis-cli shell
	docker compose exec redis redis-cli

clean: ## Remove containers, volumes, and the built image
	$(DEV) down -v --remove-orphans
	-docker image rm nest-kit-api:$(or $(IMAGE_TAG),latest)
