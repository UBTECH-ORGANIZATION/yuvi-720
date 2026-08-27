#!/usr/bin/env bash
# Deploy (or update) the Spark performance workbook into Application Insights.
#
# The workbook lives in this repo rather than only in the portal so that a
# change to it is reviewable, and so that losing the resource group does not
# lose the one view that tells us whether the app is slow.
#
# Usage:  ./infra/monitoring/deploy-workbook.sh [resource-group] [app-insights-name]
set -euo pipefail

RESOURCE_GROUP="${1:-rg-yuvi-720}"
COMPONENT="${2:-appi-yuvi-720}"
DISPLAY_NAME="Spark — performance"
# Stable GUID: re-running this updates the same workbook instead of piling up
# a new copy every time.
WORKBOOK_ID="8f1d1a2c-6f5f-4f2a-9f13-5b6f7c2a91d4"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
definition="$here/spark-performance.workbook.json"

source_id="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query id --output tsv)"
location="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query location --output tsv)"

# serializedData is a *string* field holding the whole workbook, so the
# definition has to be embedded as escaped JSON rather than nested.
body="$(python3 -c '
import json, sys
definition, display_name, source_id, location = sys.argv[1:5]
with open(definition, encoding="utf-8") as handle:
    serialized = json.dumps(json.load(handle), ensure_ascii=False)
print(json.dumps({
    "location": location,
    # "shared" makes it visible to everyone with read access on the resource
    # group, not just to whoever ran this script.
    "kind": "shared",
    "properties": {
        "displayName": display_name,
        "serializedData": serialized,
        "version": "Notebook/1.0",
        "category": "workbook",
        "sourceId": source_id,
    },
}, ensure_ascii=False))
' "$definition" "$DISPLAY_NAME" "$source_id" "$location")"

az resource create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WORKBOOK_ID" \
  --resource-type "microsoft.insights/workbooks" \
  --api-version "2022-04-01" \
  --is-full-object \
  --properties "$body" \
  --output none

echo "Workbook deployed: $DISPLAY_NAME"
echo "Portal: https://portal.azure.com/#@/resource${source_id}/workbooks"
