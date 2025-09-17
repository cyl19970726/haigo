# Haigo Move Package

Baseline Aptos Move package containing placeholder modules to validate the toolchain.

## Commands
- `pnpm move:compile` - compile the Move package (uses local Aptos CLI or Docker fallback)
- `pnpm move:test` - execute Move unit tests via the Aptos CLI or Docker fallback image

The helper scripts under `scripts/` automatically run a Docker image when the `aptos` binary is not installed locally. Override the image by exporting `APTOS_DOCKER_IMAGE` (defaults to `aptoslabs/aptos-tools:latest`).
