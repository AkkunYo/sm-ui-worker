#!/usr/bin/env bash
# Build the self-contained fat binary sm-node embedding sing-box (with_quic,
# with_utls, with_clash_api, with_v2ray_api). The sing-box version comes from
# package.json, whose version is <sing-box version>-<revision> (e.g. 1.14.2-1).
# Output: dist-agent/sm-node-linux-{amd64,arm64}
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9]+$ ]]; then
  echo "[build-agent] package.json version ${VERSION} must be <sing-box version>-<revision>" >&2
  exit 1
fi
SING_BOX_VERSION="${VERSION%%-*}"
COMMIT="$(git rev-parse --short HEAD)"
if ! git diff --quiet HEAD -- agent || [ -n "$(git ls-files --others --exclude-standard -- agent)" ]; then
  COMMIT="${COMMIT}-dirty"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LDFLAGS="-s -w -X main.Version=${VERSION} -X main.GitCommit=${COMMIT} -X main.BuildTime=${BUILD_TIME}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
  printf "\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\xff\x03\x00\x00\x00\x00\x00\x00\x00\x00\x00" > "$ROOT/agent/sing-box.gz"
}
trap cleanup EXIT

echo "--> Cloning sing-box v${SING_BOX_VERSION}..."
git clone --depth 1 --branch "v${SING_BOX_VERSION}" https://github.com/sagernet/sing-box.git "$TMP_DIR/sing-box-src"

mkdir -p dist-agent dist/amd64 dist/arm64

for arch in amd64 arm64; do
  echo "--> Compiling sing-box core for linux/${arch}..."
  (cd "$TMP_DIR/sing-box-src" && CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags="-s -w -buildid= -X 'github.com/sagernet/sing-box/constant.Version=${SING_BOX_VERSION}'" -tags "with_quic,with_utls,with_clash_api,with_v2ray_api" -o "$TMP_DIR/sing-box-${arch}" ./cmd/sing-box)

  echo "--> Embedding sing-box into sm-node for linux/${arch}..."
  gzip -c "$TMP_DIR/sing-box-${arch}" > "$ROOT/agent/sing-box.gz"
  (cd "$ROOT/agent" && CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags="$LDFLAGS" -o "$ROOT/dist-agent/sm-node-linux-${arch}" .)
  cp "$ROOT/dist-agent/sm-node-linux-${arch}" "$ROOT/dist/${arch}/sm-node"

  echo "[build-agent] dist-agent/sm-node-linux-${arch} version=${VERSION} commit=${COMMIT}"
done
