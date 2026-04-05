#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"

SERVICE_ACCOUNT="github-actions@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

# ============================================================
# 1. Get GCP values (run gcp-setup.sh first)
# ============================================================

echo "=== Fetching GCP values ==="

GCP_WORKLOAD_IDENTITY_PROVIDER=$(gcloud iam workload-identity-pools providers describe github-provider \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --format="value(name)")

echo "GCP_WORKLOAD_IDENTITY_PROVIDER: $GCP_WORKLOAD_IDENTITY_PROVIDER"
echo "GCP_SERVICE_ACCOUNT: $SERVICE_ACCOUNT"

# ============================================================
# 2. Generate webhook secret
# ============================================================

if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET=$(openssl rand -hex 32)
  echo "WEBHOOK_SECRET (generated): $WEBHOOK_SECRET"
else
  echo "WEBHOOK_SECRET (from .env): $WEBHOOK_SECRET"
fi

# ============================================================
# 3. Get Convex values
# ============================================================

echo ""
echo "=== Convex Setup ==="
echo "Go to: https://dashboard.convex.dev"
echo "  1. Open your project"
echo "  2. Go to Settings > Deploy Key — copy it"
echo "  3. Go to Settings > URL — copy the deployment slug (e.g. 'calm-horse-123')"
echo ""
if [ -z "$CONVEX_DEPLOY_KEY" ]; then
  read -p "CONVEX_DEPLOY_KEY: " CONVEX_DEPLOY_KEY
fi
if [ -z "$CONVEX_DEPLOYMENT" ]; then
  read -p "CONVEX_DEPLOYMENT (e.g. calm-horse-123): " CONVEX_DEPLOYMENT
fi
CONVEX_URL="https://${CONVEX_DEPLOYMENT}.convex.cloud"
CONVEX_SITE_URL="https://${CONVEX_DEPLOYMENT}.convex.site"
echo "CONVEX_URL (derived): $CONVEX_URL"
echo "CONVEX_SITE_URL (derived): $CONVEX_SITE_URL"

# ============================================================
# 4. Cloudflare Setup
# ============================================================

echo ""
echo "=== Cloudflare Setup ==="
echo ""
echo "Step 1: Get your Account ID"
echo "  Go to: https://dash.cloudflare.com"
echo "  Click any domain > Overview > right sidebar shows Account ID"
echo ""
echo "Step 2: Create an API Token"
echo "  Go to: https://dash.cloudflare.com/profile/api-tokens"
echo "  Click 'Create Token'"
echo "  Use template: 'Edit Cloudflare Workers' OR create custom with:"
echo "    - Account > Cloudflare Pages > Edit"
echo "    - Account > Account Settings > Read"
echo "  Copy the token"
echo ""
echo "Step 3: Create a Pages project (if not already created)"
echo "  Go to: https://dash.cloudflare.com > Workers & Pages > Create"
echo "  Create a Pages project named '${CLOUDFLARE_PROJECT_NAME}' (or your preferred name)"
echo "  You can skip the initial deploy — CI/CD will handle it"
echo ""
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  read -p "CLOUDFLARE_ACCOUNT_ID: " CLOUDFLARE_ACCOUNT_ID
fi
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  read -p "CLOUDFLARE_API_TOKEN: " CLOUDFLARE_API_TOKEN
fi

# ============================================================
# 5. Set GitHub Secrets
# ============================================================

echo ""
echo "=== Setting GitHub Secrets ==="

gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$GITHUB_REPO" --body "$GCP_WORKLOAD_IDENTITY_PROVIDER"
gh secret set GCP_SERVICE_ACCOUNT --repo "$GITHUB_REPO" --body "$SERVICE_ACCOUNT"
gh secret set CONVEX_DEPLOY_KEY --repo "$GITHUB_REPO" --body "$CONVEX_DEPLOY_KEY"
gh secret set CLOUDFLARE_API_TOKEN --repo "$GITHUB_REPO" --body "$CLOUDFLARE_API_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$GITHUB_REPO" --body "$CLOUDFLARE_ACCOUNT_ID"
gh secret set WEBHOOK_SECRET --repo "$GITHUB_REPO" --body "$WEBHOOK_SECRET"

echo "All secrets set."

# ============================================================
# 6. Set GitHub Variables
# ============================================================

echo ""
echo "=== Setting GitHub Variables ==="

gh variable set GCP_REGION --repo "$GITHUB_REPO" --body "$GCP_REGION"
gh variable set CONVEX_SITE_URL --repo "$GITHUB_REPO" --body "$CONVEX_SITE_URL"
gh variable set CLOUDFLARE_PROJECT_NAME --repo "$GITHUB_REPO" --body "$CLOUDFLARE_PROJECT_NAME"
gh variable set VITE_CONVEX_URL --repo "$GITHUB_REPO" --body "$CONVEX_URL"
gh variable set VITE_CONVEX_SITE_URL --repo "$GITHUB_REPO" --body "$CONVEX_SITE_URL"
gh variable set LOCALIZATION_ALGO --repo "$GITHUB_REPO" --body "$LOCALIZATION_ALGO"
gh variable set PATH_LOSS_EXPONENT --repo "$GITHUB_REPO" --body "$PATH_LOSS_EXPONENT"
gh variable set PT_MIN_DBM --repo "$GITHUB_REPO" --body "$PT_MIN_DBM"
gh variable set PT_MAX_DBM --repo "$GITHUB_REPO" --body "$PT_MAX_DBM"

echo "All variables set."

# ============================================================
# 7. Summary
# ============================================================

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Secrets configured:"
echo "  - GCP_WORKLOAD_IDENTITY_PROVIDER"
echo "  - GCP_SERVICE_ACCOUNT"
echo "  - CONVEX_DEPLOY_KEY"
echo "  - CLOUDFLARE_API_TOKEN"
echo "  - CLOUDFLARE_ACCOUNT_ID"
echo "  - WEBHOOK_SECRET"
echo ""
echo "Variables configured:"
echo "  - GCP_REGION = $GCP_REGION"
echo "  - CONVEX_SITE_URL = $CONVEX_SITE_URL"
echo "  - CLOUDFLARE_PROJECT_NAME = $CLOUDFLARE_PROJECT_NAME"
echo "  - VITE_CONVEX_URL = $CONVEX_URL"
echo "  - VITE_CONVEX_SITE_URL = $CONVEX_SITE_URL"
echo "  - LOCALIZATION_ALGO = $LOCALIZATION_ALGO"
echo "  - PATH_LOSS_EXPONENT = $PATH_LOSS_EXPONENT"
echo "  - PT_MIN_DBM = $PT_MIN_DBM"
echo "  - PT_MAX_DBM = $PT_MAX_DBM"
echo ""
echo "IMPORTANT: Save this WEBHOOK_SECRET in your Convex backend .env too:"
echo "  WEBHOOK_SECRET=$WEBHOOK_SECRET"
echo ""
echo "Push to main to trigger deployments, or run manually from GitHub Actions tab."
