#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNITY_PROJECT="$REPO_ROOT/unity-learning-world"
UNITY_VERSION="6000.0.79f1"

if [[ -n "${UNITY_EDITOR:-}" ]]; then
  EDITOR="$UNITY_EDITOR"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  EDITOR="/Applications/Unity/Hub/Editor/$UNITY_VERSION/Unity.app/Contents/MacOS/Unity"
else
  EDITOR="${UNITY_EDITOR_PATH:-/opt/unity/Editor/Unity}"
fi

if [[ ! -x "$EDITOR" ]]; then
  printf 'Unity editor not found at %s\n' "$EDITOR" >&2
  printf 'Install Unity %s with Web Build Support or set UNITY_EDITOR.\n' "$UNITY_VERSION" >&2
  exit 1
fi

"$EDITOR" \
  -batchmode \
  -nographics \
  -quit \
  -projectPath "$UNITY_PROJECT" \
  -executeMethod Yuvi720.Editor.BuildLearningWorld.BuildWeb \
  -logFile -

for artifact in \
  "$REPO_ROOT/frontend/public/unity-world/Build/unity-world.loader.js" \
  "$REPO_ROOT/frontend/public/unity-world/Build/unity-world.framework.js" \
  "$REPO_ROOT/frontend/public/unity-world/Build/unity-world.data" \
  "$REPO_ROOT/frontend/public/unity-world/Build/unity-world.wasm"; do
  if [[ ! -s "$artifact" ]]; then
    printf 'Missing Unity build artifact: %s\n' "$artifact" >&2
    exit 1
  fi
done

printf 'Unity learning world build is ready in frontend/public/unity-world.\n'
