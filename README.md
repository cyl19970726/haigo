# Haigo Monorepo

Foundational workspace for the Haigo platform. The repository groups Move contracts, backend services, frontend client, and shared packages behind a single package manager.

## Repository Layout
```
haigo/
├─ move/                # Aptos Move package
├─ apps/web/            # Next.js frontend
├─ apps/bff/            # NestJS backend-for-frontend
├─ packages/shared/     # Shared TypeScript utilities
├─ docs/                # Product and architecture documentation
└─ tooling/             # Tooling placeholder for lint/CI helpers
```

## Prerequisites
- Node.js 18+
- Docker & Docker Compose (for Postgres/Hasura stack and optional Move CLI fallback)
- Aptos CLI (or rely on the Docker fallback)
- pnpm 8 (enabled through Corepack)

## Bootstrapping Local Development
```bash
scripts/setup-local.sh
```
The script will:
1. Ensure `corepack` and `pnpm` are available.
2. Verify the Aptos CLI is installed (set `SKIP_APTOS_CHECK=true` to use the Docker fallback).
3. Copy `.env.example` to `.env.local` if missing.
4. Install workspace dependencies across Move, backend, frontend, and shared packages.
5. (Optional) Start Docker services when `START_DOCKER=true` is set.

> Tip: export `START_DOCKER=true` if you want the script to run `docker compose up -d` using the forthcoming Compose file.

## Workspace Commands
| Command | Description |
|---------|-------------|
| `pnpm dev:web` | Start the Next.js application on port 3000. |
| `pnpm dev:bff` | Start the NestJS BFF on port 3001 with live reload. |
| `pnpm move:compile` | Compile Move modules via the Aptos CLI or Docker fallback (`APTOS_DOCKER_IMAGE` to override). |
| `pnpm move:test` | Run Move unit tests via the Aptos CLI or Docker fallback (`APTOS_DOCKER_IMAGE` to override). |
| `pnpm lint` | Execute linting across all packages. |
| `pnpm test` | Run package test scripts (placeholders today). |
| `pnpm build` | Build frontend and backend bundles. |

## Environment Variables
Configuration lives in `.env.local`. Copy from `.env.example` and adjust values for your environment. Key variables:
- `NEXT_PUBLIC_HASURA_URL` / `NEXT_PUBLIC_BFF_URL` for frontend connectivity.
- `APTOS_INDEXER_URL` for on-chain data access.
- `POSTGRES_*` for database credentials.
- `MEDIA_ROOT` for local media storage mounted through Docker.

## Continuous Integration
GitHub Actions workflow `ci.yml` runs on every push and pull request:
1. `move-test` compiles and tests Move code, uploading `move/build/` artifacts.
2. `backend-test` lints and builds the NestJS BFF, publishing the compiled `dist/` folder zipped for deployments.
3. `frontend-build` runs lint + build for the Next.js app, uploading the `.next/` build artifacts along with configuration files for deployment.

Artifacts can be downloaded from the workflow summary for downstream deployment steps.

## Troubleshooting
- Ensure the Aptos CLI is on your PATH, or rely on Docker (used automatically when the CLI is missing).
- Delete `node_modules` and rerun `scripts/setup-local.sh` if dependency installation fails.
- Use `pnpm --filter <package> <command>` to target individual workspaces.

Happy hacking!
