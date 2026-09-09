# Deploying the backend to a DigitalOcean droplet

The droplet runs the **backend** (from a GHCR image) + **Postgres** + **Caddy**
(automatic HTTPS) via Docker Compose. GitHub Actions builds the image and pushes
the compose file to the droplet, so **the droplet never needs the repo** — just
Docker and a `~/.env` file you create once.

## 0. Prerequisites
- A droplet: **Ubuntu 22.04/24.04**, **2 GB RAM minimum**.
- A domain with an **A record**: `api.yourdomain.com → <droplet public IP>`
  (create it before the first deploy so Caddy can issue a certificate).

## 1. Point DNS
`A   api.yourdomain.com   <droplet IP>`  → verify with `dig +short api.yourdomain.com`.

## 2. Prepare the droplet (one time)
```bash
ssh root@<droplet-ip>
curl -fsSL https://get.docker.com | sh                    # Docker + compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```
Create the environment file in the **home folder** (`/root/.env`):
```bash
nano ~/.env
```
Fill it from `.env.production.example` (in the repo, for reference). Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET / SETTINGS_ENC_KEY
```
`.env` must set: `DOMAIN`, `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL` (same password, host `db`),
`JWT_SECRET`, `SETTINGS_ENC_KEY`, `PORT=3000`, `CORS_ORIGINS=*`, `SEED_ADMIN_USERNAME/PASSWORD`.
That's the **only** file you place on the droplet — the pipeline delivers the rest.

## 3. GitHub setup (one time)
Add repo **Secrets** (Settings → Secrets and variables → Actions):
| Secret | Value |
|---|---|
| `DROPLET_HOST` | droplet IP or `api.yourdomain.com` |
| `DROPLET_USER` | `root` (or your deploy user) |
| `DROPLET_SSH_KEY` | the **private** key whose public key is in the droplet's `~/.ssh/authorized_keys` |

Make the GHCR image **public** so the droplet can pull without a login:
GitHub → your profile → Packages → **mpb-backend** → Package settings → Change visibility → Public.
*(Or keep it private and run `docker login ghcr.io` on the droplet with a read PAT.)*

## 4. Deploy
Just push to `main` (or Actions → **Deploy backend** → Run workflow). The pipeline:
1. builds the backend image, pushes it to GHCR,
2. copies `docker-compose.prod.yml` + `Caddyfile` to the droplet's home folder,
3. `docker compose pull backend && up -d` → Postgres + Caddy + backend come up,
   Caddy fetches the TLS cert, migrations run, the first admin is seeded.

Verify:
```bash
curl -i https://api.yourdomain.com/api/auth/login -X POST \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"<SEED_ADMIN_PASSWORD>"}'
```
Log in and **change the admin password** immediately.

Every later push to `main` that touches `backend/**` redeploys automatically.

## 5. Point the desktop app at the droplet, rebuild installers
```jsonc
// browser/config.json
{ "backendUrl": "https://api.yourdomain.com" }
```
Then tag a release (`git tag v0.1.1 && git push --tags`) — the **Build installers** workflow
produces the macOS `.dmg` + Windows `.exe`. (Dev override: `MPB_BACKEND_URL=… npm --prefix browser run start`.)

## Manual deploy (optional, no CI)
On the droplet, in a folder with `docker-compose.prod.yml`, `Caddyfile`, `.env`:
```bash
docker compose -f docker-compose.prod.yml up -d --build   # builds the image locally instead of pulling
```

## Backups (Postgres)
```bash
docker exec mpb-db pg_dump -U mpb mpb > mpb-$(date +%F).sql       # add to cron
# restore: cat backup.sql | docker exec -i mpb-db psql -U mpb -d mpb
```

## Notes
- Postgres has **no host port** exposed — only the backend reaches it over the compose network.
- Only 22/80/443 are open. Keep `~/.env` secret.
- REST + WebSocket both run on 3000 behind Caddy; `wss://api.yourdomain.com` works out of the box.
