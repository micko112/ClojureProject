# BeBetter — Deployment

Automated CI/CD for BeBetter (Clojure + Datomic + Angular). The pipeline is defined in
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## What it does

```
push to main
    |
    +-- test-backend       (lein test)             -+
    |                                               |
    +-- test-frontend      (ng build --prod)        | parallel
    |                                               |
    +-- test-ml            (python unittest)       -+
    |
    +-- build-and-push     (4 images -> GHCR)       matrix
    |       +-- bebetter-backend
    |       +-- bebetter-frontend
    |       +-- bebetter-datomic
    |       +-- bebetter-ml
    |
    +-- deploy             (SSH -> /opt/app/deploy.sh -> smoke test)
```

- Pull requests trigger **tests only**; build, push, and deploy are skipped.
- Manual re-deploy: **Actions -> CI / CD -> Run workflow**.
- Rollback: re-run an older green workflow (images are tagged by commit SHA).

## Local development

```powershell
docker compose up --build
```

This starts:

| Service    | Port | URL                          |
| ---------- | ---- | ---------------------------- |
| Datomic    | 4334 | (peer-only)                  |
| Backend    | 3000 | http://localhost:3000/api    |
| Frontend   | 4200 | http://localhost:4200        |
| ML         | 8000 | http://localhost:8000/health |

First run only — seed the DB:
```powershell
$env:BEBETTER_SEED="true"; docker compose up --build backend
```
Then remove the env var and restart.

---

## One-time VPS setup (Hetzner)

Assumes Ubuntu 22.04 or 24.04.

### 1. Create the server

- Hetzner Cloud -> New Project -> Add Server
- Image: **Ubuntu 24.04**, Type: **CX22** (2 vCPU, 4GB RAM, ~4.5€/month) is enough to start
- Add your SSH public key during creation
- Note the IPv4 (e.g. `95.216.x.x`)

### 2. Base install

```bash
ssh root@<VPS_IP>

apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw

# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

### 3. Deploy SSH key (for GitHub Actions)

On your local machine:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/bebetter_deploy -N "" -C "github-actions-deploy"
```

