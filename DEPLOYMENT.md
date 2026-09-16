# 🚀 Production Deployment & Operations Guide

This guide provides end-to-end instructions for deploying the **Melio Restaurant Management System & Luxury Customer Experience Platform** to production.

---

## 🏗️ System Architecture Overview

| Component | Tech Stack | Production Role |
| :--- | :--- | :--- |
| **Backend API** | Node.js 20 (Express + TypeScript) | REST API, SSE Real-time bus, M-Pesa & Card Gateways, Rate Limiter |
| **Database ORM** | Prisma ORM (PostgreSQL 16 / SQLite) | Multi-tenant relational persistence with schema synchronization |
| **Frontend Web** | React 18 (Vite + Tailwind CSS + Lucide) | Luxury Customer Website, Online Ordering, Tracking, Staff POS & Kitchen Display |
| **Web Server** | Nginx Alpine / Reverse Proxy | Gzip compression, static caching, SSL termination, and rate protection |

---

## 🛠️ Deployment Option 1: Full Docker Compose on VPS (Recommended)

Ideal for hosting on any Linux VPS (Ubuntu 22.04 / 24.04, Debian, AWS EC2, DigitalOcean Droplet, Hetzner, Linode).

### 1. Server Prerequisites
Connect to your VPS and install Docker & Docker Compose:

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Docker & Docker Compose
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

### 2. Clone Repository & Setup Environment
```bash
git clone https://github.com/your-username/melio-restaurant-management-system.git /opt/restaurant-system
cd /opt/restaurant-system

# Copy production environment configuration
cp .env.production.example .env
```

Edit `.env` and fill in your production values:
```bash
nano .env
```
Ensure you provide:
- `JWT_SECRET`: Generate with `openssl rand -base64 48`
- `POSTGRES_PASSWORD`: A secure database password
- `ALLOWED_ORIGINS`: Your actual domain (e.g. `https://your-restaurant.com`)
- `MPESA_*`: Live or sandbox Safaricom Daraja credentials

### 3. Launch Multi-Container Stack
```bash
# Build and run containers in background
docker compose up -d --build

# Verify running containers
docker compose ps
```

### 4. Initialize Database Schema & Seed Data
```bash
# Switch to PostgreSQL and push schema into database
docker compose exec server npx prisma db push

# (Optional) Seed initial restaurant branches & roles
docker compose exec server npx prisma db seed
```

### 5. Configure Nginx Reverse Proxy & Free SSL (Let's Encrypt)
Install Nginx and Certbot on host:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create Nginx site configuration (`/etc/nginx/sites-available/restaurant`):
```nginx
server {
    server_name your-restaurant.com www.your-restaurant.com;

    # Frontend SPA Web App
    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API & Real-time SSE Streams
    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Crucial for Real-time SSE streams:
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

Enable site and acquire SSL certificate:
```bash
sudo ln -s /etc/nginx/sites-available/restaurant /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Request Let's Encrypt SSL
sudo certbot --nginx -d your-restaurant.com -d www.your-restaurant.com
```

---

## ☁️ Deployment Option 2: 1-Click Cloud (Render / Railway / Fly.io)

You can deploy the unified root `Dockerfile` as a single web service.

### Render.com Setup
1. Create a **New Web Service** connected to your repository.
2. Select **Docker** as the runtime (Render will automatically detect the root `Dockerfile`).
3. Attach a **PostgreSQL Database** (Render Postgres, Supabase, or Neon).
4. Add the following **Environment Variables**:
   - `NODE_ENV`: `production`
   - `DATABASE_URL`: `postgresql://...` (your PostgreSQL connection string)
   - `JWT_SECRET`: `your-long-secure-random-secret`
   - `ALLOWED_ORIGINS`: `https://your-service.onrender.com`
5. Deploy! The service will build both frontend and backend and start serving at port 5000.

---

## ⚡ Deployment Option 3: Decoupled Cloud (Vercel/Netlify Frontend + Railway Backend)

### Frontend (Vercel or Netlify)
- **Root Directory**: `client`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Environment Variables**:
  - `VITE_API_URL`: `https://api.your-restaurant.com`

### Backend (Railway / Render / Fly.io)
- **Root Directory**: `server`
- **Build Command**: `npm ci && npx prisma generate && npm run build`
- **Start Command**: `npm start`
- **Environment Variables**:
  - `DATABASE_URL`: `postgresql://...`
  - `JWT_SECRET`: `your-long-secure-random-secret`
  - `FRONTEND_URL`: `https://your-frontend.vercel.app`
  - `ALLOWED_ORIGINS`: `https://your-frontend.vercel.app`

---

## 💾 Database Management & Backup Procedures

### Automated Daily PostgreSQL Backup (Cron)
Create backup script `/opt/scripts/backup-db.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/postgres"
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)

docker compose -f /opt/restaurant-system/docker-compose.yml exec -T postgres \
  pg_dump -U rms_admin restaurant_management_db | gzip > "$BACKUP_DIR/rms_db_$DATE.sql.gz"

# Keep last 14 days of backups
find $BACKUP_DIR -type f -name "*.sql.gz" -mtime +14 -exec rm {} +
```

Make executable and add to crontab:
```bash
chmod +x /opt/scripts/backup-db.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/scripts/backup-db.sh") | crontab -
```

### Database Restore
```bash
gunzip -c /opt/backups/postgres/rms_db_20260911.sql.gz | \
  docker compose exec -T postgres psql -U rms_admin -d restaurant_management_db
```

---

## 🛡️ Production Security Checklist

- [x] **Strict Rate Limiting**: Auth (10 attempts/15m), Payments (5 req/2m), Public APIs (150 req/m).
- [x] **HTTP Security Headers**: HSTS, CSP, X-Frame-Options (SAMEORIGIN), nosniff.
- [x] **CORS Whitelisting**: Restricted to verified domain origins.
- [x] **Non-Root Docker Containers**: All Dockerfiles execute as isolated non-root user `rmsuser`.
- [x] **Real-time SSE Keepalive**: 25s ping preventing proxy buffer dropouts.
- [x] **Health Check Probes**: Automated `/health` endpoint validating DB connectivity and response latency.

---

## 🎯 Verification & Health Checks

Once deployed, test your endpoints:

```bash
# Check server health & DB latency
curl -i https://your-restaurant.com/api/health

# Check public menu
curl -i https://your-restaurant.com/api/public/restaurants
```
