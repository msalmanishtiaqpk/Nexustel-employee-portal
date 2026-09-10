<p align="center"><img src="public/brand/logo-dark.png" alt="Nexus-Tel" height="72"></p>

# Nexus-Tel Employee Portal

Employee management, attendance and payroll portal for **Nexus-Tel** (Lahore, Pakistan).
Built with Next.js 15, TypeScript, Prisma and PostgreSQL 16.

| Role | Capabilities |
|---|---|
| **Employee** | Secure login · profile & employment info · mark attendance once per working day inside the configured window · attendance history & monthly summary · projected salary for the current month · finalized payslips with PDF download · submit / cancel leave requests and track status |
| **Administrator** | Create / edit / activate / deactivate employees · effective-dated salaries with allowances & recurring deductions · work schedules & attendance windows (incl. night shifts crossing midnight) · holidays & per-date window overrides · today's board, by-date and by-employee views · audited manual corrections · leave approval with balances · versioned, fully configurable payroll policy (working-days / calendar-days / fixed-divisor basis, late-penalty modes, rounding, proration) · draft → finalize → reopen payroll runs · bonuses & deductions · payslip PDFs · CSV/XLSX attendance and payroll exports · audit log |

Design rationale, schema and security model: **[docs/DESIGN.md](docs/DESIGN.md)**.

---

## Quick start (local development)

Prerequisites: Node 22+, PostgreSQL 16 (or Docker).

```bash
cp .env.example .env            # then edit FIELD_ENCRYPTION_KEY, JOB_SECRET, SEED_ADMIN_PASSWORD
npm install
npx prisma migrate deploy       # creates the schema
npm run db:seed                 # admin + schedules + leave types + payroll policy (+ demo data if SEED_DEMO_DATA=true)
npm run dev                     # http://localhost:3000
```

Default seed login: `admin@nexus-tel.com` / value of `SEED_ADMIN_PASSWORD` (you are forced to change it on first login).
With `SEED_DEMO_DATA=true`, demo employees log in as `<first>.<last>@nexus-tel.com` / `Employee!2026`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js dev server / production build / production server |
| `npm run lint` · `npm run typecheck` · `npm test` | ESLint · `tsc --noEmit` · Vitest (unit + DB integration tests) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a new migration after editing `prisma/schema.prisma` |
| `npm run db:seed` | Seed core data (idempotent) |
| `npm run job:finalize-attendance` | Materialise Absent / Weekly-off / Holiday / Leave rows up to yesterday |

Tests need `DATABASE_URL_TEST` pointing at a scratch database (it is truncated on every run).

---

## Production deployment (Docker Compose)

Step-by-step guide with DNS, HTTPS and backups: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

```bash
cp .env.example .env
# Set strong values:
#   FIELD_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   JOB_SECRET=$(openssl rand -hex 32)
#   POSTGRES_PASSWORD=...   SEED_ADMIN_PASSWORD=...   APP_URL=https://portal.nexus-tel.com   SEED_DEMO_DATA=false
docker compose --profile proxy up -d --build
```

The stack starts up to four services:

- **db** – PostgreSQL 16 with a persistent volume.
- **app** – the portal (`entrypoint.sh` runs `prisma migrate deploy` and the idempotent seed on every boot). Health check: `GET /api/health`.
- **cron** – a tiny sidecar that calls `POST /api/jobs/finalize-attendance` nightly (22:30 UTC = 03:30 PKT by default) with `Authorization: Bearer $JOB_SECRET`.
- **caddy** (profile `proxy`) – HTTPS reverse proxy that obtains a Let's Encrypt certificate for `DOMAIN` automatically.

If you already run your own reverse proxy, start without the profile (`docker compose up -d --build`) and proxy your hostname to `127.0.0.1:3000`, forwarding `X-Forwarded-For` and `X-Forwarded-Proto`. Either way set `APP_URL` to the public https URL — the session cookie is only marked `Secure` when `APP_URL` starts with `https://`.

