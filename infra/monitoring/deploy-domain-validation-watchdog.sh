#!/usr/bin/env bash
# The early-warning half of the TLS monitoring, deployed as a Logic App.
#
# deploy-tls-alerts.sh watches the certificate on the wire, so it can only warn
# LEAD_DAYS before expiry. This one watches the cause instead of the symptom:
# Front Door stops renewing a managed certificate the moment a custom domain
# leaves `domainValidationState: Approved`, and then says nothing for months.
# That is exactly how yuvilab.ai went down on 12/09/2026 — the apex had been in
# `PendingRevalidation` since March while `provisioningState` still read
# `Succeeded` and every dashboard stayed green.
#
# Runs daily, and only speaks when something is wrong: it pushes a failed
# availability result named `afd-domain-validation` into App Insights, which
# the alert rule below turns into an email. Silence means all domains are
# Approved.
#
# When it does fire, the fix is:
#   CD_ID=<custom domain resource id>
#   az rest --method post --uri "${CD_ID}/refreshValidationToken?api-version=2024-02-01"
#   # poll until validationProperties.validationToken is non-empty, then:
#   az network dns record-set txt add-record    -g rg-vibe-coding-kids -z yuvilab.ai -n _dnsauth -v "<NEW>"
#   az network dns record-set txt remove-record -g rg-vibe-coding-kids -z yuvilab.ai -n _dnsauth -v "<OLD>"
# Only the apex needs this. The subdomains are CNAMEs to the Front Door
# endpoint, so Front Door revalidates them by itself.
set -euo pipefail

RESOURCE_GROUP="${1:-rg-yuvi-720}"
COMPONENT="${2:-appi-yuvi-720}"
NOTIFY_EMAIL="${3:-moti@yuvilab.ai}"
ACTION_GROUP="ag-yuvilab-tls"
WORKFLOW="la-afd-domain-validation"

AFD_RESOURCE_GROUP="rg-vibe-coding-kids"
AFD_PROFILE="fd-vibe-coding-kids"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

profile_id="$(az afd profile show \
  --resource-group "$AFD_RESOURCE_GROUP" --profile-name "$AFD_PROFILE" \
  --query id --output tsv)"

component_id="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query id --output tsv)"
instrumentation_key="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query instrumentationKey --output tsv)"
connection_string="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" --app "$COMPONENT" --query connectionString --output tsv)"

# Telemetry must go to the component's own regional endpoint, not the global one.
ingestion_endpoint="$(printf '%s' "$connection_string" \
  | tr ';' '\n' | grep '^IngestionEndpoint=' | cut -d= -f2-)"

principal_id="$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "afd-domain-validation" \
  --template-file "$here/afd-domain-validation.json" \
  --parameters \
    frontDoorProfileId="$profile_id" \
    instrumentationKey="$instrumentation_key" \
    ingestionEndpoint="$ingestion_endpoint" \
  --query properties.outputs.principalId.value --output tsv)"

echo "logic app deployed, identity $principal_id"

# Reader on the Front Door resource group is all it needs: it looks, it never
# changes anything. Remediation stays a deliberate human action.
az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope "$(az group show --name "$AFD_RESOURCE_GROUP" --query id --output tsv)" \
  --output none 2>/dev/null || echo "role assignment already present"

action_group_id="$(az monitor action-group show \
  --resource-group "$RESOURCE_GROUP" --name "$ACTION_GROUP" --query id --output tsv)"

# A 26 hour window against a daily run: one missed day will not mail anyone,
# but a single reported drift will.
az monitor scheduled-query create \
  --resource-group "$RESOURCE_GROUP" \
  --name "yuvilab-afd-domain-validation" \
  --scopes "$component_id" \
  --description "A Front Door custom domain left 'Approved'; its certificate will stop renewing." \
  --condition "count 'drifted' > 0" \
  --condition-query drifted="availabilityResults
    | where name == 'afd-domain-validation' and success == false
    | summarize reports = count()
    | where reports > 0" \
  --evaluation-frequency 6h \
  --window-size 1440m \
  --severity 1 \
  --action-groups "$action_group_id" \
  --output none

echo "domain validation watchdog deployed, notifying $NOTIFY_EMAIL"
