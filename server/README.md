---
title: Locarc API
emoji: 📡
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8080
pinned: false
---

# Locarc Localization API

FastAPI compute service. Receives measurement batches from Convex, runs
multilateration / annulus localization, POSTs results back to the webhook.

Deployed on Hugging Face Spaces (Docker SDK). Source auto-synced by
`.github/workflows/deploy-server.yml` on push to `main`.

## Runtime config (Space Secrets)

| Secret | Purpose |
|---|---|
| `WEBHOOK_SECRET` | Shared HMAC key signing compute-result callbacks |
| `CONVEX_SITE_URL` | Base URL for posting results back (e.g. `https://*.convex.site`) |

Set via HF Space Settings → Variables and secrets, or auto-synced from
GitHub secrets by the workflow.

## Local dev

```bash
cd server
uv sync
uv run uvicorn main:app --reload
```
