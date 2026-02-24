# LocArc — Infrastructure

## Setup

```bash
git clone https://github.com/rit3sh-x/locarc.git /home/ubuntu/locarc
cd /home/ubuntu/locarc
chmod +x infra/setup.sh
./infra/setup.sh
```

`setup.sh` installs everything (nginx, ufw, python, node, pnpm, uv, pm2), builds the apps, and starts them.

## Port Map

```
Internet :80   → Nginx → Next.js (:3000)
Internet :8000 → Nginx → Uvicorn (:8080)
UFW open: 22, 80, 8000
```

## Where to Edit

| To do this                  | Edit this file               | Where in file                     |
|-----------------------------|------------------------------|-----------------------------------|
| Change Node/Python ports    | `ecosystem.config.cjs`       | `args` field for each app         |
| Change external ports       | `nginx.http.conf`            | `listen` directives               |
| Open/close firewall ports   | `setup.sh`                   | `ufw allow` lines                 |
| Add/remove Python deps      | `server/pyproject.toml`      | `dependencies` array              |
| Add/remove Node deps        | `web/package.json`           | run `pnpm add/remove` in `web/`   |
| Add a new service           | `ecosystem.config.cjs`       | Add entry to `apps` array         |
| Add nginx route for service | `nginx.http.conf`            | Add a new `server {}` block       |

> If you change a port, update it in **both** `ecosystem.config.cjs` and `nginx.http.conf`.

## After Code Changes

```bash
pm2 restart locarc-api

cd web && pnpm build && cd ..
pm2 restart locarc-web

git pull
cd server && uv sync && cd ..
cd web && pnpm install && pnpm build && cd ..
pm2 restart all
```

## Useful Commands

```bash
pm2 status
pm2 logs
pm2 restart all
sudo nginx -t
sudo systemctl restart nginx
sudo ufw status
```