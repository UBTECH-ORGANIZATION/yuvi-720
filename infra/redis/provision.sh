#!/usr/bin/env bash
# One Azure Managed Redis per slot, wired the way the two Cosmos clusters are.
#
#   ./infra/redis/provision.sh            # create both caches, wait, set both slots, update backend/.env
#   ./infra/redis/provision.sh --env-only # skip creation; (re)wire settings and .env from existing caches
#
# Never prints a key. Settings are written straight from `az` output into the
# slot configuration and into backend/.env (local points at DEV, like Mongo).
# Production settings are slot-sticky, so a dev→production swap leaves each
# slot talking to its own cache — the same contract as MONGODB_CONNECTION_STRING.
#
# Sizes come from docs/architecture/redis-cache-plan.md §3b (10,000 users):
# production Balanced_B1 with replication, dev Balanced_B0 without. Both
# scale up in place later (`az redisenterprise update --sku Balanced_B3`).
set -euo pipefail

SUBSCRIPTION="${SUBSCRIPTION:-6bec2a17-6e23-437c-8093-6df5688fb1b5}"
RG="${RG:-rg-yuvi-720}"
LOCATION="${LOCATION:-northeurope}"
WEBAPP="${WEBAPP:-ubi-yuvi-720}"
PROD_CACHE="${PROD_CACHE:-redis-yuvi-720}"
DEV_CACHE="${DEV_CACHE:-redis-yuvi-720-dev}"
PORT=10000
ENV_FILE="$(cd "$(dirname "$0")/../.." && pwd)/backend/.env"
ENV_ONLY="${1:-}"

az account set -s "$SUBSCRIPTION"
az extension add --name redisenterprise --upgrade -y >/dev/null 2>&1 || true

create() {
  local name="$1" sku="$2" ha="$3"
  if az redisenterprise show -g "$RG" --cluster-name "$name" -o none 2>/dev/null; then
    echo "· $name already exists"
    return
  fi
  echo "· creating $name ($sku, high availability $ha)"
  az redisenterprise create -g "$RG" --cluster-name "$name" --sku "$sku" -l "$LOCATION" \
    --public-network-access Enabled --eviction-policy AllKeysLRU --client-protocol Encrypted \
    --clustering-policy EnterpriseCluster --minimum-tls-version 1.2 --high-availability "$ha" \
    --port "$PORT" --no-wait -o none
}

wait_ready() {
  local name="$1" state=""
  for _ in $(seq 1 90); do
    state="$(az redisenterprise show -g "$RG" --cluster-name "$name" --query provisioningState -o tsv 2>/dev/null || true)"
    dbstate="$(az redisenterprise database show -g "$RG" --cluster-name "$name" --query provisioningState -o tsv 2>/dev/null || true)"
    if [ "$state" = "Succeeded" ] && [ "$dbstate" = "Succeeded" ]; then echo "· $name ready"; return; fi
    sleep 20
  done
  echo "!! $name is not ready after 30 minutes (state: $state / $dbstate)"; exit 1
}

# rediss://:<key>@<host>:10000/0 — built in a subshell, passed straight to az, never echoed.
conn() {
  local name="$1" host key
  host="$(az redisenterprise show -g "$RG" --cluster-name "$name" --query hostName -o tsv)"
  key="$(az redisenterprise database list-keys -g "$RG" --cluster-name "$name" --query primaryKey -o tsv)"
  printf 'rediss://:%s@%s:%s/0' "$key" "$host" "$PORT"
}

wire_slot() {
  local name="$1" slot="$2" host
  host="$(az redisenterprise show -g "$RG" --cluster-name "$name" --query hostName -o tsv)"
  if [ "$slot" = "production" ]; then
    az webapp config appsettings set -g "$RG" -n "$WEBAPP" \
      --slot-settings "REDIS_CONNECTION_STRING=$(conn "$name")" "SPARK_CACHE=redis" -o none
  else
    az webapp config appsettings set -g "$RG" -n "$WEBAPP" --slot "$slot" \
      --slot-settings "REDIS_CONNECTION_STRING=$(conn "$name")" "SPARK_CACHE=redis" -o none
  fi
  echo "· slot $slot → $host (sticky: REDIS_CONNECTION_STRING, SPARK_CACHE=redis)"
}

wire_env() {
  local name="$1" host
  host="$(az redisenterprise show -g "$RG" --cluster-name "$name" --query hostName -o tsv)"
  touch "$ENV_FILE"
  if grep -q '^REDIS_CONNECTION_STRING=' "$ENV_FILE"; then
    echo "· backend/.env already has REDIS_CONNECTION_STRING (left as is)"
  else
    { printf '\n# Redis, DEV cache (local points at dev, like the database). See docs/architecture/redis-cache-plan.md\n'
      printf 'REDIS_CONNECTION_STRING=%s\n' "$(conn "$name")"
      printf 'SPARK_CACHE=redis\n'; } >> "$ENV_FILE"
    echo "· backend/.env → $host"
  fi
}

if [ "$ENV_ONLY" != "--env-only" ]; then
  create "$DEV_CACHE"  Balanced_B0 Disabled
  create "$PROD_CACHE" Balanced_B1 Enabled
  wait_ready "$DEV_CACHE"
  wait_ready "$PROD_CACHE"
fi
wire_slot "$DEV_CACHE"  dev
wire_slot "$PROD_CACHE" production
wire_env  "$DEV_CACHE"

echo
echo "Done. Verify hosts only (never the strings):"
echo "  az webapp config appsettings list -g $RG -n $WEBAPP --slot dev --query \"[?name=='REDIS_CONNECTION_STRING'].value\" -o tsv | sed -E 's|.*@([^/?,]+).*|\\1|'"
echo "  az webapp config appsettings list -g $RG -n $WEBAPP --query \"[?name=='REDIS_CONNECTION_STRING'].value\" -o tsv | sed -E 's|.*@([^/?,]+).*|\\1|'"
