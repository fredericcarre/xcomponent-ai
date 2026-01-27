.PHONY: help build dev prod stop clean test logs shell distributed-up distributed-down distributed-logs distributed-clean distributed-build distributed-restart distributed-redis-up distributed-redis-down distributed-redis-logs distributed-redis-clean distributed-redis-build distributed-redis-restart e2e-rabbitmq e2e-redis e2e-inmemory e2e-all

# Colors for output
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(GREEN)xcomponent-ai Docker Commands$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-15s$(NC) %s\n", $$1, $$2}'
	@echo ""

build: ## Build Docker images
	@echo "$(GREEN)Building Docker images...$(NC)"
	docker compose build

dev: ## Start development environment with hot reload
	@echo "$(GREEN)Starting development environment...$(NC)"
	@echo "$(YELLOW)Dashboard: http://localhost:3000/dashboard.html$(NC)"
	docker compose up dev

prod: ## Start production environment
	@echo "$(GREEN)Starting production environment...$(NC)"
	@echo "$(YELLOW)Dashboard: http://localhost:3000/dashboard.html$(NC)"
	docker compose up prod

stop: ## Stop all containers
	@echo "$(GREEN)Stopping containers...$(NC)"
	docker compose down

clean: ## Remove containers, volumes, and images
	@echo "$(GREEN)Cleaning up Docker resources...$(NC)"
	docker compose down -v --rmi all

test: ## Run tests in Docker
	@echo "$(GREEN)Running tests...$(NC)"
	docker compose run --rm test

logs: ## Show logs from running containers
	docker compose logs -f

shell: ## Open shell in development container
	@echo "$(GREEN)Opening shell in development container...$(NC)"
	docker compose run --rm dev sh

# Quick start with simple example
quick-start: build dev ## Build and start development environment

# Start with e-commerce example
ecommerce: ## Start with e-commerce example
	@echo "$(GREEN)Starting with e-commerce example...$(NC)"
	docker compose run --rm -p 3000:3000 dev sh -c "npm run build && node dist/cli.js serve examples/e-commerce-order/component.yaml --port 3000"

# Start with approval workflow example
approval: ## Start with approval workflow example
	@echo "$(GREEN)Starting with approval workflow example...$(NC)"
	docker compose run --rm -p 3000:3000 dev sh -c "npm run build && node dist/cli.js serve examples/approval-workflow/component.yaml --port 3000"

# Start with subscription lifecycle example
subscription: ## Start with subscription lifecycle example
	@echo "$(GREEN)Starting with subscription lifecycle example...$(NC)"
	docker compose run --rm -p 3000:3000 dev sh -c "npm run build && node dist/cli.js serve examples/subscription-lifecycle/component.yaml --port 3000"

# ============================================
# Distributed Mode (RabbitMQ + PostgreSQL)
# ============================================

distributed-up: ## Start distributed mode (RabbitMQ + PostgreSQL + Dashboard + Runtimes)
	@echo "$(GREEN)Starting distributed infrastructure...$(NC)"
	@echo "$(YELLOW)Dashboard: http://localhost:3000$(NC)"
	@echo "$(YELLOW)RabbitMQ:  http://localhost:15672 (xcomponent/xcomponent123)$(NC)"
	@echo "$(YELLOW)PostgreSQL: localhost:5432 (xcomponent/xcomponent123)$(NC)"
	cd examples/distributed && docker compose up -d
	@echo ""
	@echo "$(GREEN)Services started! Use 'make distributed-logs' to see logs$(NC)"

distributed-down: ## Stop distributed infrastructure
	@echo "$(GREEN)Stopping distributed infrastructure...$(NC)"
	cd examples/distributed && docker compose down

distributed-logs: ## Show logs from distributed services
	cd examples/distributed && docker compose logs -f

distributed-clean: ## Remove distributed containers and volumes
	@echo "$(GREEN)Cleaning distributed resources...$(NC)"
	cd examples/distributed && docker compose down -v --rmi all

distributed-build: ## Build distributed Docker images
	@echo "$(GREEN)Building distributed images...$(NC)"
	cd examples/distributed && docker compose build

distributed-restart: distributed-down distributed-up ## Restart distributed infrastructure

