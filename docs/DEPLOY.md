# SyncCanvas — Production Deployment Runbook

## Architecture

- **Frontend (`apps/web`):** Vercel (Next.js 15 App Router, client-only canvas).
- **Backend (`server/`):** Always-on VM (Oracle Cloud Always Free Ampere A1 or Hetzner CAX11) running `deploy/docker-compose.prod.yml` (Caddy with automatic HTTPS + 2× Spring Boot 3.5 + Redis 7).
- **Database:** Neon PostgreSQL 16 in the same region as the VM.

## 1. Provision Neon Postgres

1. Create a Neon project (PostgreSQL 16) in the same region as your VM.
2. Copy the JDBC URL (`jdbc:postgresql://<host>/<db>?sslmode=require`), username, and password.

## 2. Provision VM & Configure DNS

1. Point `A` record `api.<your-domain>` to the VM's public IP.
2. Install Docker + Docker Compose plugin on the VM.
3. Copy `deploy/docker-compose.prod.yml` and `deploy/Caddyfile.prod` to `/opt/synccanvas/`.
4. Create `/opt/synccanvas/.env`:
   ```env
   API_DOMAIN=api.<your-domain>
   SERVER_IMAGE=ghcr.io/<owner>/synccanvas-server:latest
   DATABASE_URL=jdbc:postgresql://<neon-host>/synccanvas?sslmode=require
   DATABASE_USER=<user>
   DATABASE_PASSWORD=<password>
   ```
5. Release a version tag (`git tag v1.0.0 && git push --tags`) to build and push the multi-arch image via `.github/workflows/deploy.yml`.
6. On the VM:
   ```bash
   cd /opt/synccanvas
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```
7. Verify `https://api.<your-domain>/actuator/health` returns `{"status":"UP"}`.

## 3. Deploy Frontend to Vercel

1. Import the repository in Vercel with **Root Directory** = `apps/web`.
2. Set environment variables:
   - `NEXT_PUBLIC_API_URL=https://api.<your-domain>`
   - `NEXT_PUBLIC_WS_URL=wss://api.<your-domain>`
3. Deploy and verify the Split-Screen Playground + Conflict Demo over HTTPS/WSS.

## 4. Uptime Monitoring

- Add a 5-minute HTTPS monitor (Better Stack or UptimeRobot) on `https://api.<your-domain>/actuator/health`.
