#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"

: "${GITHUB_REPO:?GITHUB_REPO missing}"
: "${HF_TOKEN:?HF_TOKEN missing}"
: "${HF_USERNAME:?HF_USERNAME missing}"
: "${HF_SPACE_NAME:?HF_SPACE_NAME missing}"

# ============================================================
# 1. Webhook secret
# ============================================================

if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET=$(openssl rand -hex 32)
  echo "WEBHOOK_SECRET (generated): $WEBHOOK_SECRET"
else
  echo "WEBHOOK_SECRET (from .env): $WEBHOOK_SECRET"
fi

# ============================================================
# 2. Convex values
# ============================================================

echo ""
echo "=== Convex Setup ==="
if [ -z "$CONVEX_DEPLOY_KEY" ]; then
  echo "Go to: https://dashboard.convex.dev"
  echo "  1. Open your project"
  echo "  2. Settings > Deploy Key — copy it"
  read -p "CONVEX_DEPLOY_KEY: " CONVEX_DEPLOY_KEY
fi
if [ -z "$CONVEX_DEPLOYMENT" ]; then
  read -p "CONVEX_DEPLOYMENT (e.g. fine-hare-377.eu-west-1): " CONVEX_DEPLOYMENT
fi

CONVEX_SLUG="${CONVEX_DEPLOYMENT%%.*}"
CONVEX_REGION="${CONVEX_DEPLOYMENT#*.}"
if [ "$CONVEX_REGION" = "$CONVEX_DEPLOYMENT" ]; then
  CONVEX_URL="https://${CONVEX_SLUG}.convex.cloud"
  CONVEX_SITE_URL="https://${CONVEX_SLUG}.convex.site"
else
  CONVEX_URL="https://${CONVEX_SLUG}.${CONVEX_REGION}.convex.cloud"
  CONVEX_SITE_URL="https://${CONVEX_SLUG}.${CONVEX_REGION}.convex.site"
fi
echo "CONVEX_URL (derived): $CONVEX_URL"
echo "CONVEX_SITE_URL (derived): $CONVEX_SITE_URL"

# ============================================================
# 3. Cloudflare (frontend — unchanged)
# ============================================================

echo ""
echo "=== Cloudflare Setup ==="
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  read -p "CLOUDFLARE_ACCOUNT_ID: " CLOUDFLARE_ACCOUNT_ID
fi
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  read -p "CLOUDFLARE_API_TOKEN: " CLOUDFLARE_API_TOKEN
fi

# ============================================================
# 4. GitHub Secrets
# ============================================================

echo ""
echo "=== Setting GitHub Secrets ==="

gh secret set HF_TOKEN            --repo "$GITHUB_REPO" --body "$HF_TOKEN"
gh secret set CONVEX_DEPLOY_KEY   --repo "$GITHUB_REPO" --body "$CONVEX_DEPLOY_KEY"
gh secret set CLOUDFLARE_API_TOKEN --repo "$GITHUB_REPO" --body "$CLOUDFLARE_API_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$GITHUB_REPO" --body "$CLOUDFLARE_ACCOUNT_ID"
gh secret set WEBHOOK_SECRET      --repo "$GITHUB_REPO" --body "$WEBHOOK_SECRET"

echo "All secrets set."

# ============================================================
# 5. GitHub Variables
# ============================================================

echo ""
echo "=== Setting GitHub Variables ==="

gh variable set HF_USERNAME            --repo "$GITHUB_REPO" --body "$HF_USERNAME"
gh variable set HF_SPACE_NAME          --repo "$GITHUB_REPO" --body "$HF_SPACE_NAME"
gh variable set CONVEX_SITE_URL        --repo "$GITHUB_REPO" --body "$CONVEX_SITE_URL"
gh variable set CLOUDFLARE_PROJECT_NAME --repo "$GITHUB_REPO" --body "$CLOUDFLARE_PROJECT_NAME"
gh variable set VITE_CONVEX_URL        --repo "$GITHUB_REPO" --body "$CONVEX_URL"
gh variable set VITE_CONVEX_SITE_URL   --repo "$GITHUB_REPO" --body "$CONVEX_SITE_URL"
gh variable set LOCALIZATION_ALGO      --repo "$GITHUB_REPO" --body "$LOCALIZATION_ALGO"
gh variable set PATH_LOSS_EXPONENT     --repo "$GITHUB_REPO" --body "$PATH_LOSS_EXPONENT"
gh variable set PT_MIN_DBM             --repo "$GITHUB_REPO" --body "$PT_MIN_DBM"
gh variable set PT_MAX_DBM             --repo "$GITHUB_REPO" --body "$PT_MAX_DBM"

echo "All variables set."

# ============================================================
# 6. Convex env vars (server needs these to call the Space)
# ============================================================

echo ""
echo "=== Setting Convex Env Vars ==="

COMPUTE_SERVICE_URL="https://${HF_USERNAME,,}-${HF_SPACE_NAME,,}.hf.space/compute"
echo "COMPUTE_SERVICE_URL: $COMPUTE_SERVICE_URL"

pushd "$SCRIPT_DIR/../backend" >/dev/null
npx --yes convex env set COMPUTE_SERVICE_URL "$COMPUTE_SERVICE_URL" --deploy-key "$CONVEX_DEPLOY_KEY"
npx --yes convex env set WEBHOOK_SECRET     "$WEBHOOK_SECRET"     --deploy-key "$CONVEX_DEPLOY_KEY"
npx --yes convex env set CONVEX_SITE_URL    "$CONVEX_SITE_URL"    --deploy-key "$CONVEX_DEPLOY_KEY"
popd >/dev/null

echo "Convex env vars set."

# ============================================================
# 6. Summary
# ============================================================

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Secrets:"
echo "  HF_TOKEN, CONVEX_DEPLOY_KEY, CLOUDFLARE_API_TOKEN,"
echo "  CLOUDFLARE_ACCOUNT_ID, WEBHOOK_SECRET"
echo ""
echo "Variables:"
echo "  HF_USERNAME = $HF_USERNAME"
echo "  HF_SPACE_NAME = $HF_SPACE_NAME"
echo "  CONVEX_SITE_URL = $CONVEX_SITE_URL"
echo "  CLOUDFLARE_PROJECT_NAME = $CLOUDFLARE_PROJECT_NAME"
echo "  VITE_CONVEX_URL = $CONVEX_URL"
echo "  VITE_CONVEX_SITE_URL = $CONVEX_SITE_URL"
echo "  LOCALIZATION_ALGO = $LOCALIZATION_ALGO"
echo "  PATH_LOSS_EXPONENT = $PATH_LOSS_EXPONENT"
echo "  PT_MIN_DBM = $PT_MIN_DBM"
echo "  PT_MAX_DBM = $PT_MAX_DBM"
echo ""
echo "IMPORTANT: Save WEBHOOK_SECRET in your Convex backend env too:"
echo "  WEBHOOK_SECRET=$WEBHOOK_SECRET"
echo ""
echo "Server: https://huggingface.co/spaces/${HF_USERNAME}/${HF_SPACE_NAME}"
echo "Push to main to trigger deployments, or run manually from GitHub Actions tab."
