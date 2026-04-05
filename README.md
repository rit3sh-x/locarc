# Locarc

RF-based localization platform. Monorepo with four services:

| Service      | Stack                        | Deployed To        |
| ------------ | ---------------------------- | ------------------ |
| **Frontend** | React 19, Vite 7, Tailwind 4 | Cloudflare Pages   |
| **Backend**  | Convex serverless            | Convex Cloud       |
| **Server**   | FastAPI, Python 3.13         | Google Cloud Run   |
| **Mobile**   | React Native, Expo 54        | Expo / Google Play |

---

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Python 3.13+](https://www.python.org/) and [uv](https://docs.astral.sh/uv/)
- [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install)
- A [GCP project](https://console.cloud.google.com/) with billing enabled
- A [Convex](https://convex.dev/) account and project
- A [Cloudflare](https://cloudflare.com/) account

---

## GCP Setup

### 1. Create a GCP Project

> Replace `YOUR_PROJECT_ID` with your own GCP project ID throughout this guide.

```bash
gcloud projects create YOUR_PROJECT_ID --name="Locarc"
gcloud config set project YOUR_PROJECT_ID
```

### 2. Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com
```

### 3. Create a Service Account for GitHub Actions

```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions Deployer"

# Grant Cloud Run Admin (deploy services)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Grant Cloud Build Editor (build containers)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"

# Grant Artifact Registry Admin (push + cleanup old images)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.admin"

# Grant Storage Admin (Cloud Build needs to read/write GCS buckets)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

# Grant Service Account User (to act as the runtime identity)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### 4. Set Up Workload Identity Federation (Keyless Auth)

This lets GitHub Actions authenticate to GCP without storing a JSON key.

```bash
# Create the Workload Identity Pool
gcloud iam workload-identity-pools create github-pool \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create an OIDC Provider for GitHub
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Allow your GitHub repo to impersonate the service account
# Replace YOUR_GITHUB_ORG/locarc with your actual repo
gcloud iam service-accounts add-iam-policy-binding \
  github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_GITHUB_ORG/locarc"
```

### 5. Get the Workload Identity Provider Resource Name

This value goes into the `GCP_WORKLOAD_IDENTITY_PROVIDER` GitHub secret.

```bash
gcloud iam workload-identity-pools providers describe github-provider \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --format="value(name)"
```

Output will look like:

```
projects/123456789/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

---

## GitHub Secrets & Variables

Go to **GitHub repo > Settings > Secrets and variables > Actions**.

### Secrets (sensitive values)

| Secret                           | Description                                    | Where to get it                                                       |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Provider resource name       | Step 5 above                                                          |
| `GCP_SERVICE_ACCOUNT`            | Service account email                          | `github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com`                       |
| `CONVEX_DEPLOY_KEY`              | Convex production deploy key                   | Convex Dashboard > Project Settings > Deploy Key                      |
| `CLOUDFLARE_API_TOKEN`           | Cloudflare API token with Pages edit perms     | Cloudflare Dashboard > My Profile > API Tokens > Create Token         |
| `CLOUDFLARE_ACCOUNT_ID`          | Cloudflare account ID                          | Cloudflare Dashboard > any domain > Overview (right sidebar)          |
| `WEBHOOK_SECRET`                 | Shared HMAC secret between Convex and Server   | Generate with `openssl rand -hex 32`                                  |

### Variables (non-sensitive config)

| Variable                 | Description                          | Example                                          |
| ------------------------ | ------------------------------------ | ------------------------------------------------ |
| `GCP_REGION`             | Cloud Run deployment region          | `us-central1`                                    |
| `CONVEX_SITE_URL`        | Convex HTTP Actions URL              | `https://your-deployment.convex.site`            |
| `CLOUDFLARE_PROJECT_NAME`| Cloudflare Pages project name        | `locarc`                                         |
| `VITE_CONVEX_URL`        | Convex deployment URL (frontend)     | `https://your-deployment.convex.cloud`           |
| `VITE_CONVEX_SITE_URL`   | Convex site URL (frontend)           | `https://your-deployment.convex.site`            |
| `LOCALIZATION_ALGO`      | Localization algorithm               | `annulus` or `circle`                            |
| `PATH_LOSS_EXPONENT`     | RF path loss exponent                | `3.5`                                            |
| `PT_MIN_DBM`             | Min transmission power (dBm)         | `20.0`                                           |
| `PT_MAX_DBM`             | Max transmission power (dBm)         | `43.0`                                           |

---

## Local Development

### Backend (Convex)

```bash
cd backend
cp .env.example .env    # fill in your values
pnpm install
pnpm dev                # starts Convex dev server
```

**Required `.env` values:**

```env
CONVEX_DEPLOYMENT=dev:your-convex-deployment
CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_SITE_URL=https://your-deployment.convex.site
BETTER_AUTH_SECRET=your_auth_secret_here
SITE_URL=http://localhost:3000
MOBILE_SCHEME=yourapp://
WEBHOOK_SECRET=your_webhook_secret_here
COMPUTE_SERVICE_URL=http://localhost:8000
```

### Frontend (React + Vite)

```bash
cd frontend
cp .env.schema .env     # fill in your Convex URLs
pnpm install
pnpm dev                # starts on http://localhost:5173
```

**Required `.env` values:**

```env
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_CONVEX_SITE_URL=https://your-deployment.convex.site
```

### Server (FastAPI)

```bash
cd server
cp .env.example .env    # fill in your values
uv sync
uv run uvicorn main:app --reload --port 8000
```

**Required `.env` values:**

```env
WEBHOOK_SECRET=your_webhook_secret_here
CONVEX_SITE_URL=https://your-deployment.convex.site
LOCALIZATION_ALGO=annulus
PATH_LOSS_EXPONENT=3.5
PT_MIN_DBM=20.0
PT_MAX_DBM=43.0
```

### Mobile (React Native + Expo)

```bash
cd mobile
cp .env.schema .env     # fill in your Convex URLs
pnpm install
pnpm start              # starts Expo dev server
```

**Required `.env` values:**

```env
EXPO_PUBLIC_CONVEX_SITE_URL=https://your-deployment.convex.site
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

---

## Deployment

All services auto-deploy on push to `main` when their directory has changes.

### Automatic (CI/CD)

| Service      | Trigger                    | Workflow                              |
| ------------ | -------------------------- | ------------------------------------- |
| **Frontend** | Push to `main` in `frontend/` | `.github/workflows/deploy-frontend.yml` |
| **Backend**  | Push to `main` in `backend/`  | `.github/workflows/deploy-backend.yml`  |
| **Server**   | Push to `main` in `server/`   | `.github/workflows/deploy-server.yml`   |

All workflows also support manual dispatch from the GitHub Actions tab.

### Manual Deployment

**Frontend:**

```bash
cd frontend
pnpm build
npx wrangler pages deploy dist --project-name=locarc
```

**Backend:**

```bash
cd backend
npx convex deploy
```

**Server (Cloud Run):**

```bash
cd server
gcloud run deploy locarc-api \
  --source=. \
  --region=us-central1 \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=90 \
  --min-instances=0 \
  --max-instances=3 \
  --allow-unauthenticated \
  --set-env-vars="WEBHOOK_SECRET=xxx,CONVEX_SITE_URL=xxx,LOCALIZATION_ALGO=annulus,PATH_LOSS_EXPONENT=3.5,PT_MIN_DBM=20.0,PT_MAX_DBM=43.0"
```

---

## Cloud Run Service Details

| Setting          | Value                |
| ---------------- | -------------------- |
| Service name     | `locarc-api`         |
| Port             | `8080`               |
| Memory           | `1Gi`                |
| CPU              | `1`                  |
| Timeout          | `90s`                |
| Min instances    | `0` (scales to zero) |
| Max instances    | `3`                  |
| Authentication   | Unauthenticated      |

---

## Architecture

```
Mobile App / Web Frontend
        |
        v
   Convex Backend (auth, data, HTTP actions)
        |
        v  (webhook with HMAC-SHA256)
   Cloud Run Server (RF localization compute)
        |
        v  (callback to Convex)
   Convex Backend (stores results)
```

The server receives RF signal measurements via webhook from Convex, computes coordinates using annulus/circle intersection algorithms, and posts results back to Convex.
