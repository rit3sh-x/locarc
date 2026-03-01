# LocArc — Infrastructure

## Quick Start (Fresh Server)

```bash
git clone https://github.com/rit3sh-x/locarc.git ~/locarc
cd ~/locarc
chmod +x infra/*.sh
bash infra/setup.sh    # install system deps (one-time)
bash infra/build.sh    # build all apps
bash infra/deploy.sh   # apply nginx + start PM2
```

## Scripts

| Script | What it does | When to use |
|--------|-------------|-------------|
| `setup.sh` | Installs system deps (nginx, node, pnpm, pm2, uv, Android SDK, firewall) | First-time server setup |
| `build.sh` | Builds web app, syncs Python deps, builds APK | After code changes |
| `deploy.sh` | Applies nginx config, restarts PM2 | After config or build changes |
| `rebuild.sh` | Stops PM2 → pulls code → `build.sh` → `deploy.sh` | Day-to-day redeployment |

### Flags

```bash
bash infra/build.sh --skip-apk     # skip the slow APK build
bash infra/rebuild.sh --skip-apk   # rebuild without APK
```

## Port Map

```
Internet :80   → Nginx → Next.js (:3000)
Internet :8000 → Nginx → Uvicorn (:8080)
UFW: 22, 80, 8000
```

## Config Reference

| To do this | Edit this file | Where |
|---|---|---|
| Change Node/Python ports | `ecosystem.config.cjs` | `args` field for each app |
| Change external ports | `nginx.http.conf` | `listen` directives |
| Open/close firewall ports | `setup.sh` | `ufw allow` lines |
| Add/remove Python deps | `server/pyproject.toml` | `dependencies` array |
| Add/remove Node deps | `web/package.json` | `pnpm add/remove` in `web/` |
| Add a new service | `ecosystem.config.cjs` | Add entry to `apps` array |
| Add nginx route | `nginx.http.conf` | Add new `server {}` block |

> If you change a port, update it in **both** `ecosystem.config.cjs` and `nginx.http.conf`.

## Useful Commands

```bash
pm2 status              # view running processes
pm2 logs                # view logs
pm2 restart all         # restart all services
pm2 restart locarc-web  # restart just the web app
pm2 restart locarc-api  # restart just the API
sudo nginx -t           # test nginx config
sudo systemctl restart nginx
sudo ufw status         # view firewall rules
```