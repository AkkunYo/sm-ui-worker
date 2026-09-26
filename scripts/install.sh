#!/usr/bin/env bash
set -e

# SM-UI Worker Node Installer (Systemd Service)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AkkunYo/sm-ui-worker/main/scripts/install.sh | \
#     MASTER_URL="https://sm-ui.your-worker.workers.dev" \
#     NODE_TOKEN="<uuid>" \
#     bash

if [ -z "$MASTER_URL" ] || [ -z "$NODE_TOKEN" ]; then
  echo "Error: MASTER_URL and NODE_TOKEN environment variables are required."
  echo "Example:"
  echo "  curl -fsSL ... | MASTER_URL=\"https://...\" NODE_TOKEN=\"...\" bash"
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

echo "--> Installing sing-box core (v1.14.2)..."
curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/v1.14.2/sing-box-1.14.2-linux-${GOARCH}.tar.gz" -o /tmp/sb.tar.gz
tar -xzf /tmp/sb.tar.gz -C /tmp
mv /tmp/sing-box-*/sing-box "$INSTALL_DIR/sing-box"
chmod +x "$INSTALL_DIR/sing-box"
ln -sf "$INSTALL_DIR/sing-box" "$DATA_DIR/bin/sing-box"
rm -rf /tmp/sb.tar.gz /tmp/sing-box-*

echo "--> Installing sm-node daemon..."
curl -fsSL "https://github.com/AkkunYo/sm-ui-worker/releases/latest/download/sm-node-linux-${GOARCH}.tar.gz" -o /tmp/node.tar.gz 2>/dev/null || true
if [ -f /tmp/node.tar.gz ]; then
  tar -xzf /tmp/node.tar.gz -C "$INSTALL_DIR"
  chmod +x "$INSTALL_DIR/sm-node"
  rm -f /tmp/node.tar.gz
fi

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
