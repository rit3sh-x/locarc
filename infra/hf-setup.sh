#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"

: "${HF_TOKEN:?HF_TOKEN missing in infra/.env}"
: "${HF_USERNAME:?HF_USERNAME missing in infra/.env}"
: "${HF_SPACE_NAME:?HF_SPACE_NAME missing in infra/.env}"

REPO_ID="${HF_USERNAME}/${HF_SPACE_NAME}"
echo "=== Hugging Face Space setup ==="
echo "Target: $REPO_ID"

# Derive CONVEX_SITE_URL from CONVEX_DEPLOYMENT if not already exported.
if [ -z "$CONVEX_SITE_URL" ] && [ -n "$CONVEX_DEPLOYMENT" ]; then
  CONVEX_SLUG="${CONVEX_DEPLOYMENT%%.*}"
  CONVEX_REGION="${CONVEX_DEPLOYMENT#*.}"
  if [ "$CONVEX_REGION" = "$CONVEX_DEPLOYMENT" ]; then
    CONVEX_SITE_URL="https://${CONVEX_SLUG}.convex.site"
  else
    CONVEX_SITE_URL="https://${CONVEX_SLUG}.${CONVEX_REGION}.convex.site"
  fi
  export CONVEX_SITE_URL
  echo "CONVEX_SITE_URL (derived): $CONVEX_SITE_URL"
fi

# Install huggingface_hub in user site-packages if missing.
if ! python -c "import huggingface_hub" 2>/dev/null; then
  echo "Installing huggingface_hub ..."
  pip install --quiet --user "huggingface_hub>=0.26"
fi

HF_TOKEN="$HF_TOKEN" \
REPO_ID="$REPO_ID" \
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}" \
CONVEX_SITE_URL="${CONVEX_SITE_URL:-}" \
python - <<'PY'
import os
from huggingface_hub import HfApi

api = HfApi(token=os.environ["HF_TOKEN"])
repo_id = os.environ["REPO_ID"]

# 1. Ensure Space exists (docker SDK).
try:
    api.repo_info(repo_id=repo_id, repo_type="space")
    print(f"Space {repo_id} exists — skipping create.")
except Exception:
    print(f"Creating Space {repo_id} (docker SDK) ...")
    api.create_repo(
        repo_id=repo_id,
        repo_type="space",
        space_sdk="docker",
        private=False,
    )
    print("Created.")

# 2. Seed Space secrets from .env so the first deploy can boot.
for key in ("WEBHOOK_SECRET", "CONVEX_SITE_URL"):
    val = os.environ.get(key, "")
    if val:
        print(f"Setting Space secret: {key}")
        api.add_space_secret(repo_id=repo_id, key=key, value=val)
    else:
        print(f"Skip {key} (empty in .env)")

print("")
print(f"Space:  https://huggingface.co/spaces/{repo_id}")
print(f"Direct: https://{repo_id.replace('/', '-').lower()}.hf.space")
PY

echo ""
echo "Next: run ./setup-secrets.sh to push GitHub repo secrets/variables,"
echo "then push to main to trigger the first deploy."
