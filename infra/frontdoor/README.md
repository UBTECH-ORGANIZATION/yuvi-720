# Front Door: Spark asset caching

`spark.yuvilab.ai` and `dev.spark.yuvilab.ai` are fronted by the shared Azure
Front Door profile **fd-vibe-coding-kids** (resource group
`rg-vibe-coding-kids`, subscription `cotrade-ai-prod-credits`), not by
anything in `rg-yuvi-720`. That profile also serves other products, so this
folder owns only the Spark `/assets/*` routes and their rule set.

## What the edge does for Spark

| Path | Route | Cached | Notes |
|---|---|---|---|
| `/assets/*` | `route-assets` | yes, query string ignored, Brotli | Vite content-hashed files; origin says `max-age=31536000, immutable` |
| everything else | `route-default` | **no** (`x-cache: CONFIG_NOCACHE`) | HTML shell, `/api`, SSE — must stay uncached |

What the CDN buys: one origin round trip and TLS slow start per asset on a
cold load at each PoP, and origin CPU. Nothing on warm loads (the browser's
own immutable cache already answers), nothing for `/api`, nothing for GPU
frame time. It is a tidy, not a step change.

## Apply

One-time, by hand, from a login that can see the profile's subscription:

```bash
cd infra/frontdoor
az bicep build --file spark-assets.bicep            # compiles locally, no cloud call
az deployment group what-if -g rg-vibe-coding-kids \
  --subscription cotrade-ai-prod-credits -f spark-assets.bicep
az deployment group create -g rg-vibe-coding-kids \
  --subscription cotrade-ai-prod-credits -f spark-assets.bicep
```

Then:

```bash
./verify-assets-cache.sh https://dev.spark.yuvilab.ai
./verify-assets-cache.sh https://spark.yuvilab.ai
```

The script fetches the current `index-*.js` twice and asserts Brotli, an
`immutable` Cache-Control, a `TCP_HIT` on the second request, and that the
HTML shell is still `CONFIG_NOCACHE`.

## Why a new rule set instead of editing `CacheRules`

`CacheRules` is attached to the Spark routes *and* to `yuvilab-prod`'s
default route. Its first rule overrides `/assets/` caching to 30 days for
everyone, which is what turned the origin's 1-year `immutable` into
`max-age=2592000` on the wire. `SparkAssetRules` honors the origin header
instead and is attached to the two Spark asset routes only; `CacheRules`
is left exactly as it was.

## Never purge as a habit

Every deploy produces new hashed URLs, so there is nothing stale to purge.
Purge `/assets/*` only after a mistaken non-hashed file was served.
