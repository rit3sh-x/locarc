#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infra"

echo "=============================================="
echo "  LocArc — Full Rebuild & Redeploy"
echo "=============================================="

echo ""
echo "▶ [1/4] Stopping PM2 processes..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
echo "   ✓ PM2 stopped"

echo ""
echo "▶ [2/4] Pulling latest code..."
cd "$PROJECT_ROOT"
git pull --ff-only || {
    echo "   ⚠ git pull failed (merge conflict?), continuing with local code..."
}
echo "   ✓ Code updated"

echo ""
echo "▶ [3/4] Building..."
bash "$INFRA_DIR/build.sh" "$@"

echo ""
echo "▶ [4/4] Deploying..."
bash "$INFRA_DIR/deploy.sh"