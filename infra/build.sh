#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_APK=false

for arg in "$@"; do
    case "$arg" in
        --skip-apk) SKIP_APK=true ;;
    esac
done

echo "=============================================="
echo "  LocArc — Build"
echo "=============================================="

echo ""
echo "▶ [1/3] Syncing Python server dependencies..."
cd "$PROJECT_ROOT/server"
uv sync
echo "   ✓ Python dependencies synced"

echo ""
echo "▶ [2/3] Building Next.js web app..."
cd "$PROJECT_ROOT/web"
pnpm install --frozen-lockfile
pnpm build
echo "   ✓ Web app built"

if [ "$SKIP_APK" = true ]; then
    echo ""
    echo "▶ [3/3] Skipping APK build (--skip-apk)"
else
    echo ""
    echo "▶ [3/3] Building mobile APK..."
    cd "$PROJECT_ROOT/mobile"
    make deploy
    echo "   ✓ APK built"
fi

echo ""
echo "=============================================="
echo "  Build Complete!"
echo "=============================================="
