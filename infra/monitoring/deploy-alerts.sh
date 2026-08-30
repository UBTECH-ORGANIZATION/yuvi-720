#!/usr/bin/env bash
# Alert rules for Spark performance, scoped to the production slot only.
#
# The workbook answers "is it slow" when you go and look. These rules are what
# tells you on a Tuesday morning, while a class is in the middle of a lesson.
# Dev and english slots are deliberately excluded: a dev deploy must never page
# anyone.
set -euo pipefail

RESOURCE_GROUP="${1:-rg-yuvi-720}"
COMPONENT="${2:-appi-yuvi-720}"
NOTIFY_EMAIL="${3:-moti@yuvilab.ai}"
ACTION_GROUP="ag-spark-perf"

source_id="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query id --output tsv)"

az monitor action-group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACTION_GROUP" \
  --short-name "SparkPerf" \
  --action email primary "$NOTIFY_EMAIL" \
  --location Global \
  --output none

action_group_id="$(az monitor action-group show \
  --resource-group "$RESOURCE_GROUP" --name "$ACTION_GROUP" --query id --output tsv)"

# Latency. p95 rather than average, because an average stays healthy while a
# quarter of a class sits waiting.
az monitor scheduled-query create \
  --resource-group "$RESOURCE_GROUP" \
  --name "spark-prod-slow-requests" \
  --scopes "$source_id" \
  --description "Production p95 request latency above 3s for 15 minutes." \
  --condition "count 'slow' > 0" \
  --condition-query slow="requests
    | where cloud_RoleName startswith 'production.'
    | summarize p95 = percentile(duration, 95), calls = count() by cloud_RoleName
    | where calls >= 20 and p95 > 3000" \
  --evaluation-frequency 15m \
  --window-size 15m \
  --severity 2 \
  --action-groups "$action_group_id" \
  --output none

# Failures. 5% is already a bad lesson for one child in twenty.
az monitor scheduled-query create \
  --resource-group "$RESOURCE_GROUP" \
  --name "spark-prod-failure-rate" \
  --scopes "$source_id" \
  --description "Production request failure rate above 5% for 15 minutes." \
  --condition "count 'failing' > 0" \
  --condition-query failing="requests
    | where cloud_RoleName startswith 'production.'
    | summarize failed = countif(success == false), calls = count() by cloud_RoleName
    | where calls >= 20 and (100.0 * failed / calls) > 5" \
  --evaluation-frequency 15m \
  --window-size 15m \
  --severity 1 \
  --action-groups "$action_group_id" \
  --output none

# Silence is also a failure mode: this is the rule that would have caught
# production running with no connection string at all.
az monitor scheduled-query create \
  --resource-group "$RESOURCE_GROUP" \
  --name "spark-prod-telemetry-silent" \
  --scopes "$source_id" \
  --description "No production telemetry received for an hour during the day." \
  --condition "count 'silent' > 0" \
  --condition-query silent="requests
    | where cloud_RoleName startswith 'production.'
    | summarize calls = count()
    | where calls == 0" \
  --evaluation-frequency 1h \
  --window-size 1h \
  --severity 3 \
  --action-groups "$action_group_id" \
  --output none

echo "Alerts deployed, notifying $NOTIFY_EMAIL"
