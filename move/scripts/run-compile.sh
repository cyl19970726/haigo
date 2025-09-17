#!/usr/bin/env bash
set -euo pipefail

if command -v aptos >/dev/null 2>&1; then
  exec aptos move compile --dev "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Aptos CLI not found and Docker is unavailable. Install the Aptos CLI or Docker to proceed." >&2
  exit 1
fi

IMAGE_NAME=${APTOS_DOCKER_IMAGE:-aptoslabs/aptos-tools:latest}

docker run --rm \
  -v "$(pwd)":/workspace \
  -w /workspace \
  "$IMAGE_NAME" \
  aptos move compile --dev "$@"
