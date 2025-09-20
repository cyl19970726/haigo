#!/usr/bin/env bash
set -euo pipefail

PROFILE=${1:-${APTOS_PROFILE:-haigo-testnet}}
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v aptos >/dev/null 2>&1; then
  echo "ERROR: aptos CLI not found. Install https://aptos.dev/cli-tools/aptos-cli/" >&2
  exit 1
fi

# Load env files if present (does not override existing vars)
load_env_file() {
  local file="$1"
  if [ -f "$file" ]; then
    while IFS='=' read -r key value; do
      if [[ -z "$key" || "$key" =~ ^# ]]; then
        continue
      fi
      value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      if [[ ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
        value=${value:1:-1}
      elif [[ ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
        value=${value:1:-1}
      fi
      if [ -z "${!key:-}" ]; then
        export "$key"="${value}"
      fi
    done < <(grep -v '^#' "$file" | sed 's/\r$//')
  fi
}

load_env_file "$ROOT_DIR/.env.local"
load_env_file "$ROOT_DIR/.env"
load_env_file "$ROOT_DIR/apps/web/.env.local"
load_env_file "$ROOT_DIR/apps/bff/.env"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Please export it or add to .env.local/.env" >&2
  exit 1
fi

MODULE_ADDR=${NEXT_PUBLIC_APTOS_MODULE:-${APTOS_MODULE_ADDRESS:-}}
if [ -z "$MODULE_ADDR" ]; then
  echo "ERROR: NEXT_PUBLIC_APTOS_MODULE not configured; export it or add to .env.local" >&2
  exit 1
fi

if [[ ! "$MODULE_ADDR" =~ ^0x ]]; then
  MODULE_ADDR="0x${MODULE_ADDR}"
fi

CREDIT_APT=${CREDIT_APT:-1000000}
CREDIT_OCTA=$(node -e '
const value = process.argv[1];
const parsed = Number.parseFloat(value);
if (!Number.isFinite(parsed) || parsed <= 0) {
  console.error("Invalid CREDIT_APT value", value);
  process.exit(1);
}
const OCTA_PER_APT = 1e8;
const octa = BigInt(Math.round(parsed * OCTA_PER_APT));
process.stdout.write(octa.toString());
' "$CREDIT_APT")

if [ -z "$CREDIT_OCTA" ]; then
  echo "ERROR: failed to derive CREDIT_OCTA" >&2
  exit 1
fi

echo "==> Using module: $MODULE_ADDR"
echo "==> Target credit: $CREDIT_APT APT ($CREDIT_OCTA octa)"

echo "==> Fetching warehouse addresses from database"
ADDRESSES=$(pnpm --filter @haigo/bff exec node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const warehouses = await prisma.account.findMany({
      where: { role: 'warehouse' },
      select: { accountAddress: true }
    });
    const list = warehouses
      .map((item) => (item.accountAddress || '').trim())
      .filter((addr) => addr.length > 0)
      .map((addr) => (addr.startsWith('0x') ? addr.toLowerCase() : `0x${addr.toLowerCase()}`));
    const unique = Array.from(new Set(list));
    if (!unique.length) {
      console.error('No warehouse accounts found.');
      process.exit(2);
    }
    process.stdout.write(unique.join('\n'));
  } catch (error) {
    console.error('Failed to query warehouses:', error);
    process.exit(3);
  } finally {
    await prisma.$disconnect();
  }
})();
NODE
)

query_status=$?
if [ "$query_status" -ne 0 ]; then
  exit "$query_status"
fi

if [ -z "$ADDRESSES" ]; then
  echo "ERROR: No warehouse addresses retrieved" >&2
  exit 1
fi

status=0
while IFS= read -r address; do
  echo "-- Setting credit for $address"
  if ! aptos move run \
    --profile "$PROFILE" \
    --assume-yes \
    --function-id "$MODULE_ADDR::staking::set_credit_entry" \
    --args "address:$address" "u64:$CREDIT_OCTA"; then
    echo "   !! Failed to set credit for $address" >&2
    status=1
  fi
done <<<"$ADDRESSES"

if [ "$status" -eq 0 ]; then
  echo "==> Credit update finished successfully for all warehouses."
else
  echo "==> Credit update completed with errors. See logs above." >&2
fi

exit "$status"
