#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGINX_LOCAL_SOURCE="$(cd "$(dirname "$0")" && pwd)/nginx.http.conf"
NGINX_DESTINATION="/etc/nginx/sites-available/locarc"
NODE_VERSION="22"
JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"

echo "=============================================="
echo "  LocArc — Full Server Setup"
echo "  Project root: $PROJECT_ROOT"
echo "=============================================="

echo ""
echo "▶ [1/10] Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo ""
echo "▶ [2/10] Installing system dependencies (nginx, curl, git, ufw, python3)..."
sudo apt install -y nginx curl git ufw python3 python3-venv python3-pip unzip

echo ""
echo "▶ [3/10] Configuring UFW firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 8000/tcp
sudo ufw --force enable
echo "   ✓ Firewall active — ports 22, 80, 8000 open"

echo ""
echo "▶ [4/10] Installing Node.js v${NODE_VERSION} and pnpm..."

if ! command -v fnm &>/dev/null; then
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
fi

fnm install "$NODE_VERSION"
fnm use "$NODE_VERSION"
fnm default "$NODE_VERSION"

if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm
fi

if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
fi

echo "   ✓ Node $(node -v)  |  pnpm $(pnpm -v)  |  PM2 $(pm2 -v)"

echo ""
echo "▶ [5/10] Installing uv (Python package manager)..."
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
echo "   ✓ uv $(uv --version)"

echo ""
echo "▶ [6/10] Installing Android SDK (cmdline-tools + build-tools)..."
ANDROID_HOME="$HOME/android-sdk"
export ANDROID_HOME
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
    sudo apt install -y openjdk-17-jdk-headless unzip
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
echo "▶ [7/10] Building mobile APK..."
cd "$PROJECT_ROOT/mobile"
make deploy
echo "   ✓ APK built successfully"

echo ""
echo "▶ [8/10] Setting up Python server (uv venv + sync)..."
cd "$PROJECT_ROOT/server"
uv venv
uv sync
echo "   ✓ Python venv created and dependencies installed"

echo ""
echo "▶ [9/10] Setting up Next.js web app (pnpm install + build)..."
cd "$PROJECT_ROOT/web"
pnpm install
pnpm build
echo "   ✓ Web app built successfully"

echo ""
echo "▶ [10/10] Configuring Nginx..."

if [ ! -f "$NGINX_LOCAL_SOURCE" ]; then
    echo "   ✗ Error: $NGINX_LOCAL_SOURCE not found!"
    exit 1
fi

sudo sed "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" "$NGINX_LOCAL_SOURCE" \
    > /tmp/locarc_nginx.conf
sudo cp /tmp/locarc_nginx.conf "$NGINX_DESTINATION"

sudo ln -sf "$NGINX_DESTINATION" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
echo "   ✓ Nginx configured and restarted"

echo ""
echo "▶ Starting applications with PM2..."
cd "$PROJECT_ROOT"
pm2 start infra/ecosystem.config.cjs
pm2 save

sudo env PATH=$PATH:$(which node | xargs dirname) \
    $(which pm2) startup systemd -u "$USER" --hp "$HOME"

echo ""
echo "=============================================="
echo "Setup Complete!"
echo "=============================================="
echo ""
echo "  Services running:"
echo "    • Next.js  → http://localhost:3000  (proxied on :80)"
echo "    • Python   → http://localhost:8080  (proxied on :8000)"
echo ""
echo "  Useful commands:"
echo "    pm2 status          — view running processes"
echo "    pm2 logs            — view logs"
echo "    pm2 restart all     — restart all services"
echo "    pm2 stop all        — stop all services"
echo ""
echo "  Firewall:"
echo "    sudo ufw status     — view firewall rules"
echo "=============================================="