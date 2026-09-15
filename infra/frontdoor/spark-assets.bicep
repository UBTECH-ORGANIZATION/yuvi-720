// Front Door edge caching for the Spark SPA's hashed assets.
//
// The profile (fd-vibe-coding-kids) is shared with other products and is NOT
// owned by this file: it, the endpoints, origin groups and custom domains are
// referenced as `existing`. This file owns exactly two things —
//   * the SparkAssetRules rule set, attached to the /assets/* routes only, and
//   * the /assets/* route on each Spark endpoint.
// The shared `CacheRules` rule set (also attached to yuvilab-prod) stays as
// it is; that one overrides Cache-Control to 30 days, which is why the wire
// used to say max-age=2592000 instead of the origin's 1-year `immutable`.
// Assets are content-hashed (Vite), so honoring the origin header is safe:
// a deploy is a new URL, never a stale hit.
//
// Apply (one-time, by hand — see README.md):
//   az deployment group create -g rg-vibe-coding-kids \
//     --subscription cotrade-ai-prod-credits -f spark-assets.bicep
targetScope = 'resourceGroup'

@description('The shared Front Door profile.')
param profileName string = 'fd-vibe-coding-kids'

@description('One entry per Spark endpoint: the endpoint, the origin group it forwards to, and the custom domain bound to it.')
param endpoints array = [
  { name: 'spark', originGroup: 'og-spark-webapp', customDomain: 'spark-yuvilab-ai' }
  { name: 'spark-dev', originGroup: 'og-spark-dev-webapp', customDomain: 'dev-spark-yuvilab-ai' }
]

// Text the edge should compress. The origin gzips too (GZipMiddleware), but a
// cache hit is served from here, so this list is what the browser actually
// gets. wasm (RDKit, 6.9 MB) and the KaTeX fonts were missing.
var compressibleTypes = [
  'application/javascript'
  'text/javascript'
  'text/css'
  'application/json'
  'image/svg+xml'
  'application/wasm'
  'font/woff2'
  'application/font-woff2'
  'font/woff'
  'font/ttf'
]

resource profile 'Microsoft.Cdn/profiles@2024-02-01' existing = {
  name: profileName
}

resource ruleSet 'Microsoft.Cdn/profiles/ruleSets@2024-02-01' = {
  parent: profile
  name: 'SparkAssetRules'
}

// /assets/*: cache, ignore the query string, compress, and let the origin's
// Cache-Control (public, max-age=31536000, immutable) reach the browser.
resource hashedAssets 'Microsoft.Cdn/profiles/ruleSets/rules@2024-02-01' = {
  parent: ruleSet
  name: 'HashedAssetsHonorOrigin'
  properties: {
    order: 1
    matchProcessingBehavior: 'Continue'
    conditions: [
      {
        name: 'UrlPath'
        parameters: {
          typeName: 'DeliveryRuleUrlPathMatchConditionParameters'
          operator: 'BeginsWith'
          matchValues: [ '/assets/' ]
          negateCondition: false
          transforms: []
        }
      }
    ]
    actions: [
      {
        name: 'RouteConfigurationOverride'
        parameters: {
          typeName: 'DeliveryRuleRouteConfigurationOverrideActionParameters'
          cacheConfiguration: {
            cacheBehavior: 'HonorOrigin'
            isCompressionEnabled: 'Enabled'
            queryStringCachingBehavior: 'IgnoreQueryString'
          }
        }
      }
    ]
  }
}

// Images, fonts and media under /assets/ carry the same hashed names, so the
// origin header applies to them too; this rule only exists so a stable-name
// file that slips onto the route (none today) is still capped at a week.
resource mediaAssets 'Microsoft.Cdn/profiles/ruleSets/rules@2024-02-01' = {
  parent: ruleSet
  name: 'MediaFallbackWeek'
  properties: {
    order: 2
    matchProcessingBehavior: 'Continue'
    conditions: [
      {
        name: 'UrlFileExtension'
        parameters: {
          typeName: 'DeliveryRuleUrlFileExtensionMatchConditionParameters'
          operator: 'Equal'
          matchValues: [ 'webp', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'mp4', 'mp3', 'woff2', 'woff', 'ttf' ]
          negateCondition: false
          transforms: [ 'Lowercase' ]
        }
      }
    ]
    actions: [
      {
        name: 'RouteConfigurationOverride'
        parameters: {
          typeName: 'DeliveryRuleRouteConfigurationOverrideActionParameters'
          cacheConfiguration: {
            cacheBehavior: 'OverrideIfOriginMissing'
            cacheDuration: '7.00:00:00'
            isCompressionEnabled: 'Enabled'
            queryStringCachingBehavior: 'IgnoreQueryString'
          }
        }
      }
    ]
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' existing = [for e in endpoints: {
  parent: profile
  name: e.name
}]

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' existing = [for e in endpoints: {
  parent: profile
  name: e.originGroup
}]

resource customDomain 'Microsoft.Cdn/profiles/customDomains@2024-02-01' existing = [for e in endpoints: {
  parent: profile
  name: e.customDomain
}]

// The /assets/* route, as it exists today, with the rule set swapped and the
// compression list widened. route-default (HTML, /api) is deliberately not
// here: it must stay uncached.
resource assetsRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = [for (e, i) in endpoints: {
  parent: endpoint[i]
  name: 'route-assets'
  properties: {
    originGroup: { id: originGroup[i].id }
    customDomains: [ { id: customDomain[i].id } ]
    ruleSets: [ { id: ruleSet.id } ]
    patternsToMatch: [ '/assets/*' ]
    supportedProtocols: [ 'Http', 'Https' ]
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
    enabledState: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: compressibleTypes
      }
    }
  }
  dependsOn: [ hashedAssets, mediaAssets ]
}]

output ruleSetId string = ruleSet.id
