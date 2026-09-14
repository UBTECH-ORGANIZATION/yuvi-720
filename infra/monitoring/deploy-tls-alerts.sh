#!/usr/bin/env bash
# TLS certificate monitoring for the public yuvilab.ai hostnames.
#
# WHY THIS EXISTS: on 12/09/2026 the managed certificate for the apex domain
# yuvilab.ai expired and the whole site went down. Nothing alerted. The renewal
# had silently stopped six months earlier, because Front Door only auto-rotates
# a managed certificate while the custom domain is in `Approved` state, and the
# apex had drifted to `PendingRevalidation` — a state that never shows up in
# `provisioningState` and produces no signal at all until the day the cert dies.
#
# Two independent nets, because they fail at different times:
#   1. The availability tests below check the cert on the wire and start failing
#      LEAD_DAYS before expiry. This is the safety net.
#   2. deploy-domain-validation-watchdog.sh checks `domainValidationState`
#      directly and would have caught the same incident ~6 months earlier. That
#      is the real early warning; this file guarantees we still find out in time.
#
# Deploy this one first: the watchdog reuses the action group created here.
set -euo pipefail

RESOURCE_GROUP="${1:-rg-yuvi-720}"
COMPONENT="${2:-appi-yuvi-720}"
NOTIFY_EMAIL="${3:-moti@yuvilab.ai}"
ACTION_GROUP="ag-yuvilab-tls"

# Start failing this many days before a certificate expires. Front Door renews
# a managed cert roughly 45 days out, so 30 days means "renewal should already
# have happened and did not" rather than "renewal has not started yet".
LEAD_DAYS=30

# Two European locations is enough to tell a real expiry from one flaky prober,
# and keeps the per-execution cost down. A cert problem is global by nature.
LOCATIONS=(emea-nl-ams-azr emea-gb-db3-azr)

HOSTS=(
  yuvilab.ai
  spark.yuvilab.ai
  teacher.yuvilab.ai
  dev.yuvilab.ai
  dev.spark.yuvilab.ai
  dev.teacher.yuvilab.ai
)

component_id="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query id --output tsv)"
component_location="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query location --output tsv)"

# Action groups for scheduled-query rules must be Global; the resource group's
# default region is rejected.
az monitor action-group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACTION_GROUP" \
  --short-name "YuviTLS" \
  --action email primary "$NOTIFY_EMAIL" \
  --location Global \
  --output none

action_group_id="$(az monitor action-group show \
  --resource-group "$RESOURCE_GROUP" --name "$ACTION_GROUP" --query id --output tsv)"

location_args=()
for loc in "${LOCATIONS[@]}"; do
  location_args+=(--locations Id="$loc")
done

for host in "${HOSTS[@]}"; do
  test_name="tls-${host//./-}"

  # The hidden-link tag is what binds the test to the component; without it the
  # test runs but never appears under the component's Availability blade.
  az monitor app-insights web-test create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$test_name" \
    --location "$component_location" \
    --tags "hidden-link:${component_id}=Resource" \
    --defined-web-test-name "$test_name" \
    --synthetic-monitor-id "$test_name" \
    --web-test-kind standard \
    --request-url "https://${host}/" \
    --http-verb GET \
    --ssl-check true \
    --ssl-lifetime-check "$LEAD_DAYS" \
    --frequency 900 \
    --timeout 60 \
    --retry-enabled true \
    --enabled true \
    "${location_args[@]}" \
    --description "TLS certificate and reachability check for ${host}." \
    --output none

  echo "web test ready: $test_name -> https://${host}/"
done

# One rule for every test. Requiring two failed runs keeps a single prober
# hiccup from mailing anyone, while a real expiry fails every run everywhere.
az monitor scheduled-query create \
  --resource-group "$RESOURCE_GROUP" \
  --name "yuvilab-tls-certificate" \
  --scopes "$component_id" \
  --description "A yuvilab.ai certificate is invalid or expires within ${LEAD_DAYS} days." \
  --condition "count 'failing' > 0" \
  --condition-query failing="availabilityResults
    | where name startswith 'tls-'
    | summarize failed = countif(success == false), runs = count() by name
    | where runs >= 2 and failed >= 2" \
  --evaluation-frequency 1h \
  --window-size 1h \
  --severity 1 \
  --action-groups "$action_group_id" \
  --output none

echo "TLS alerts deployed, notifying $NOTIFY_EMAIL"
