#!/usr/bin/env bash
# One Redis per slot, wired the way the two Cosmos clusters are.
#
#   ./infra/redis/provision.sh            # create both caches, wait, set both slots, update backend/.env
#   ./infra/redis/provision.sh --env-only # skip creation; (re)wire settings and .env from existing caches
#
# Never prints a key. Settings are written straight from `az` output into the
# slot configuration and into backend/.env (local points at DEV, like Mongo).
# Production settings are slot-sticky, so a dev→production swap leaves each
# slot talking to its own cache — the same contract as MONGODB_CONNECTION_STRING.
#
# Two kinds of cache, one switch:
#
#   CACHE_KIND=classic (default)  Azure Cache for Redis, Standard C1 for
#       production (1 GB, replicated, SLA) and Basic C0 for dev (250 MB).
#       Host `<name>.redis.cache.windows.net`, TLS on 6380. This subscription
#       is a sponsorship offer (quotaId Sponsored_2016-01-01) and Azure Managed
#       Redis answered InsufficientCapacity for every size in two regions
#       within seconds — that family has no allocation on this offer. The
#       classic tier already runs here. Retirement of Basic/Standard/Premium
#       is announced for 2028-09-30; the app speaks plain Redis either way,
#       so moving later is this script with CACHE_KIND=managed.
#   CACHE_KIND=managed            Azure Managed Redis, Balanced B1 / B0 (the
#       sizing in docs/architecture/redis-cache-plan.md §3b), TLS on 10000.
#
# Both kinds: allkeys-lru, TLS 1.2 minimum, access-key auth, one endpoint.
# The production guard in app/core/cache.py matches the cache NAME (first
# hostname label), so kind and region are both free to change.
set -euo pipefail

SUBSCRIPTION="${SUBSCRIPTION:-6bec2a17-6e23-437c-8093-6df5688fb1b5}"
RG="${RG:-rg-yuvi-720}"
LOCATION="${LOCATION:-northeurope}"
WEBAPP="${WEBAPP:-ubi-yuvi-720}"
PROD_CACHE="${PROD_CACHE:-redis-yuvi-720}"
DEV_CACHE="${DEV_CACHE:-redis-yuvi-720-dev}"
CACHE_KIND="${CACHE_KIND:-classic}"
# Public endpoint + TLS + key, the same exposure as the two Cosmos clusters today
# (publicNetworkAccess Enabled, no private endpoints). The dev slot has no VNet
# integration, so dev has no other option. Production IS integrated into
# vnet-yuvi-lrs with route-all; when the LRS firewall design allows it, set
# PUBLIC_ACCESS=Disabled and add a private endpoint + privatelink DNS zone for
# the production cache (see the plan, §6).
PUBLIC_ACCESS="${PUBLIC_ACCESS:-Enabled}"
ENV_FILE="$(cd "$(dirname "$0")/../.." && pwd)/backend/.env"
ENV_ONLY="${1:-}"

case "$CACHE_KIND" in
  classic) PORT=6380 ;;
  managed) PORT=10000 ;;
  *) echo "CACHE_KIND must be classic or managed"; exit 2 ;;
esac

az account set -s "$SUBSCRIPTION"
[ "$CACHE_KIND" = managed ] && az extension add --name redisenterprise --upgrade -y >/dev/null 2>&1 || true

# ── the two kinds, behind one vocabulary ─────────────────────────────────────

# "<provisioningState> <resourceState>" or empty when the cache does not exist.
state_of() {
  if [ "$CACHE_KIND" = classic ]; then
    az redis show -g "$RG" -n "$1" --query provisioningState -o tsv 2>/dev/null || true
  else
    az redisenterprise show -g "$RG" --cluster-name "$1" --query "[provisioningState, resourceState]" -o tsv 2>/dev/null | tr '\n\t' '  ' || true
  fi
}

host_of() {
  if [ "$CACHE_KIND" = classic ]; then
    az redis show -g "$RG" -n "$1" --query hostName -o tsv
  else
    az redisenterprise show -g "$RG" --cluster-name "$1" --query hostName -o tsv
  fi
}

# Only ever called inside conn(); never echoed.
key_of() {
  if [ "$CACHE_KIND" = classic ]; then
    az redis list-keys -g "$RG" -n "$1" --query primaryKey -o tsv
  else
    az redisenterprise database list-keys -g "$RG" --cluster-name "$1" --query primaryKey -o tsv
  fi
}

delete_hint() {
  if [ "$CACHE_KIND" = classic ]; then
    echo "   az redis delete -g $RG -n $1 --yes"
  else
    echo "   az redisenterprise delete -g $RG --cluster-name $1 --yes"
  fi
}

# Why a create failed, from the activity log (the resource only says Failed).
failure_reason() {
  local type="Microsoft.Cache/redis"
  [ "$CACHE_KIND" = managed ] && type="Microsoft.Cache/redisEnterprise"
  az monitor activity-log list --resource-id \
    "/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/$type/$1" \
    --offset 6h --query "[?status.value=='Failed'].properties.statusMessage | [0]" -o tsv 2>/dev/null \
    | grep -o '"code":"[A-Za-z]*","message":"[^"]*"' | tail -1 | sed 's/"code":"//; s/","message":"/: /; s/"$//' || true
}

# ── create ───────────────────────────────────────────────────────────────────

