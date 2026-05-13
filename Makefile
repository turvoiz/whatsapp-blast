# Grosenia WA Blast Service — Makefile (local dev)
# Untuk Docker orchestration full stack, pakai Makefile di ../api-web/

.PHONY: help install dev start lint clean docker-build docker-run docker-stop docker-logs docker-shell docker-clean
.DEFAULT_GOAL := help

# Colors
GREEN  := \033[0;32m
BLUE   := \033[0;34m
YELLOW := \033[0;33m
RED    := \033[0;31m
RESET  := \033[0m

IMAGE_NAME := grosenia-wa-blast
CONTAINER_NAME := grosenia-wa-blast
PORT := 3010

#================================================================
# HELP
#================================================================
help:
	@echo "$(BLUE)╔════════════════════════════════════════════════╗$(RESET)"
	@echo "$(BLUE)║       Grosenia WA Blast Service Commands      ║$(RESET)"
	@echo "$(BLUE)╚════════════════════════════════════════════════╝$(RESET)"
	@echo ""
	@echo "$(GREEN)🚀 Local Dev (tanpa Docker):$(RESET)"
	@echo "  make install         Install dependencies (npm install)"
	@echo "  make dev             Run dev mode (auto-reload via node --watch)"
	@echo "  make start           Run production mode (node)"
	@echo "  make clean           Remove node_modules + session WA"
	@echo ""
	@echo "$(GREEN)🐳 Docker (standalone, tanpa compose):$(RESET)"
	@echo "  make docker-build    Build image $(IMAGE_NAME)"
	@echo "  make docker-run      Run container detached"
	@echo "  make docker-stop     Stop & remove container"
	@echo "  make docker-logs     Stream container logs"
	@echo "  make docker-shell    Shell ke dalam container"
	@echo "  make docker-clean    Stop container + hapus image"
	@echo ""
	@echo "$(YELLOW)Untuk deploy full Grosenia stack (api-web + admin-web + wa-blast),$(RESET)"
	@echo "$(YELLOW)pakai Makefile di /Users/reyvin/Grosenia/api-web/$(RESET)"

#================================================================
# LOCAL DEV
#================================================================
install:
	@echo "$(BLUE)📦 Installing dependencies...$(RESET)"
	@npm install
	@echo "$(GREEN)✅ Done$(RESET)"

dev:
	@echo "$(GREEN)🚀 Starting WA Blast Service (dev mode)...$(RESET)"
	@npm run dev

start:
	@echo "$(GREEN)🚀 Starting WA Blast Service...$(RESET)"
	@npm start

clean:
	@echo "$(YELLOW)🧹 Cleaning node_modules & session data...$(RESET)"
	@rm -rf node_modules auth_info_baileys .wwebjs_auth .wwebjs_cache
	@echo "$(GREEN)✅ Done$(RESET)"

#================================================================
# DOCKER (standalone — pakai cuma kalau gak via compose)
#================================================================
docker-build:
	@echo "$(BLUE)🔨 Building Docker image $(IMAGE_NAME)...$(RESET)"
	@docker build -t $(IMAGE_NAME) .
	@echo "$(GREEN)✅ Image built: $(IMAGE_NAME)$(RESET)"

docker-run:
	@echo "$(GREEN)🚀 Running container $(CONTAINER_NAME)...$(RESET)"
	@docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(PORT):3010 \
		-v wa_session_data:/app/auth_info_baileys \
		--restart unless-stopped \
		$(IMAGE_NAME)
	@echo "$(GREEN)✅ Container running at http://localhost:$(PORT)$(RESET)"
	@echo "$(YELLOW)💡 Lihat logs: make docker-logs$(RESET)"

docker-stop:
	@echo "$(YELLOW)🛑 Stopping container...$(RESET)"
	@docker stop $(CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "$(GREEN)✅ Stopped$(RESET)"

docker-logs:
	@docker logs -f --tail=200 $(CONTAINER_NAME)

docker-shell:
	@docker exec -it $(CONTAINER_NAME) /bin/bash

docker-clean: docker-stop
	@echo "$(YELLOW)🧹 Removing image $(IMAGE_NAME)...$(RESET)"
	@docker rmi $(IMAGE_NAME) 2>/dev/null || true
	@echo "$(GREEN)✅ Done$(RESET)"
