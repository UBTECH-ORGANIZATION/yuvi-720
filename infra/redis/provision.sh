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
# Public endpoint + TLS + key, the same exposure as the two Cosmos clusters today
# (publicNetworkAccess Enabled, no private endpoints). The dev slot has no VNet
# integration, so dev has no other option. Production IS integrated into
# vnet-yuvi-lrs with route-all; when the LRS firewall design allows it, set
# PUBLIC_ACCESS=Disabled and add a private endpoint + privatelink DNS zone for
# redis-yuvi-720 (see the plan, §6). The API version requires the property
# to be stated either way.
PUBLIC_ACCESS="${PUBLIC_ACCESS:-Enabled}"
ENV_FILE="$(cd "$(dirname "$0")/../.." && pwd)/backend/.env"
ENV_ONLY="${1:-}"

az account set -s "$SUBSCRIPTION"
az extension add --name redisenterprise --upgrade -y >/dev/null 2>&1 || true

# Cluster first, database second. `az redisenterprise create` without
# --no-database sends the database PUT straight after the cluster PUT, the
# service answers "The cluster is not yet running", and the cluster is left
# in CreateFailed. So: cluster with --no-database, wait for it to run, then
# the database with the database-level options (protocol, policy, port).
cluster_state() {
  az redisenterprise show -g "$RG" --cluster-name "$1" --query "[provisioningState, resourceState]" -o tsv 2>/dev/null | tr '\n\t' '  ' || true
}

create() {
  local name="$1" sku="$2" ha="$3" state
  state="$(cluster_state "$name")"
  case "$state" in
    *Failed*)
      echo "!! $name is in a failed state ($state). Delete it and run again:"
      echo "   az redisenterprise delete -g $RG --cluster-name $name --yes"
      exit 1 ;;
    "") ;;
    *) echo "· $name already exists ($state)"; return ;;
  esac
  echo "· creating $name ($sku, high availability $ha)"
  az redisenterprise create -g "$RG" --cluster-name "$name" --sku "$sku" -l "$LOCATION" \
    --public-network-access "$PUBLIC_ACCESS" --minimum-tls-version 1.2 --high-availability "$ha" \
    --no-database --no-wait -o none
}

wait_cluster() {
  local name="$1" state=""
  for _ in $(seq 1 90); do
    state="$(cluster_state "$name")"
    case "$state" in
      *Succeeded*Running*) echo "· $name cluster running"; return ;;
      *Failed*) echo "!! $name failed while provisioning ($state). Delete it and run again:"
                echo "   az redisenterprise delete -g $RG --cluster-name $name --yes"; exit 1 ;;
    esac
    sleep 20
  done
  echo "!! $name is not running after 30 minutes (state: $state)"; exit 1
}

create_database() {
  local name="$1"
  if az redisenterprise database show -g "$RG" --cluster-name "$name" -o none 2>/dev/null; then
    echo "· $name database already exists"
    return
  fi
  echo "· creating the $name database (TLS, port $PORT, allkeys-lru, enterprise clustering)"
  az redisenterprise database create -g "$RG" --cluster-name "$name" \
    --client-protocol Encrypted --clustering-policy EnterpriseCluster --eviction-policy AllKeysLRU \
    --access-keys-auth Enabled --port "$PORT" --no-wait -o none
}

wait_database() {
  local name="$1" state=""
  for _ in $(seq 1 45); do
    state="$(az redisenterprise database show -g "$RG" --cluster-name "$name" --query provisioningState -o tsv 2>/dev/null || true)"
    if [ "$state" = "Succeeded" ]; then echo "· $name ready"; return; fi
    if [ "$state" = "Failed" ]; then echo "!! $name database failed"; exit 1; fi
    sleep 20
  done
  echo "!! $name database is not ready after 15 minutes (state: $state)"; exit 1
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
  wait_cluster "$DEV_CACHE";  create_database "$DEV_CACHE"
  wait_cluster "$PROD_CACHE"; create_database "$PROD_CACHE"
  wait_database "$DEV_CACHE"
  wait_database "$PROD_CACHE"
fi
wire_slot "$DEV_CACHE"  dev
wire_slot "$PROD_CACHE" production
wire_env  "$DEV_CACHE"

echo
echo "Done. Verify hosts only (never the strings):"
echo "  az webapp config appsettings list -g $RG -n $WEBAPP --slot dev --query \"[?name=='REDIS_CONNECTION_STRING'].value\" -o tsv | sed -E 's|.*@([^/?,]+).*|\\1|'"
echo "  az webapp config appsettings list -g $RG -n $WEBAPP --query \"[?name=='REDIS_CONNECTION_STRING'].value\" -o tsv | sed -E 's|.*@([^/?,]+).*|\\1|'"