# create <name> <role>   role = production | dev
create() {
  local name="$1" role="$2" state
  state="$(state_of "$name")"
  case "$state" in
    *Failed*)
      echo "!! $name is in a failed state: $(failure_reason "$name")"
      echo "   Delete it, then run again:"; delete_hint "$name"; exit 1 ;;
    "") ;;
    *) echo "· $name already exists ($state)"; return ;;
  esac
  if [ "$CACHE_KIND" = classic ]; then
    local sku size cfg
    if [ "$role" = production ]; then sku=Standard; size=c1; else sku=Basic; size=c0; fi
    echo "· creating $name (Azure Cache for Redis $sku $size, $LOCATION)"
    cfg="$(mktemp)"; printf '{"maxmemory-policy":"allkeys-lru"}' > "$cfg"
    az redis create -g "$RG" -n "$name" -l "$LOCATION" --sku "$sku" --vm-size "$size" \
      --minimum-tls-version 1.2 --redis-configuration @"$cfg" --no-wait -o none
    rm -f "$cfg"
  else
    local sku ha
    if [ "$role" = production ]; then sku=Balanced_B1; ha=Enabled; else sku=Balanced_B0; ha=Disabled; fi
    echo "· creating $name (Azure Managed Redis $sku, high availability $ha, $LOCATION)"
    # Cluster first, database second: the one-shot create sends the database
    # PUT before the cluster runs and leaves the cluster CreateFailed.
    az redisenterprise create -g "$RG" --cluster-name "$name" --sku "$sku" -l "$LOCATION" \
      --public-network-access "$PUBLIC_ACCESS" --minimum-tls-version 1.2 --high-availability "$ha" \
      --no-database --no-wait -o none
  fi
}

wait_ready() {
  local name="$1" state=""
  for _ in $(seq 1 120); do
    state="$(state_of "$name")"
    case "$state" in
      Succeeded|*Succeeded*Running*) echo "· $name ready"; return ;;
      *Failed*)
        echo "!! $name failed while provisioning: $(failure_reason "$name")"
        echo "   Delete it, then run again (LOCATION=<region> or CACHE_KIND=<kind> if the reason is capacity):"
        delete_hint "$name"; exit 1 ;;
    esac
    sleep 20
  done
  echo "!! $name is not ready after 40 minutes (state: $state)"; exit 1
}

# Managed only: the database is its own resource under the running cluster.
ensure_database() {
  [ "$CACHE_KIND" = managed ] || return 0
  local name="$1" state=""
  if ! az redisenterprise database show -g "$RG" --cluster-name "$name" -o none 2>/dev/null; then
    echo "· creating the $name database (TLS, port $PORT, allkeys-lru, enterprise clustering)"
    az redisenterprise database create -g "$RG" --cluster-name "$name" \
      --client-protocol Encrypted --clustering-policy EnterpriseCluster --eviction-policy AllKeysLRU \
      --access-keys-auth Enabled --port "$PORT" --no-wait -o none
  fi
  for _ in $(seq 1 45); do
    state="$(az redisenterprise database show -g "$RG" --cluster-name "$name" --query provisioningState -o tsv 2>/dev/null || true)"
    [ "$state" = "Succeeded" ] && { echo "· $name database ready"; return; }
    [ "$state" = "Failed" ] && { echo "!! $name database failed"; exit 1; }
    sleep 20
  done
  echo "!! $name database is not ready after 15 minutes (state: $state)"; exit 1
}

# ── wire ─────────────────────────────────────────────────────────────────────

# rediss://:<key>@<host>:<port>/0 — built in a subshell, passed straight to az, never echoed.
conn() {
  printf 'rediss://:%s@%s:%s/0' "$(key_of "$1")" "$(host_of "$1")" "$PORT"
}

wire_slot() {
  local name="$1" slot="$2" host
  host="$(host_of "$name")"
  if [ "$slot" = "production" ]; then
    az webapp config appsettings set -g "$RG" -n "$WEBAPP" \
      --slot-settings "REDIS_CONNECTION_STRING=$(conn "$name")" "SPARK_CACHE=redis" -o none
  else
    az webapp config appsettings set -g "$RG" -n "$WEBAPP" --slot "$slot" \
      --slot-settings "REDIS_CONNECTION_STRING=$(conn "$name")" "SPARK_CACHE=redis" -o none
  fi
  echo "· slot $slot → $host:$PORT (sticky: REDIS_CONNECTION_STRING, SPARK_CACHE=redis)"
}

wire_env() {
  local name="$1" host
  host="$(host_of "$name")"
  touch "$ENV_FILE"
  if grep -q '^REDIS_CONNECTION_STRING=' "$ENV_FILE"; then
    echo "· backend/.env already has REDIS_CONNECTION_STRING (left as is)"
  else
    { printf '\n# Redis, DEV cache (local points at dev, like the database). See docs/architecture/redis-cache-plan.md\n'
      printf 'REDIS_CONNECTION_STRING=%s\n' "$(conn "$name")"
      printf 'SPARK_CACHE=redis\n'; } >> "$ENV_FILE"
    echo "· backend/.env → $host:$PORT"
  fi
}

# ── run ──────────────────────────────────────────────────────────────────────

if [ "$ENV_ONLY" != "--env-only" ]; then
  create "$DEV_CACHE"  dev
  create "$PROD_CACHE" production
  wait_ready "$DEV_CACHE";  ensure_database "$DEV_CACHE"
  wait_ready "$PROD_CACHE"; ensure_database "$PROD_CACHE"
fi
wire_slot "$DEV_CACHE"  dev
wire_slot "$PROD_CACHE" production
wire_env  "$DEV_CACHE"

echo
echo "Done. Verify hosts only (never the strings):"
echo "  az webapp config appsettings list -g $RG -n $WEBAPP --slot dev --query \"[?name=='REDIS_CONNECTION_STRING'].value\" -o tsv | sed -E 's|.*@([^/?,]+).*|\\1|'"
echo "  az webapp config appsettings list -g $RG -n $WEBAPP --query \"[?name=='REDIS_CONNECTION_STRING'].value\" -o tsv | sed -E 's|.*@([^/?,]+).*|\\1|'"
