#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="22"
JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"

echo "=============================================="
echo "  LocArc — First-Time Server Setup"
echo "  Project root: $PROJECT_ROOT"
echo "=============================================="

echo ""
echo "▶ [1/6] Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo ""
echo "▶ [2/6] Installing system dependencies..."
sudo apt install -y nginx curl git ufw python3 python3-venv python3-pip unzip openjdk-17-jdk-headless

echo ""
echo "▶ [3/6] Configuring UFW firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 8000/tcp
sudo ufw --force enable
echo "   ✓ Firewall active — ports 22, 80, 8000 open"

echo ""
echo "▶ [4/6] Installing Node.js v${NODE_VERSION}, pnpm, pm2..."

if ! command -v fnm &>/dev/null; then
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
fi

fnm install "$NODE_VERSION"
fnm use "$NODE_VERSION"
fnm default "$NODE_VERSION"

command -v pnpm &>/dev/null || npm install -g pnpm
command -v pm2  &>/dev/null || npm install -g pm2

echo "   ✓ Node $(node -v)  |  pnpm $(pnpm -v)  |  PM2 $(pm2 -v)"

echo ""
echo "▶ [5/6] Installing uv (Python package manager)..."
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
echo "   ✓ uv $(uv --version)"

echo ""
echo "▶ [6/6] Installing Android SDK..."
ANDROID_HOME="$HOME/android-sdk"
export ANDROID_HOME
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    CMDTOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    curl -fsSL "$CMDTOOLS_URL" -o /tmp/cmdtools.zip
    unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools
    mv /tmp/cmdtools/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
    rm -rf /tmp/cmdtools /tmp/cmdtools.zip
fi

yes | sdkmanager --licenses > /dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"

export JAVA_HOME="$JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

grep -qxF "export ANDROID_HOME=$ANDROID_HOME" "$HOME/.bashrc" || \
    echo "export ANDROID_HOME=$ANDROID_HOME" >> "$HOME/.bashrc"
grep -qxF "export JAVA_HOME=$JAVA_HOME" "$HOME/.bashrc" || \
    echo "export JAVA_HOME=$JAVA_HOME" >> "$HOME/.bashrc"
grep -qxF 'export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH' "$HOME/.bashrc" || \
    echo 'export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH' >> "$HOME/.bashrc"

echo "   ✓ Android SDK ready — $(sdkmanager --version)"

echo ""
echo "=============================================="
echo "  Setup Complete!"
echo "=============================================="
echo ""
echo "  Next steps:"
echo "    bash infra/build.sh     — build all apps"
echo "    bash infra/deploy.sh    — apply nginx + start PM2"
echo ""
echo "  Or do both at once:"
echo "    bash infra/rebuild.sh"
echo "=============================================="