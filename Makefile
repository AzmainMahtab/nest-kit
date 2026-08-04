.PHONY: help dev dev-down prod prod-down down build logs ps sh db-up db-down psql redis-cli clean

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

down: ## Stop everything and remove volumes
	docker compose down -v

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
	docker compose down -v --remove-orphans
	-docker image rm nest-kit-api:$(or $(IMAGE_TAG),latest)
