using './main.bicep'

param env = 'dev'
param image = 'yuvi720acr.azurecr.io/game-gen:dev'
param logAnalyticsWorkspaceId = '/subscriptions/6bec2a17-6e23-437c-8093-6df5688fb1b5/resourceGroups/rg-yuvi-720/providers/Microsoft.OperationalInsights/workspaces/law-yuvi-720'
param maxReplicas = 2
param minReplicas = 1  // warm while the bake-off runs; back to 0 afterwards
param sparkEnvironment = 'dev'

// Secrets come from the CLI (never from this file):
//   -p copilotGithubToken=... mongoConnectionString=... redisConnectionString=... appServicePrincipalId=...
param copilotGithubToken = ''
param mongoConnectionString = ''
