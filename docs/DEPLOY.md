# SyncCanvas — Production & Free Student Deployment Runbook

SyncCanvas separates its static Next.js frontend (`apps/web`), stateless WebSocket backend (`server/`), Redis Pub/Sub fan-out, and PostgreSQL 16 storage. Below are **three 100% free student deployment paths**, ranked from most production-realistic to quickest to launch.

---

## Path A (Recommended for Students): Full Multi-Node 24/7 via GitHub Student Developer Pack

Runs the complete **`Caddy + 2× Spring Boot 3.5 + Redis 7`** stack 24/7 with zero cold starts and real automatic HTTPS.

### Free Student Resources Needed

1. Apply at [education.github.com/pack](https://education.github.com/pack) with your college email / student ID.
2. **Backend VM:**
   - **Azure for Students** — **\$100/yr credit, NO credit card required** (renews yearly while enrolled) → Ubuntu 24.04 VM (`Standard_B1s` or `Standard_B2ats_v2`).
   - _Or_ **DigitalOcean** — **\$200 credit (1 year)** → \$6–\$12/mo Ubuntu Droplet.
3. **Database:** **Neon Free Tier** (free forever, no card, PostgreSQL 16, 0.5 GB).
4. **Frontend:** **Vercel Hobby** (free forever, no card).
5. **Custom Domain:** Free `.me` (Namecheap) or `.tech` domain from the Student Pack.

### Step-by-Step Setup

1. **Provision Neon Postgres:** Create a Neon project in the same region as your VM and note the JDBC URL (`jdbc:postgresql://<host>/<db>?sslmode=require`), username, and password.
2. **Configure DNS:** Point an `A` record `api.<your-domain>` → your VM's public IPv4 address. Open inbound ports **80** and **443** in your VM firewall.
3. **Publish Server Image:** Push a version tag (`git tag v1.0.0 && git push --tags`) so `.github/workflows/deploy.yml` builds and pushes multi-arch (`linux/amd64`, `linux/arm64`) images to GHCR.
4. **Start the Multi-Node Stack on the VM:**
   ```bash
   sudo mkdir -p /opt/synccanvas && cd /opt/synccanvas
   # Copy deploy/docker-compose.prod.yml and deploy/Caddyfile.prod here
   cat > .env <<'EOF'
   API_DOMAIN=api.<your-domain>
   SERVER_IMAGE=ghcr.io/<your-github-username>/synccanvas-server:latest
   DATABASE_URL=jdbc:postgresql://<neon-host>/synccanvas?sslmode=require
   DATABASE_USER=<neon-user>
   DATABASE_PASSWORD=<neon-password>
   EOF

   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```
   Verify: `curl https://api.<your-domain>/actuator/health` → `{"status":"UP"}`.
5. **Deploy Frontend to Vercel:**
   - Import the repo in Vercel with **Root Directory** = `apps/web`.
   - Set environment variables:
     - `NEXT_PUBLIC_API_URL=https://api.<your-domain>`
     - `NEXT_PUBLIC_WS_URL=wss://api.<your-domain>`
   - Deploy and test the Split-Screen Playground + Conflict Demo + `/b/<boardId>` over HTTPS/WSS.

---

## Path B (Zero Credit Card, Zero Student Pack): Render Free + Neon + Vercel

Launch in ~10 minutes with **no credit card and no student verification** (single-node `SYNCCANVAS_BUS=local`, no Redis required).

1. **Neon Free Postgres:** Create a Neon PostgreSQL 16 database and copy JDBC URL, user, and password.
2. **Render Free Web Service:**
   - Connect your GitHub repo in Render → **New Blueprint** pointing to `deploy/render.yaml` (or New Web Service with Docker `server/Dockerfile`).
   - Fill in `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, and `SPRING_DATASOURCE_PASSWORD`.
   - `server/Dockerfile` is pre-tuned with `-XX:MaxRAMPercentage=70.0 -XX:+UseSerialGC -Xss256k` to stay comfortably inside Render's 512 MB RAM limit.
   - _(Note: Render Free spins down after 15 min of inactivity; SyncCanvas starts immediately in Local Simulation Mode while the backend wakes and shows a **"Live server ready — Switch"** button once `/actuator/health` responds.)_
3. **Vercel Hobby:** Deploy `apps/web` with `NEXT_PUBLIC_API_URL=https://<your-app>.onrender.com` and `NEXT_PUBLIC_WS_URL=wss://<your-app>.onrender.com`.

---

## Path C (Forever Free Always-On Multi-Node): Oracle Cloud Always Free

- Provision an **Oracle Cloud Always Free Ampere A1 ARM VM** (up to 4 vCPU, 24 GB RAM — free forever, requires a debit/credit card for a temporary \$1 verification hold).
- Follow the exact same VM steps as **Path A** above (`deploy/docker-compose.prod.yml` runs natively on `linux/arm64`).

---

## Uptime Monitoring

Add a free 5-minute HTTPS monitor (Better Stack or UptimeRobot) on `https://api.<your-domain>/actuator/health`.
