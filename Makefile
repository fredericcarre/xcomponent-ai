.PHONY: help build dev prod stop clean test logs shell distributed-up distributed-down distributed-logs distributed-clean distributed-build distributed-restart

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
	@echo "$(YELLOW)RabbitMQ:  http://localhost:15672 (mayele/mayele123)$(NC)"
	@echo "$(YELLOW)PostgreSQL: localhost:5432 (mayele/mayele123)$(NC)"
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
