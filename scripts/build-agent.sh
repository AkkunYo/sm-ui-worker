#!/usr/bin/env bash
# Build the node agent with the controller version from package.json, so
# nodes always report the same version as the Worker that manages them.
# Output: dist-agent/sm-node-linux-{amd64,arm64}
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse --short HEAD)"
if ! git diff --quiet HEAD -- agent || [ -n "$(git ls-files --others --exclude-standard -- agent)" ]; then
  COMMIT="${COMMIT}-dirty"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LDFLAGS="-s -w -X main.Version=${VERSION} -X main.GitCommit=${COMMIT} -X main.BuildTime=${BUILD_TIME}"

mkdir -p dist-agent
for arch in amd64 arm64; do
  (cd agent && CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags="$LDFLAGS" -o "../dist-agent/sm-node-linux-${arch}" .)
  echo "[build-agent] dist-agent/sm-node-linux-${arch} version=${VERSION} commit=${COMMIT}"
done
