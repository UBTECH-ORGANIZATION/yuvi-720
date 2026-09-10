// Learning Game Lab worker — Azure Container App scaled by KEDA from a Service Bus queue.
// One deployment per environment (dev.bicepparam / prod.bicepparam). Shared resources
// (namespace, Container Apps environment) are declared identically in both and are
// idempotent. See docs/design/learning-game-lab.md §2.3–2.4 and ADO #548.
//
//   az deployment group create -g rg-yuvi-720 -f infra/game-gen/main.bicep \
//     -p infra/game-gen/dev.bicepparam -p copilotGithubToken=... mongoConnectionString=... redisConnectionString=...

targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param env string
param location string = 'northeurope'
param image string
@description('Log Analytics workspace resource id (law-yuvi-720).')
param logAnalyticsWorkspaceId string
param storageAccountName string = 'yuvi720blobstorage'
param serviceBusNamespaceName string = 'sb-yuvi-720'
param containerAppsEnvName string = 'cae-yuvi-720'
param acrName string = 'yuvi720acr'
@description('Principal id of the App Service (or slot) that enqueues jobs — gets Service Bus Data Sender + Blob Data Contributor.')
param appServicePrincipalId string = ''
param maxReplicas int = env == 'prod' ? 10 : 2
@description('Replicas kept warm. 1 removes the 30-60 s cold start (image pull + Chromium + Copilot runtime) at ~1 vCPU/2 GiB of idle spend; KEDA still scales above it per queued job.')
param minReplicas int = env == 'prod' ? 1 : 0
param mongoDatabase string = 'yuvi720'
param sparkEnvironment string = env == 'prod' ? 'production' : 'dev'
param maxAiCredits string = '300'
param copilotModel string = 'claude-opus-5'

@secure()
param copilotGithubToken string
@secure()
param mongoConnectionString string
@secure()
param redisConnectionString string = ''
@secure()
param apimSubscriptionKey string = ''
param apimBaseUrl string = ''

var queueName = 'game-jobs-${env}'
var blobContainerName = 'games-${env}'
var appName = 'ca-game-gen-${env}'

// ── Existing shared resources ────────────────────────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
}

// ── Service Bus (shared namespace, one queue per environment) ───────────────
resource sb 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: serviceBusNamespaceName
  location: location
  sku: { name: 'Standard', tier: 'Standard' }
  properties: { minimumTlsVersion: '1.2', disableLocalAuth: false }
}
resource queue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: sb
  name: queueName
  properties: {
    requiresSession: true            // sessionId = game_id → edits never interleave
    maxDeliveryCount: 3              // LLM jobs are expensive to retry
    lockDuration: 'PT5M'
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P1D'
    enablePartitioning: false
  }
}

// ── Blob container for game HTML + thumbnails ───────────────────────────────
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}
resource games 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
  properties: { publicAccess: 'None' }
}

// ── Worker identity (user-assigned so its roles exist BEFORE the first revision pulls) ──
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-game-gen-${env}'
  location: location
}

// ── Container Apps environment (shared) ─────────────────────────────────────
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(logAnalyticsWorkspaceId, '/'))
  scope: resourceGroup(split(logAnalyticsWorkspaceId, '/')[2], split(logAnalyticsWorkspaceId, '/')[4])
}
resource cae 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: containerAppsEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