Install the public key on the VPS:
```bash
ssh root@<VPS_IP>
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<contents of bebetter_deploy.pub>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 4. Clone repo to `/opt/app`

```bash
ssh root@<VPS_IP>
mkdir -p /opt/app
cd /opt/app
git clone https://github.com/<your-user>/<your-repo>.git .
chmod +x deploy.sh backup.sh
```

### 5. GHCR Personal Access Token

The VPS needs a PAT with `read:packages` scope to pull private images:

1. GitHub -> Settings -> Developer settings -> **Personal access tokens (classic)** -> Generate new token
2. Scope: `read:packages`
3. Copy the token

Create `/opt/app/.env` from the template:
```bash
cp .env.example .env
nano .env
```

Fill in `GHCR_USER`, `GHCR_TOKEN`, `DOMAIN`, `CERTBOT_EMAIL`. Set `BEBETTER_SEED=true` for the first deploy.

### 6. Point your domain at the VPS

Once you buy the domain, create an A record:
```
bebetter.quest   A   <VPS_IP>
```

Then find/replace `bebetter.quest` with your real domain in:
- `nginx.prod.conf` (the `ssl_certificate` paths)
- `.github/workflows/ci.yml` (the `environment.url` + smoke test URL)
- `.env` on the VPS (`DOMAIN=`)

### 7. GitHub Actions secrets

Repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**:

| Secret            | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| `SSH_HOST`        | `<VPS_IP>`                                            |
| `SSH_USER`        | `root`                                                |
| `SSH_PRIVATE_KEY` | full contents of `~/.ssh/bebetter_deploy` (with BEGIN/END lines) |
| `SSH_PORT`        | `22` (optional; default 22)                           |

### 8. First deploy (before SSL)

On the VPS:
```bash
cd /opt/app
# Bring up datomic + backend + frontend (skip nginx for a moment)
export IMAGE_OWNER=<your-github-user-lowercase>
docker compose -f docker-compose.prod.yml pull backend frontend datomic ml
docker compose -f docker-compose.prod.yml up -d datomic ml backend frontend
```

Wait ~30 seconds for Datomic + backend to come up. Confirm:
```bash
docker compose -f docker-compose.prod.yml logs -f backend
# should print: "BeBetter REST API running on http://0.0.0.0:3000"
```

Turn `BEBETTER_SEED=false` back in `.env` and restart backend once seed has run:
```bash
docker compose -f docker-compose.prod.yml restart backend
```

### 9. Issue the SSL certificate (Let's Encrypt)

Bring up nginx on port 80 first (so the ACME challenge works). Temporarily change the
443 `server` block's `ssl_certificate` paths to `snakeoil` or comment out the 443 block
until you have a cert. Then:

```bash
cd /opt/app
docker compose -f docker-compose.prod.yml up -d nginx
docker compose -f docker-compose.prod.yml run --rm certbot
```

The cert lands in the `certbot-conf` volume. Uncomment the 443 block, restart nginx:
```bash
docker compose -f docker-compose.prod.yml restart nginx
```

Set up auto-renewal via cron:
```bash
crontab -e
```
Add:
```
0 3 * * 0 cd /opt/app && docker compose -f docker-compose.prod.yml run --rm certbot renew && docker compose -f docker-compose.prod.yml restart nginx
```

### 10. Backup cron

```bash
crontab -e
```
Add:
```
0 2 * * * /opt/app/backup.sh >> /opt/app/backups/backup.log 2>&1
```

Backups land in `/opt/app/backups/`, last 14 days retained.

### 11. Trigger first CI/CD run

Push anything to `main`, or in Actions -> Run workflow manually. The first run takes ~10 minutes (no cache), subsequent runs ~3-5 minutes.

---

## Media storage (Cloudflare R2)

Photos and videos go through `POST /api/media`: the backend checks the real file
type, rotates photos upright, **strips all metadata (EXIF/GPS)**, makes
320/640/1080 px JPEG versions and a tiny blurred placeholder, then stores them.

Without configuration files are kept on the VPS disk (`uploads_data` volume) and
served by nginx. For production use **Cloudflare R2**: S3-compatible, cheap
storage and **no egress fees** (you don't pay for people viewing photos), served
from Cloudflare's CDN. AWS S3 and MinIO work with the same variables.

### 1. Create the bucket
1. Cloudflare dashboard -> **R2 Object Storage** -> enable R2 (needs a payment method; 10 GB/month free).
2. **Create bucket**, e.g. `bebetter-media`, location *Automatic*.

### 2. Make it publicly readable
Bucket -> **Settings -> Public access**:
- **Recommended:** *Custom Domains -> Connect Domain* -> `media.bebetter.quest`
  (the domain must be on Cloudflare DNS; the record is created for you). Enables CDN caching.
- Quick test alternative: *R2.dev subdomain -> Allow* (rate-limited, not for production).

### 3. Create an API token
R2 overview -> **Manage R2 API Tokens -> Create API token**:
- Permissions: **Object Read & Write**, limited to the `bebetter-media` bucket.
- Copy the **Access Key ID**, **Secret Access Key** and the S3 endpoint
  `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (shown on the same page).

### 4. Configure the backend
Add to `/opt/app/.env` on the VPS:
```bash
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=bebetter-media
S3_ACCESS_KEY=<access key id>
S3_SECRET_KEY=<secret access key>
S3_REGION=auto
S3_PREFIX=media/
MEDIA_PUBLIC_BASE_URL=https://media.bebetter.quest   # or the r2.dev URL, no trailing slash
```
Restart: `docker compose -f docker-compose.prod.yml up -d backend`.
The log shows `[media] S3 storage: bucket bebetter-media ...`.

### 5. Check it
Upload a photo in the app and open it: the URL should start with
`https://media.bebetter.quest/media/`. Objects are uploaded with
`Cache-Control: public, max-age=31536000, immutable` (names are random UUIDs).
Optional: in Cloudflare add a Cache Rule "Cache everything" for the media hostname.

Notes
- Old files in `uploads_data` keep working (`/uploads/...` URLs are still served).
  To move them, copy the volume into the bucket with `rclone` and keep the volume until done.
- AWS S3: leave `S3_ENDPOINT` empty, set `S3_REGION` (e.g. `eu-central-1`) and
  `MEDIA_PUBLIC_BASE_URL` (bucket website or CloudFront URL).
