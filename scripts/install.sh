#!/usr/bin/env bash
set -e

# SM-UI Worker Node Installer (Systemd Service)
# Copy the ready-made command from the controller panel; it fills in all three
# values, and SM_NODE_VERSION pins the node to the controller's version.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AkkunYo/sm-ui-worker/main/scripts/install.sh | \
#     MASTER_URL="https://sm-ui.your-worker.workers.dev" \
#     NODE_TOKEN="<token>" \
#     SM_NODE_VERSION="v1.14.2-1" \
#     bash

if [ -z "$MASTER_URL" ] || [ -z "$NODE_TOKEN" ] || [ -z "$SM_NODE_VERSION" ]; then
  echo "Error: MASTER_URL, NODE_TOKEN and SM_NODE_VERSION environment variables are required."
  echo "Copy the install command from the controller panel (Nodes -> install)."
  exit 1
fi

# Release tags carry the "v" prefix; accept the version with or without it.
RELEASE_TAG="v${SM_NODE_VERSION#v}"
if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9]+$ ]]; then
  echo "Error: SM_NODE_VERSION \"$SM_NODE_VERSION\" is not a valid version (expected e.g. v1.14.2-1)."
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) GOARCH="amd64" ;;
  aarch64|arm64) GOARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/sm-ui"

mkdir -p "$DATA_DIR/bin" "$DATA_DIR/configs" "$DATA_DIR/certs"

echo "--> Installing sm-node ${RELEASE_TAG} (with embedded sing-box core)..."
if ! curl -fsSL "https://github.com/AkkunYo/sm-ui-worker/releases/download/${RELEASE_TAG}/sm-node-linux-${GOARCH}.tar.gz" -o /tmp/node.tar.gz; then
  echo "Error: release ${RELEASE_TAG} not found. Copy a fresh install command from the controller panel."
  exit 1
fi
tar -xzf /tmp/node.tar.gz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/sm-node"
rm -f /tmp/node.tar.gz

cat <<SERVICE > /etc/systemd/system/sm-node.service
[Unit]
Description=SM-UI Node Agent (SingBox Matrix Worker Edition)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$DATA_DIR
Environment="MASTER_URL=$MASTER_URL"
Environment="NODE_TOKEN=$NODE_TOKEN"
Environment="BASE_DIR=$DATA_DIR"
ExecStart=$INSTALL_DIR/sm-node
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable sm-node
systemctl restart sm-node

echo "=================================================="
echo "  SM-Node Installed and Started Successfully!    "
echo "  Status: systemctl status sm-node               "
echo "  Logs:   journalctl -u sm-node -f               "
echo "=================================================="
