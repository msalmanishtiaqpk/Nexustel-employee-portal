# Going live: deploying the Nexus-Tel Employee Portal

This guide takes the portal from the repository to a public HTTPS address such as
`https://portal.nexus-tel.com`. Two routes are described; **Route A** is recommended.

---

## Route A — one VPS with Docker (recommended, ~30 minutes)

You need: a Linux server, the ability to add a DNS record for `nexus-tel.com`, and SSH access.

### 1. Get a server
Any provider works (Hetzner, DigitalOcean, Vultr, Contabo, AWS Lightsail…). A small instance is enough:

| Spec | Minimum | Comfortable |
|---|---|---|
| vCPU / RAM | 1 vCPU / 2 GB | 2 vCPU / 4 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |

Open inbound ports **22, 80 and 443** in the provider's firewall.

### 2. Point DNS at it
In the DNS panel for `nexus-tel.com` add an **A record**:

```
portal.nexus-tel.com   A   <server public IPv4>
```

(Add an AAAA record too if the server has IPv6.) Wait until `ping portal.nexus-tel.com` resolves to the server before step 5, or Let's Encrypt cannot issue a certificate.

### 3. Install Docker on the server
```bash
ssh root@<server-ip>
curl -fsSL https://get.docker.com | sh
```

### 4. Get the code and configure it
```bash
git clone -b claude/nexus-tel-employee-portal-xa798f https://github.com/msalmanishtiaqpk/Nexustel-employee-portal.git /opt/nexustel
cd /opt/nexustel
cp .env.example .env
nano .env
```

Set at least these values in `.env`:

```ini
DOMAIN="portal.nexus-tel.com"
APP_URL="https://portal.nexus-tel.com"
POSTGRES_PASSWORD="<long random string>"
FIELD_ENCRYPTION_KEY="<output of: openssl rand -hex 32>"
JOB_SECRET="<output of: openssl rand -hex 32>"
SEED_ADMIN_EMAIL="hr@nexus-tel.com"
SEED_ADMIN_PASSWORD="<temporary admin password>"
SEED_DEMO_DATA="false"
```

Generate the two keys with `openssl rand -hex 32` (run it twice). **Keep `FIELD_ENCRYPTION_KEY` somewhere safe** — CNIC and bank-account numbers are encrypted with it and cannot be recovered if it is lost.

### 5. Start everything
```bash
docker compose --profile proxy up -d --build
docker compose logs -f app        # wait for "Ready" then Ctrl-C
```

This starts PostgreSQL, applies the database migrations, seeds the admin account, starts the app, starts the nightly attendance job, and starts Caddy, which fetches a free Let's Encrypt certificate for `DOMAIN` and serves `https://portal.nexus-tel.com`.

Check it: `https://portal.nexus-tel.com/api/health` should return `{"status":"ok",...}`.

### 6. First login and setup
1. Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; you are forced to set a new password.
2. **Settings** → confirm company name, timezone `Asia/Karachi`, currency `PKR`; optionally enter the office public IP in *Attendance IP allowlist* so attendance can only be marked from the office.
3. **Schedules** → adjust the two seeded shift templates (day shift, US night shift) or add your own.
4. **Holidays & windows** → review the seeded 2026 holidays against the official gazette.
5. **Leave → Leave types** and **Payroll → Policy** → confirm quotas and salary rules.
6. **Employees → New employee** for each staff member. Share the one-time temporary password securely; they must change it on first login.

### 7. Keep it running
| Task | Command |
|---|---|
| View logs | `docker compose logs -f app` |
| Update to a new version | `git pull && docker compose --profile proxy up -d --build` (migrations run automatically) |
| Nightly database backup | add to `crontab -e`: `0 2 * * * docker compose -f /opt/nexustel/docker-compose.yml exec -T db pg_dump -U nexustel nexustel | gzip > /var/backups/nexustel-$(date +\%F).sql.gz` |
| Restore a backup | `gunzip -c file.sql.gz \| docker compose exec -T db psql -U nexustel nexustel` |
| Trigger the attendance job manually | `curl -X POST -H "Authorization: Bearer $JOB_SECRET" https://portal.nexus-tel.com/api/jobs/finalize-attendance` |

Copy the backups off the server (object storage, another machine) and back up `.env` alongside them.

#### Already have nginx / another proxy on the server?
Run without the Caddy profile — `docker compose up -d --build` — and proxy your hostname to `127.0.0.1:3000`, forwarding `X-Forwarded-For` and `X-Forwarded-Proto` headers. Keep `APP_URL` as the https URL.

---

## Route B — managed platform (no server administration)

Use a Node host plus a managed PostgreSQL. Examples: **Railway**, **Render**, or **Fly.io** for the app with **Neon**, **Supabase** or the host's own Postgres for the database.

1. Create a PostgreSQL 16 database and copy its connection string into `DATABASE_URL`.
2. Create a web service from this repository (branch `claude/nexus-tel-employee-portal-xa798f`), Node 22:
   - Build command: `npm ci && npx prisma generate && npm run build`
   - Pre-deploy / release command: `npx prisma migrate deploy && npm run db:seed`
   - Start command: `npm start`
   - Environment variables: everything from `.env.example` except the Docker-only ones (`APP_URL` = the platform URL or your custom domain, `SEED_DEMO_DATA=false`).
3. Attach the custom domain `portal.nexus-tel.com` in the platform's dashboard and add the CNAME record it gives you; the platform provisions HTTPS.
4. Add a scheduled job (the platform's cron feature, or cron-job.org) that runs nightly:
   `POST https://portal.nexus-tel.com/api/jobs/finalize-attendance` with header `Authorization: Bearer <JOB_SECRET>`.
   The job is idempotent and also runs lazily before payroll, so a missed night is not a problem.
5. Enable the database's automated backups.

Vercel also works for the app itself (set the same environment variables and use a managed Postgres), but note the serverless function timeout applies to the payroll run and PDF generation; a VPS or Railway/Render container avoids that.

---

## Checklist before announcing it to staff
- [ ] `https://portal.nexus-tel.com/api/health` returns `ok` and the browser shows a valid padlock
- [ ] Admin password changed; `SEED_DEMO_DATA` is `false`
- [ ] Timezone, schedules, holidays, leave types and payroll policy reviewed
- [ ] At least one test employee created, logged in, marked attendance, and downloaded a payslip after a test payroll run (reopen and re-run the real month later if needed)
- [ ] Backups scheduled and a restore tested once
- [ ] `.env` and `FIELD_ENCRYPTION_KEY` stored in a password manager