### Running on a PaaS instead
Deploy the Next.js app anywhere Node 22 runs, point `DATABASE_URL` at a managed PostgreSQL 16, run `npx prisma migrate deploy` in the release step, and schedule the job endpoint with the platform's cron (any HTTP scheduler works; the job is idempotent and also runs lazily before payroll).

### Backups
Nightly `pg_dump` of the database is sufficient; there is no file storage (payslip PDFs are rendered on demand from immutable payslip snapshots). Keep `FIELD_ENCRYPTION_KEY` with the backups — encrypted national-ID / bank-account fields cannot be recovered without it.

---

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public URL; enables `Secure` cookies when https |
| `FIELD_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of CNIC / bank account numbers |
| `JOB_SECRET` | Bearer token for the scheduled job endpoint |
| `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_HOURS` | Session lifetimes (default 12 h idle, 30 days absolute) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_DATA` | First-run seed |
| `LOG_LEVEL` | pino log level |

Everything else — company timezone, currency, default schedule, office IP allowlist, schedules and windows, holidays, leave types, payroll policy — is configured in the admin UI and stored in the database.

---

## How the core rules work

**Working day & attendance window.** Each schedule defines shift start/end (minutes after local midnight), working weekdays and four offsets relative to shift start: *opens before*, *late after*, *half-day after*, *closes after*. The attendance date is the date the shift **starts**, so a 20:00–05:00 night shift checked in at 01:30 belongs to the previous calendar day. Server time is authoritative.

**Status derivation.** Weekly off → `WEEKLY_OFF`; holiday → `HOLIDAY`; approved leave → `LEAVE`; check-in ≤ start + late grace → `PRESENT`; ≤ half-day threshold → `LATE`; ≤ window close → `HALF_DAY`; no check-in after close → `ABSENT` (written by the nightly job, or lazily before any summary/payroll). Admin corrections keep the previous value in `attendance_corrections` and the audit log.

**Payroll.** `per_day_rate = base ÷ divisor`, where the divisor is scheduled working days, calendar days or a fixed number depending on the policy. Deductions (absent, half day, unpaid leave, late penalty, days not employed) are expressed in days × rate; then recurring components, bonuses and ad-hoc deductions are applied and the result is rounded per policy. The engine is a pure function (`src/server/services/payroll/engine.ts`) with a table-driven test suite; every payslip stores the policy snapshot, all inputs and every line so it is reproducible. Finalizing locks the month's attendance; reopening is explicit, reasoned and audited, and re-running supersedes (never deletes) finalized payslips.

**Security.** Argon2id passwords, opaque server-side sessions in an `httpOnly`/`SameSite=Lax` cookie with idle + absolute expiry and revocation, account lockout and per-IP login rate limiting, forced password change for temporary passwords, strict CSP / HSTS / frame-denial headers, Zod validation at every boundary, Prisma parameterised queries, AES-256-GCM for sensitive identifiers, and a full audit log. Authorization is enforced in the service layer: admin services call `assertAdmin`, employee services derive the employee id from the session (`ownEmployeeId`) and return **404** for any foreign resource id, so an employee can never read or change another employee's attendance, leave, salary or payslips. Next.js middleware only redirects anonymous users; it is never relied upon for authorization.

---

## Project layout

```
prisma/            schema.prisma, migrations (incl. hand-written exclusion constraints), seed.ts
src/app/           Next.js App Router: (auth) login & password, (employee) portal, admin/ console, api/ route handlers
src/server/        auth (password, session, rate limit, actor), rbac guards, services (all business logic), actions (server actions), jobs
src/lib/           dates & timezone helpers, money (Decimal), crypto
src/components/    UI kit and feature components
tests/             unit tests (window logic, payroll engine) and DB integration tests (RBAC, attendance, leave, payroll)
docker/            entrypoint + cron sidecar
docs/              DESIGN.md and brand assets
```
