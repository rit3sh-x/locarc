#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infra"
NGINX_SOURCE="$INFRA_DIR/nginx.http.conf"
NGINX_DESTINATION="/etc/nginx/sites-available/locarc"

echo "=============================================="
echo "  LocArc — Deploy"
echo "=============================================="

echo ""
echo "▶ [1/3] Applying Nginx config..."
if [ ! -f "$NGINX_SOURCE" ]; then
    echo "   ✗ Error: $NGINX_SOURCE not found!"
    exit 1
fi
sudo sed "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" "$NGINX_SOURCE" \
    > /tmp/locarc_nginx.conf
sudo cp /tmp/locarc_nginx.conf "$NGINX_DESTINATION"
sudo ln -sf "$NGINX_DESTINATION" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
echo "   ✓ Nginx configured and restarted"

echo ""
echo "▶ [2/3] Stopping existing PM2 processes..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
echo "   ✓ PM2 processes cleared"

echo ""
echo "▶ [3/3] Starting PM2 processes..."
cd "$PROJECT_ROOT"
pm2 start "$INFRA_DIR/ecosystem.config.cjs"
pm2 save

sudo env PATH=$PATH:$(which node | xargs dirname) \
    $(which pm2) startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true

echo "   ✓ PM2 processes running"

echo ""
echo "=============================================="
echo "  Deploy Complete!"
echo "=============================================="
echo ""
echo "  Services:"
echo "    • Next.js  → http://localhost:3000  (proxied on :80)"
echo "    • Python   → http://localhost:8080  (proxied on :8000)"
echo ""
echo "  Verify:"
echo "    pm2 status"
echo "    pm2 logs"
echo "=============================================="
