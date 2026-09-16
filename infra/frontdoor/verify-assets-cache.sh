#!/usr/bin/env bash
# Prove the edge is doing its job for the hashed assets of a Spark host.
#   ./verify-assets-cache.sh https://dev.spark.yuvilab.ai
#   ./verify-assets-cache.sh https://spark.yuvilab.ai
# Exits non-zero on the first failed expectation. Safe to run any time: it
# only sends GET/HEAD requests.
set -euo pipefail
host="${1:-https://spark.yuvilab.ai}"

asset="$(curl -fsS "$host/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
[[ -n "$asset" ]] || { echo "❌ no hashed index chunk found in $host/"; exit 1; }
url="$host/$asset"
echo "asset: $url"

headers() { curl -fsSI -H 'Accept-Encoding: br, gzip' "$url" | tr -d '\r' | tr '[:upper:]' '[:lower:]'; }

first="$(headers)"
grep -q '^content-encoding: br' <<<"$first" || { echo "❌ not Brotli-compressed at the edge"; echo "$first"; exit 1; }
grep -q '^cache-control:.*immutable' <<<"$first" || { echo "❌ Cache-Control lost 'immutable' (a rule set is still overriding it)"; grep '^cache-control' <<<"$first"; exit 1; }
echo "✔ brotli, immutable header preserved"

# Same PoP twice: the second must be a hit. A miss on both means the route is
# not caching (or a rule set disabled it).
second="$(headers)"
grep -qE '^x-cache: tcp_hit' <<<"$second" || { echo "❌ second request was not a cache hit:"; grep '^x-cache' <<<"$second" || true; exit 1; }
echo "✔ edge cache hit on the second request"

html="$(curl -fsSI "$host/" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
grep -q '^x-cache: config_nocache' <<<"$html" || { echo "❌ the HTML shell is being cached — route-default must stay uncached"; grep '^x-cache' <<<"$html" || true; exit 1; }
echo "✔ HTML shell uncached"
echo "✅ $host assets are cached, compressed and immutable at the edge"