// ── The worker ──────────────────────────────────────────────────────────────
resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: appName
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${uami.id}': {} } }
  dependsOn: [uamiAcrPull, uamiSbReceive, uamiBlob]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        { server: acr.properties.loginServer, identity: uami.id }
      ]
      secrets: concat([
        { name: 'copilot-github-token', value: copilotGithubToken }
        { name: 'mongodb-connection-string', value: mongoConnectionString }
      ], empty(redisConnectionString) ? [] : [
        { name: 'redis-connection-string', value: redisConnectionString }
      ], empty(apimSubscriptionKey) ? [] : [
        { name: 'apim-subscription-key', value: apimSubscriptionKey }
      ])
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: image
          command: ['python', '-m', 'game_gen.worker']
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: concat([
            { name: 'GAME_JOBS_MODE', value: 'servicebus' }
            { name: 'GAME_JOBS_QUEUE', value: queueName }
            { name: 'GAME_JOBS_SERVICEBUS_NAMESPACE', value: '${sb.name}.servicebus.windows.net' }
            { name: 'GAME_JOBS_MAX_DELIVERY', value: '3' }
            { name: 'GAMES_STORAGE', value: 'blob' }
            { name: 'GAMES_BLOB_CONTAINER', value: blobContainerName }
            { name: 'GAMES_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
            { name: 'MONGODB_DATABASE', value: mongoDatabase }
            { name: 'SPARK_ENVIRONMENT', value: sparkEnvironment }
            { name: 'SPARK_ALLOW_PRODUCTION_DB', value: env == 'prod' ? '1' : '' }
            { name: 'COPILOT_MODEL', value: copilotModel }
            { name: 'COPILOT_LOG_LEVEL', value: 'warning' }
            { name: 'GAME_MAX_AI_CREDITS', value: maxAiCredits }
            { name: 'GAME_SPARKS_PER_USD', value: '100' }
            { name: 'GAME_WORKER_LOG_LEVEL', value: 'INFO' }
            { name: 'APIM_BASE_URL', value: apimBaseUrl }
            { name: 'APIM_API_VERSION', value: '2024-10-21' }
            { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
            { name: 'PYTHONPATH', value: '/app/workers:/app/backend' }
            { name: 'PLAYWRIGHT_BROWSERS_PATH', value: '/ms-playwright' }
            { name: 'COPILOT_GITHUB_TOKEN', secretRef: 'copilot-github-token' }
            { name: 'MONGODB_CONNECTION_STRING', secretRef: 'mongodb-connection-string' }
          ], empty(redisConnectionString) ? [] : [
            { name: 'REDIS_CONNECTION_STRING', secretRef: 'redis-connection-string' }
          ], empty(apimSubscriptionKey) ? [] : [
            { name: 'APIM_SUBSCRIPTION_KEY', secretRef: 'apim-subscription-key' }
          ])
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'sb-game-jobs'
            custom: {
              type: 'azure-servicebus'
              identity: uami.id
              metadata: {
                queueName: queueName
                namespace: sb.name
                messageCount: '1'           // one build per replica
                activationMessageCount: '0' // only matters when minReplicas is 0
              }
            }
          }
        ]
      }
    }
  }
}

// ── Role assignments ────────────────────────────────────────────────────────
var roleAcrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var roleSbReceiver = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0')
var roleSbSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
var roleBlobContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource uamiAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, 'acrpull')
  scope: acr
  properties: { roleDefinitionId: roleAcrPull, principalId: uami.properties.principalId, principalType: 'ServicePrincipal' }
}
resource uamiSbReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(queue.id, uami.id, 'sb-receiver')
  scope: queue
  properties: { roleDefinitionId: roleSbReceiver, principalId: uami.properties.principalId, principalType: 'ServicePrincipal' }
}
resource uamiBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, uami.id, 'blob-contrib')
  scope: storage
  properties: { roleDefinitionId: roleBlobContributor, principalId: uami.properties.principalId, principalType: 'ServicePrincipal' }
}
resource webSbSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(appServicePrincipalId)) {
  name: guid(queue.id, appServicePrincipalId, 'sb-sender')
  scope: queue
  properties: { roleDefinitionId: roleSbSender, principalId: appServicePrincipalId, principalType: 'ServicePrincipal' }
}
resource webBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(appServicePrincipalId)) {
  name: guid(storage.id, appServicePrincipalId, 'blob-contrib')
  scope: storage
  properties: { roleDefinitionId: roleBlobContributor, principalId: appServicePrincipalId, principalType: 'ServicePrincipal' }
}

output appName string = app.name
output appPrincipalId string = uami.properties.principalId
output queueName string = queue.name
output serviceBusNamespace string = '${sb.name}.servicebus.windows.net'
output blobContainer string = games.name