# ============================================
# Distributed Mode - Redis + PostgreSQL
# ============================================

distributed-redis-up: ## Start distributed mode with Redis (Redis + PostgreSQL + Dashboard + Runtimes)
	@echo "$(GREEN)Starting Redis distributed infrastructure...$(NC)"
	@echo "$(YELLOW)Dashboard:  http://localhost:3000$(NC)"
	@echo "$(YELLOW)Redis:      localhost:6379$(NC)"
	@echo "$(YELLOW)PostgreSQL: localhost:5432 (xcomponent/xcomponent123)$(NC)"
	cd examples/distributed-redis && docker compose up -d
	@echo ""
	@echo "$(GREEN)Services started! Use 'make distributed-redis-logs' to see logs$(NC)"

distributed-redis-down: ## Stop Redis distributed infrastructure
	@echo "$(GREEN)Stopping Redis distributed infrastructure...$(NC)"
	cd examples/distributed-redis && docker compose down

distributed-redis-logs: ## Show logs from Redis distributed services
	cd examples/distributed-redis && docker compose logs -f

distributed-redis-clean: ## Remove Redis distributed containers and volumes
	@echo "$(GREEN)Cleaning Redis distributed resources...$(NC)"
	cd examples/distributed-redis && docker compose down -v --rmi all

distributed-redis-build: ## Build Redis distributed Docker images
	@echo "$(GREEN)Building Redis distributed images...$(NC)"
	cd examples/distributed-redis && docker compose build

distributed-redis-restart: distributed-redis-down distributed-redis-up ## Restart Redis distributed infrastructure

# ============================================
# E2E Tests (full Docker-based)
# ============================================

e2e-rabbitmq: ## Run E2E tests with RabbitMQ distributed mode
	@echo "$(GREEN)Running RabbitMQ E2E tests...$(NC)"
	cd examples/distributed && docker compose up -d --build
	@echo "$(YELLOW)Waiting for services to be ready...$(NC)"
	@sleep 15
	@node examples/distributed/e2e-test.js; \
	EXIT_CODE=$$?; \
	cd examples/distributed && docker compose down; \
	exit $$EXIT_CODE

e2e-redis: ## Run E2E tests with Redis distributed mode
	@echo "$(GREEN)Running Redis E2E tests...$(NC)"
	cd examples/distributed-redis && docker compose up -d --build
	@echo "$(YELLOW)Waiting for services to be ready...$(NC)"
	@sleep 15
	@node examples/distributed-redis/e2e-test.js; \
	EXIT_CODE=$$?; \
	cd examples/distributed-redis && docker compose down; \
	exit $$EXIT_CODE

e2e-inmemory: ## Run E2E tests with in-memory mode (no Docker needed)
	@echo "$(GREEN)Running in-memory E2E tests...$(NC)"
	npx jest tests/cross-component-e2e.test.ts --testTimeout=30000 --verbose

e2e-all: e2e-inmemory e2e-rabbitmq e2e-redis ## Run all E2E tests (in-memory, RabbitMQ, Redis)

# ============================================
# Integration Tests (Docker-based)
# ============================================

test-integration-up: ## Start integration test infrastructure (PostgreSQL, RabbitMQ, Redis)
	@echo "$(GREEN)Starting integration test infrastructure...$(NC)"
	docker compose -f tests/integration/docker-compose.yml up -d
	@echo "$(YELLOW)Waiting for services to be ready...$(NC)"
	@sleep 5
	@echo "$(GREEN)Integration infrastructure ready!$(NC)"

test-integration-down: ## Stop integration test infrastructure
	@echo "$(GREEN)Stopping integration test infrastructure...$(NC)"
	docker compose -f tests/integration/docker-compose.yml down

test-integration: test-integration-up ## Run integration tests with Docker infrastructure
	@echo "$(GREEN)Running integration tests...$(NC)"
	INTEGRATION_TEST=true npm test -- --testPathPattern=integration --coverage=false --testTimeout=30000 || true
	@make test-integration-down

test-integration-clean: ## Remove integration test containers and volumes
	@echo "$(GREEN)Cleaning integration test resources...$(NC)"
	docker compose -f tests/integration/docker-compose.yml down -v