- Local S3 testing: `docker compose --profile minio up` starts MinIO
  (console http://localhost:9001, `minioadmin`/`minioadmin`) with a public
  `bebetter-media` bucket; set `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`,
  `MEDIA_PUBLIC_BASE_URL=http://localhost:9000/bebetter-media`.
- Upload limits: images 15 MB, videos 100 MB (nginx `client_max_body_size 120m`).

---

## Activity suggestions (ML service)

The composer suggests the activity of a photo ("Looks like: 🏃 Running 87%")
using the `ml` service: CLIP ViT-B/32 (quantized ONNX, CPU) plus a small head
trained on the tags people confirm or correct. How it works and how to
retrain: [ml/README.md](ml/README.md).

- **Image**: `bebetter-ml`, built by CI like the others. The ~155 MB model is
  downloaded at build time from HuggingFace, pinned to a commit and
  checksum-verified (`ml/scripts/download_model.py`); nothing is fetched at
  runtime. ~230 MB RAM, ~60 ms per photo on 2 CPU threads.
- **Volume**: `ml_data` (`/data/head.npz`, the trained head). Losing it just
  means falling back to zero-shot until the next retrain; labels are in Datomic.
- **Network**: the service has no published port in production; only the
  backend talks to it (`ML_URL=http://ml:8000`, the compose default).
- **Optional by design**: if `ml` is down or slow, uploads and posts work as
  before, just without suggestions (2 s timeout, then calls pause for 15 s).

`.env` on the VPS:

```env
ADMIN_USERNAMES=Micko              # who may call /api/vision/status, /retrain, /export
# ML_URL=                          # uncomment (empty) to switch suggestions off
# ML_TOKEN=some-long-random-string # optional shared secret for POST /train
# ML_TIMEOUT_MS=2000
# ML_THREADS=2                     # CPU threads for inference
```

First deploy of this feature: `deploy.sh` pulls and starts `ml` automatically
(no data migration: the new Datomic attributes are added on backend start).

Retrain after a few hundred new labels (log in as an admin in the browser
first, or pass the session cookie to curl):

```bash
curl -b 'bb-session=...' https://bebetter.quest/api/vision/status
curl -b 'bb-session=...' -X POST https://bebetter.quest/api/vision/retrain
```

Check the service: `docker compose -f docker-compose.prod.yml logs ml` should
show `[ml] model ready in ~2s (zero-shot)` (or `head+zero-shot`).

---

## Rollback

Pick a green run from before the bug in **Actions -> CI/CD** and click **Re-run all jobs**.

Or SSH into the VPS:
```bash
cd /opt/app
IMAGE_TAG=<older-sha> ./deploy.sh <older-sha>
```

---

## Troubleshooting

**`unauthorized` while pulling images on the VPS**
- PAT expired or lacks `read:packages`. Update `GHCR_TOKEN` in `.env` and re-run deploy.

**`502 Bad Gateway` right after deploy**
- Nginx caches upstream DNS; `deploy.sh` already restarts nginx, so if you see this the restart didn't happen. Rerun `docker compose -f docker-compose.prod.yml restart nginx`.

**Datomic connection refused**
- `docker compose -f docker-compose.prod.yml logs datomic` — the transactor takes ~15 seconds to bind port 4334. The backend has a 30-attempt retry with 2-second backoff.

**Empty DB after first deploy**
- Set `BEBETTER_SEED=true` in `.env`, restart backend, wait for `[bootstrap] BEBETTER_SEED=true — running reset-db!` in logs, then set it back to `false`.

**No "Looks like ..." suggestions in the composer**
- `docker compose -f docker-compose.prod.yml ps ml` should be `healthy`; check `logs ml`.
- The backend logs `[vision] ML service unavailable ...` when calls fail; it retries after 15 s.
- `ML_URL` set to empty in `.env` disables the feature.

**Uploaded images 404 in frontend**
- The `uploads_data` volume is shared between backend (writes) and nginx (reads). If nginx wasn't recreated after adding the volume mount, run `docker compose -f docker-compose.prod.yml up -d --force-recreate nginx`.

---

## What this pipeline deliberately doesn't do

- **Never touches `.env`** — secrets live only on the VPS.
- **Doesn't run destructive DB migrations automatically** — `BEBETTER_SEED=true` is an opt-in flag you set manually on first boot.
- **Doesn't back up before deploy** — the nightly `backup.sh` cron covers that (02:00).
- **Doesn't send notifications** — add a Slack/Discord webhook to the deploy job if you want them.
