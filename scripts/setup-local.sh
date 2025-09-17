#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

log() {
  printf "[setup] %s\n" "$1"
}

ensure_corepack() {
  if command -v corepack >/dev/null 2>&1; then
    return
  fi
  log "corepack not found. Install Node.js >= 18 to continue."
  exit 1
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi
  log "pnpm not found. enabling via corepack."
  corepack enable pnpm || {
    log "failed to enable pnpm via corepack"
    exit 1
  }
}

verify_aptos_cli() {
  if [[ "${SKIP_APTOS_CHECK:-false}" == "true" ]]; then
    log "Skipping Aptos CLI verification by request"
    return
  fi

  if command -v aptos >/dev/null 2>&1; then
    return
  fi

  log "Aptos CLI not detected."
  log "Install instructions: https://aptos.dev/en/build/cli/install-cli"
  log "Set SKIP_APTOS_CHECK=true to bypass this validation (e.g., CI using Dockerized CLI)."
  exit 1
}

bootstrap_env_file() {
  if [[ ! -f "$EXAMPLE_FILE" ]]; then
    log ".env.example is missing. Did the repository checkout succeed?"
    exit 1
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    log "creating .env.local from template"
    cp "$EXAMPLE_FILE" "$ENV_FILE"
  fi
}

install_dependencies() {
  pushd "$ROOT_DIR" >/dev/null
  log "installing workspace dependencies"
  pnpm install --frozen-lockfile || pnpm install
  popd >/dev/null
}

maybe_start_docker() {
  if [[ "${START_DOCKER:-false}" != "true" ]]; then
    log "skipping docker compose startup (set START_DOCKER=true to enable)"
    return
  fi

  if [[ ! -f "$ROOT_DIR/docker-compose.yml" ]]; then
    log "docker-compose.yml not present. Skipping container startup."
    return
  fi

  log "starting docker services in detached mode"
  docker compose up -d
}

main() {
  log "Bootstrapping Haigo developer environment"
  ensure_corepack
  ensure_pnpm
  verify_aptos_cli
  bootstrap_env_file
  install_dependencies
  maybe_start_docker
  log "Setup complete"
}

main "$@"
