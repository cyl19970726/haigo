#!/usr/bin/env bash
set -euo pipefail

# Deploy registry contract to testnet
# Usage: ./deploy_registry.sh [profile_name]

PROFILE_NAME=${1:-default}

echo "Deploying registry module to testnet using profile: $PROFILE_NAME"

if command -v aptos >/dev/null 2>&1; then
    echo "Using local Aptos CLI"
    aptos move publish \
        --profile "$PROFILE_NAME" \
        --assume-yes \
        --max-gas 10000 \
        --gas-unit-price 100
else
    echo "Aptos CLI not found, using Docker"
    IMAGE_NAME=${APTOS_DOCKER_IMAGE:-aptoslabs/aptos-tools:latest}

    docker run --rm \
        -v "$(pwd)":/workspace \
        -w /workspace \
        -v "$HOME/.aptos":/root/.aptos \
        "$IMAGE_NAME" \
        aptos move publish \
            --profile "$PROFILE_NAME" \
            --assume-yes \
            --max-gas 10000 \
            --gas-unit-price 100
fi

echo "Registry deployment completed successfully!"
echo "Please record the deployed module address in packages/shared/config/aptos.ts"
echo "You can verify the deployment using: aptos account list --profile $PROFILE_NAME"