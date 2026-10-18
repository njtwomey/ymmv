# ymmv: `make` scrapes the 3-door MINI Hatch; `make help` lists everything.
# Override the car or source: make scrape CAR=vw-golf SOURCE=autotrader

CAR ?= mini-hatch-3dr
SOURCE ?=
WEB := npm --prefix web

.DEFAULT_GOAL := scrape
.PHONY: help scrape install dev build site migrate db-snapshot db-restore status cars check lint lint-py lint-web fmt \
	typecheck typecheck-py typecheck-web test test-py test-web

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

scrape: ## Scrape CAR (default mini-hatch-3dr) from every source, or SOURCE=...
	uv run scrape --car $(CAR) $(if $(SOURCE),--source $(SOURCE))

install: ## Install dependencies and build the database from db/snapshot if it's missing
	uv sync --all-packages
	$(WEB) install
	uv run ymmv migrate

dev: ## Run the web app locally
	$(WEB) run dev

build: ## Production build of the web app
	$(WEB) run build

site: ## Build the read-only published site into web/dist (as GitHub Pages does)
	cd web && BASE_PATH=/ymmv/ npm run build:static

migrate: ## Bring the database schema up to date
	uv run ymmv migrate

db-snapshot: ## Write the database as SQL files in db/snapshot (what git tracks)
	uv run ymmv snapshot

db-restore: ## Rebuild db/ymmv.sqlite from db/snapshot (FORCE=1 to replace an existing one)
	uv run ymmv restore $(if $(FORCE),--force)

status: ## Scrape runs and listing counts
	uv run ymmv status

cars: ## Cars defined in cars.yaml
	uv run ymmv cars

check: lint typecheck test build ## Everything: lint, typecheck, tests, build (Python + web)

lint: lint-py lint-web ## Lint Python and web

lint-py:
	uv run ruff check src tests
	uv run ruff format --check src tests

lint-web:
	$(WEB) run lint

fmt: ## Format and auto-fix Python
	uv run ruff format src tests
	uv run ruff check --fix src tests

typecheck: typecheck-py typecheck-web ## Typecheck Python (pyright) and web (tsc)

typecheck-py:
	uv run pyright

typecheck-web:
	$(WEB) run typecheck

test: test-py test-web ## Run Python (pytest) and web (vitest) tests

test-py:
	uv run pytest -q

test-web:
	$(WEB) test -- --run
