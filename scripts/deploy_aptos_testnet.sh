#!/usr/bin/env bash
set -euo pipefail

# Deploy the Move package to Aptos testnet and update .env.local with module addresses
# Usage: scripts/deploy_aptos_testnet.sh [profile]

PROFILE=${1:-haigo-testnet}
NETWORK=testnet
REST_URL=${REST_URL:-https://fullnode.testnet.aptoslabs.com/v1}
FAUCET_URL=${FAUCET_URL:-https://faucet.testnet.aptoslabs.com}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT_DIR/move"
ENV_FILE="$ROOT_DIR/.env.local"
WEB_ENV_FILE="$ROOT_DIR/apps/web/.env.local"

echo "==> Deploying Move package to Aptos $NETWORK with profile '$PROFILE'"

command -v aptos >/dev/null 2>&1 || { echo "ERROR: aptos CLI not found. Install from https://aptos.dev/cli-tools/aptos-cli/"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required"; exit 1; }

# Ensure ~/.aptos exists and profile is initialized
CONFIG_FILE_LOCAL="$ROOT_DIR/.aptos/config.yaml"
CONFIG_FILE_HOME="$HOME/.aptos/config.yaml"
CONFIG_FILE="$CONFIG_FILE_LOCAL"
if ! [ -f "$CONFIG_FILE" ]; then
  CONFIG_FILE="$CONFIG_FILE_HOME"
fi

if ! [ -f "$CONFIG_FILE" ] || ! grep -q "^  $PROFILE:" "$CONFIG_FILE" 2>/dev/null; then
  echo "==> Initializing aptos profile '$PROFILE' for $NETWORK"
  aptos init \
    --assume-yes \
    --profile "$PROFILE" \
    --network "$NETWORK"
fi

# Read the account address from the profile
# Parse account from config.yaml (project local or home)
ACCOUNT_ADDR=$(awk -v prof="$PROFILE" '
  $1=="profiles:" { in_profiles=1; next }
  in_profiles && $1==prof":" { in_target=1; next }
  in_target && $1=="account:" { print $2; exit }
  in_target && NF==0 { in_target=0 }
' "$CONFIG_FILE" | tr -d '"')

if [ -z "$ACCOUNT_ADDR" ]; then
  echo "ERROR: Could not determine account address for profile '$PROFILE'"
  exit 1
fi
if [[ "$ACCOUNT_ADDR" != 0x* ]]; then
  ACCOUNT_ADDR="0x$ACCOUNT_ADDR"
fi
echo "==> Using account: $ACCOUNT_ADDR (from $CONFIG_FILE)"

# Fund with faucet (idempotent)
echo "==> Funding account from faucet (if needed)"
aptos account fund-with-faucet \
  --profile "$PROFILE" \
  --amount 100000000 \
  --faucet-url "$FAUCET_URL" >/dev/null || true

echo "==> Publishing Move package (named address haigo=$ACCOUNT_ADDR)"
(
  cd "$PKG_DIR"
  aptos move publish \
    --profile "$PROFILE" \
    --assume-yes \
    --named-addresses haigo=$ACCOUNT_ADDR
)

echo "==> Post-publish initialization & configuration"
# init_*_entry are public wrappers for idempotent initialization.
aptos move run --profile "$PROFILE" --assume-yes --function-id "$ACCOUNT_ADDR::registry::init_registry_entry" || true
aptos move run --profile "$PROFILE" --assume-yes --function-id "$ACCOUNT_ADDR::orders::init_orders_entry" || true
aptos move run --profile "$PROFILE" --assume-yes --function-id "$ACCOUNT_ADDR::orders::configure" \
  --args address:$ACCOUNT_ADDR bool:false || true

# Update .env.local with addresses and network
echo "==> Updating $ENV_FILE and $WEB_ENV_FILE"
touch "$ENV_FILE"
backup="$ENV_FILE.bak.$(date +%s)"
cp "$ENV_FILE" "$backup"
touch "$WEB_ENV_FILE"
web_backup="$WEB_ENV_FILE.bak.$(date +%s)"
cp "$WEB_ENV_FILE" "$web_backup" 2>/dev/null || true

upsert_env_file() {
  local file="$1"; shift
  local key="$1"; shift
  local val="$1"; shift
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i '' -E "s#^${key}=.*#${key}=${val}#" "$file"
  else
    printf "%s=%s\n" "$key" "$val" >>"$file"
  fi
}

# root env updates (BFF / scripts)
upsert_env_file "$ENV_FILE" APTOS_NETWORK "$NETWORK"
upsert_env_file "$ENV_FILE" NEXT_PUBLIC_APTOS_NETWORK "$NETWORK"
upsert_env_file "$ENV_FILE" NEXT_PUBLIC_APTOS_MODULE "$ACCOUNT_ADDR"
upsert_env_file "$ENV_FILE" NEXT_PUBLIC_APTOS_ORDERS_MODULE "$ACCOUNT_ADDR"

# web env updates (Next.js reads apps/web/.env.local)
upsert_env_file "$WEB_ENV_FILE" NEXT_PUBLIC_APTOS_NETWORK "$NETWORK"
upsert_env_file "$WEB_ENV_FILE" NEXT_PUBLIC_APTOS_MODULE "$ACCOUNT_ADDR"
upsert_env_file "$WEB_ENV_FILE" NEXT_PUBLIC_APTOS_ORDERS_MODULE "$ACCOUNT_ADDR"

echo "==> Done. Backups: $backup and $web_backup"
echo "    Deployed module address: $ACCOUNT_ADDR"
echo "    Remember to restart your apps to pick up env changes."
