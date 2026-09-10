# Nexus-Tel Employee Portal — Requirements Analysis & Technical Design

Status: **Approved with defaults (2026-09-10) and implemented.** See the README for setup and the *Implementation notes* section at the end for deviations from this proposal.
Author: Claude (design pass requested before implementation)
Date: 2026-09-10

This document covers, in order:

1. Requirements analysis (what the system must do, and what the request leaves open)
2. Domain model and PostgreSQL schema
3. Application architecture
4. Security model (authentication, RBAC, tenant-of-one data isolation, auditing)
5. Attendance and payroll rules (configurable, not hard-coded)
6. Implementation plan and phases
7. **Open questions, assumptions and risks — please review Section 7 before implementation starts**

---

## 1. Requirements analysis

### 1.1 Company context (from nexus-tel.com)

| Item | Value | Design impact |
|---|---|---|
| Business | Outbound sales / support agency (cold calling, appointment setting, lead gen) | Agents likely work **shifts aligned to US/UK client hours**, i.e. evening/night shifts in Pakistan that cross midnight. Attendance windows must handle this. |
| Location | Lahore, Pakistan | Company timezone `Asia/Karachi` (UTC+5, no DST). Currency PKR. |
| Brand | Blue `#2563eb`, gold accent `#b8863a`, fonts Inter + Sora, dark and light logo variants | Saved in `docs/brand/`. Used for the UI theme and payslip PDF header. |

### 1.2 Actors

| Actor | Description |
|---|---|
| **Employee** | Has exactly one `employee` profile. Sees only their own data. |
| **Administrator** | HR/management. Full control over employees, schedules, attendance, leave, payroll, settings. |
| **System** | Scheduled job that finalizes each day's attendance (marks Absent / Weekly Off / Holiday) and enforces windows. |

The request names two roles. The role column is an enum so a third role (e.g. `MANAGER` with approve-leave-only rights, or `PAYROLL_ADMIN`) can be added later without schema changes.

### 1.3 Functional requirements — Employee

| # | Requirement | Notes / derived requirements |
|---|---|---|
| E1 | Log in securely | Email + password, Argon2id hashing, server-side sessions, lockout, forced password change on first login. |
| E2 | View personal profile | Name, contact, emergency contact, ID document number, photo. Employee can edit a **small allow-listed subset** (phone, address, emergency contact); everything else admin-only. |
| E3 | View employment information | Employee code, department, designation, employment type, join date, reporting manager, current work schedule, salary (current base — see Q7). |
| E4 | Mark attendance once per working day | One `attendance_records` row per `(employee_id, attendance_date)` enforced by a DB unique constraint, not just app logic. |
| E5 | Attendance only inside the configured window | Window comes from the employee's **work schedule** (shift start ± configurable minutes). Server time is authoritative; client clock is ignored. |
| E6 | View complete attendance history | Paginated, filterable by month/status. |
| E7 | View current month attendance summary | Counts by status + projected salary impact. |
| E8 | View calculated salary for current month | Two states: **Projected** (live estimate from attendance so far) until payroll is run, then **Final** (from the payslip). Must be labelled clearly. |
| E9 | View previous salary records | List of finalized payslips. |
| E10 | Download payslips | PDF generated server-side from the **immutable payslip snapshot**, never from live data. |
| E11 | Submit leave requests | Date range, leave type, reason; server validates overlap, balance, past dates policy. |
| E12 | View leave request status | Pending / Approved / Rejected / Cancelled with reviewer note. |

### 1.4 Functional requirements — Administrator

| # | Requirement | Notes / derived requirements |
|---|---|---|
| A1 | Create employees | Creates `users` + `employees` atomically; issues temporary password (see Q6). |
| A2 | Edit employee information | Full edit; all changes audit-logged (before/after). |
| A3 | Activate / deactivate employees | Deactivation revokes all sessions immediately, blocks login and attendance, keeps history intact. Never hard-delete. |
| A4 | Set employee salary | **Effective-dated** salary records so historical payroll re-runs use the salary valid in that month. |
| A5 | Set working schedule | Named schedule templates (shift times, weekly offs, window offsets) assigned to employees with effective dates. |
| A6 | Configure attendance windows | Part of schedule templates + optional global overrides (e.g. "office closed today"). |
| A7 | View today's attendance | Live board: who has checked in, late, not yet marked, on leave, off. |
| A8 | View attendance by employee | Calendar/list view for any employee, any range. |
| A9 | View attendance by date | Whole-company view for a date. |
| A10 | Correct attendance manually | Set/override status, check-in time, note. Original values kept in `attendance_corrections`. Corrections to a **finalized** payroll month are blocked unless the run is reopened. |
| A11 | Approve / reject leave requests | On approval, `LEAVE` attendance rows are written for the covered working days (idempotent). |
| A12 | Run monthly payroll | Draft → review → finalize. Draft can be re-run; finalized is immutable. |
| A13 | View salary calculations | Per-employee breakdown showing every input (days, rates, rules) used. |
| A14 | Add bonuses | Ad-hoc earning adjustments for a period, applied at run. |
| A15 | Add deductions | Ad-hoc deduction adjustments for a period (advance recovery, fines, tax). |
| A16 | Generate payslips | Produced at finalize; PDF downloadable by admin and the owning employee. |
| A17 | Export attendance & payroll reports | CSV and XLSX; filtered by date range / employee / department. |

### 1.5 Non-functional requirements

- **PostgreSQL** (required). Target PostgreSQL 16.
- **Configurable payroll**: the calculation engine reads a versioned `payroll_policies` row; nothing about rates or day-basis is a literal in code.
- **Strict isolation**: an employee can never read or write another employee's data. Enforced in the service layer (every employee-scoped query is filtered by the *session's* employee id, never by a client-supplied id) and optionally at the DB layer with Row-Level Security (Section 4.5).
- **Auditability**: every admin mutation and every attendance/payroll change is written to `audit_logs`.
- **Timezone correctness**: all instants stored as `timestamptz`; the *attendance date* is a `date` computed in the company timezone using the shift-start rule (Section 5.1).
- **Money**: `numeric(14,2)`; never floats. Rounding mode is part of the payroll policy.
- Production-ready: migrations, seed, tests (unit for the payroll engine, integration for RBAC), Docker deployment, health check, structured logs, backups documented.

---

## 2. Database schema (PostgreSQL 16)

Conventions: `uuid` primary keys (`gen_random_uuid()`), `created_at`/`updated_at timestamptz`, soft-disable via `is_active` rather than deletes for people-data, enums as PostgreSQL `enum` types. Tables are shown grouped by domain for readability; a few foreign keys reference tables defined later (e.g. `attendance_records.leave_request_id`, `payroll_adjustments.payslip_id`) and are added as `ALTER TABLE … ADD CONSTRAINT` in the migration.

### 2.1 Entity overview

```
users 1──1 employees ──* employee_salaries        (effective-dated)
                     ──* employee_schedules ──1 work_schedules
                     ──* attendance_records ──* attendance_corrections
                     ──* leave_requests ──1 leave_types
                     ──* leave_balances
                     ──* payroll_adjustments
                     ──* payslips ──1 payroll_runs ──1 payroll_policies (snapshot)
departments 1──* employees
holidays
company_settings
sessions, password_reset_tokens, audit_logs
```

### 2.2 Enums

```sql
CREATE TYPE user_role          AS ENUM ('ADMIN', 'EMPLOYEE');
CREATE TYPE employment_type    AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'PROBATION');
CREATE TYPE attendance_status  AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY', 'WEEKLY_OFF');
CREATE TYPE attendance_source  AS ENUM ('SELF', 'ADMIN', 'SYSTEM', 'LEAVE_APPROVAL');
CREATE TYPE leave_status       AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE adjustment_type    AS ENUM ('BONUS', 'DEDUCTION');
CREATE TYPE payroll_run_status AS ENUM ('DRAFT', 'FINALIZED', 'REOPENED');
CREATE TYPE salary_basis       AS ENUM ('WORKING_DAYS', 'CALENDAR_DAYS', 'FIXED_DIVISOR');
CREATE TYPE late_penalty_mode  AS ENUM ('NONE', 'LATES_TO_ABSENT', 'FIXED_AMOUNT', 'FRACTION_OF_DAY');
CREATE TYPE audit_action       AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
                                        'ATTENDANCE_MARK', 'ATTENDANCE_CORRECT', 'LEAVE_REVIEW',
                                        'PAYROLL_RUN', 'PAYROLL_FINALIZE', 'PAYROLL_REOPEN', 'EXPORT');
```

### 2.3 Identity & access

```sql
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  password_hash         text   NOT NULL,                 -- Argon2id
  role                  user_role NOT NULL DEFAULT 'EMPLOYEE',
  is_active             boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT true,
  failed_login_attempts int     NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,                     -- sha256 of the opaque cookie value
  ip_address   inet,
  user_agent   text,
  expires_at   timestamptz NOT NULL,                     -- absolute expiry
  last_seen_at timestamptz NOT NULL DEFAULT now(),       -- for idle timeout
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 2.4 Organisation & employees

```sql
CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id),
  employee_code      text NOT NULL UNIQUE,               -- e.g. NT-0042
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  phone              text,
  personal_email     citext,
  national_id        text,                               -- CNIC; encrypted at rest at app layer (Q10)
  date_of_birth      date,
  gender             text,
  address            text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  avatar_url         text,
  department_id      uuid REFERENCES departments(id),
  designation        text,
  employment_type    employment_type NOT NULL DEFAULT 'FULL_TIME',
  manager_id         uuid REFERENCES employees(id),
  joined_at          date NOT NULL,
  probation_ends_at  date,
  terminated_at      date,
  is_active          boolean NOT NULL DEFAULT true,      -- mirrors users.is_active; kept for queries
  bank_name          text,
  bank_account_no    text,                               -- masked in UI, admin-only
  bank_account_title text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON employees (department_id);
CREATE INDEX ON employees (is_active);

-- Effective-dated base salary + recurring components.
CREATE TABLE employee_salaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  base_salary    numeric(14,2) NOT NULL CHECK (base_salary >= 0),
  currency       char(3) NOT NULL DEFAULT 'PKR',
  effective_from date NOT NULL,
  effective_to   date,                                   -- NULL = current
  reason         text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&)
);

-- Fixed monthly allowances / recurring deductions attached to a salary record
-- (e.g. Medical allowance, Fuel allowance, Provident fund). Optional in v1 but cheap to include.
CREATE TABLE salary_components (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_id   uuid NOT NULL REFERENCES employee_salaries(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        adjustment_type NOT NULL,                  -- BONUS = earning, DEDUCTION = deduction
  amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
  is_prorated boolean NOT NULL DEFAULT false             -- prorate with attendance like base salary?
);
```

### 2.5 Schedules, attendance windows, holidays

```sql
CREATE TABLE work_schedules (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL UNIQUE,        -- "Day shift 9–6", "US Night 8pm–5am"
  timezone                  text NOT NULL DEFAULT 'Asia/Karachi',
  shift_start               time NOT NULL,               -- local wall-clock time
  shift_end                 time NOT NULL,               -- may be < shift_start => crosses midnight
  working_days              smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO: 1=Mon … 7=Sun; others = WEEKLY_OFF
  checkin_opens_min_before  int NOT NULL DEFAULT 60,     -- window opens 60 min before shift start
  late_after_min            int NOT NULL DEFAULT 15,     -- grace: check-in after start+15 => LATE
  half_day_after_min        int NOT NULL DEFAULT 240,    -- check-in after start+240 => HALF_DAY
  checkin_closes_after_min  int NOT NULL DEFAULT 480,    -- after start+480 no self check-in => ABSENT
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (late_after_min <= half_day_after_min AND half_day_after_min <= checkin_closes_after_min)
);

CREATE TABLE employee_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  schedule_id    uuid NOT NULL REFERENCES work_schedules(id),
  effective_from date NOT NULL,
  effective_to   date,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&)
);

CREATE TABLE holidays (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date      date NOT NULL UNIQUE,
  name      text NOT NULL,
  is_paid   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One-off overrides, e.g. "office closed 2026-09-15 due to weather", or an extended window for everyone.
CREATE TABLE attendance_window_overrides (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                      date NOT NULL,
  schedule_id               uuid REFERENCES work_schedules(id),  -- NULL = all schedules
  checkin_opens_min_before  int,
  late_after_min            int,
  half_day_after_min        int,
  checkin_closes_after_min  int,
  reason                    text,
  created_by                uuid NOT NULL REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, schedule_id)
);
```

### 2.6 Attendance

```sql
CREATE TABLE attendance_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id),
  attendance_date   date NOT NULL,                       -- "working day" in company TZ (Section 5.1)
  status            attendance_status NOT NULL,
  check_in_at       timestamptz,                         -- NULL for ABSENT/LEAVE/HOLIDAY/WEEKLY_OFF
  minutes_late      int,
  source            attendance_source NOT NULL,
  marked_by_user_id uuid REFERENCES users(id),           -- who created the row
  leave_request_id  uuid REFERENCES leave_requests(id),  -- set when status = LEAVE
  note              text,
  ip_address        inet,
  is_locked         boolean NOT NULL DEFAULT false,      -- true once the month's payroll is FINALIZED
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date)                  -- "once per working day" enforced by DB
);
CREATE INDEX ON attendance_records (attendance_date);
CREATE INDEX ON attendance_records (employee_id, attendance_date DESC);

-- Full history of admin corrections (append-only).
CREATE TABLE attendance_corrections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id  uuid NOT NULL REFERENCES attendance_records(id),
  previous_status       attendance_status,
  previous_check_in_at  timestamptz,
  new_status            attendance_status NOT NULL,
  new_check_in_at       timestamptz,
  reason                text NOT NULL,
  corrected_by          uuid NOT NULL REFERENCES users(id),
  corrected_at          timestamptz NOT NULL DEFAULT now()
);
```

### 2.7 Leave

```sql
CREATE TABLE leave_types (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE,               -- Annual, Sick, Casual, Unpaid
  code               text NOT NULL UNIQUE,
  is_paid            boolean NOT NULL DEFAULT true,
  annual_quota_days  numeric(5,1),                       -- NULL = unlimited (e.g. Unpaid)
  min_notice_days    int NOT NULL DEFAULT 0,
  allow_half_day     boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true
);

CREATE TABLE leave_balances (                            -- per-year allocation; usage computed from approved requests
  employee_id    uuid NOT NULL REFERENCES employees(id),
  leave_type_id  uuid NOT NULL REFERENCES leave_types(id),
  year           smallint NOT NULL,
  allocated_days numeric(5,1) NOT NULL,
  adjustment_days numeric(5,1) NOT NULL DEFAULT 0,       -- manual admin credit/debit
  PRIMARY KEY (employee_id, leave_type_id, year)
);

CREATE TABLE leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  leave_type_id   uuid NOT NULL REFERENCES leave_types(id),
  start_date      date NOT NULL,
  end_date        date NOT NULL CHECK (end_date >= start_date),
  is_half_day     boolean NOT NULL DEFAULT false,
  working_days    numeric(5,1) NOT NULL,                 -- computed server-side, excludes weekly offs/holidays
  reason          text NOT NULL,
  status          leave_status NOT NULL DEFAULT 'PENDING',
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON leave_requests (employee_id, status);
CREATE INDEX ON leave_requests (status) WHERE status = 'PENDING';
-- No two APPROVED/PENDING requests may overlap for the same employee:
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE leave_requests ADD CONSTRAINT no_overlapping_leave
  EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('PENDING','APPROVED'));
```

### 2.8 Payroll

```sql
-- Versioned policy. Payroll for month M uses the policy effective on the 1st of M.
CREATE TABLE payroll_policies (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  effective_from            date NOT NULL UNIQUE,
  salary_basis              salary_basis NOT NULL DEFAULT 'WORKING_DAYS',
  fixed_divisor             int CHECK (fixed_divisor > 0),        -- used when basis = FIXED_DIVISOR (e.g. 30 or 26)
  count_holidays_as_paid    boolean NOT NULL DEFAULT true,
  count_weekly_off_as_paid  boolean NOT NULL DEFAULT true,        -- relevant for CALENDAR_DAYS basis
  absent_deduction_days     numeric(4,2) NOT NULL DEFAULT 1.00,   -- days deducted per ABSENT
  half_day_deduction_days   numeric(4,2) NOT NULL DEFAULT 0.50,
  unpaid_leave_deduction_days numeric(4,2) NOT NULL DEFAULT 1.00,
  late_penalty_mode         late_penalty_mode NOT NULL DEFAULT 'LATES_TO_ABSENT',
  lates_per_absent          int,                                  -- e.g. 3 lates = 1 absent
  late_penalty_amount       numeric(14,2),                        -- FIXED_AMOUNT mode
  late_penalty_day_fraction numeric(4,2),                         -- FRACTION_OF_DAY mode
  late_grace_count          int NOT NULL DEFAULT 0,               -- first N lates per month are free
  prorate_new_joiners       boolean NOT NULL DEFAULT true,        -- joined mid-month => days before join not paid
  rounding_mode             text NOT NULL DEFAULT 'HALF_UP',      -- HALF_UP | FLOOR | CEIL
  rounding_precision        int  NOT NULL DEFAULT 0,              -- 0 = whole rupees
  currency                  char(3) NOT NULL DEFAULT 'PKR',
  created_by                uuid NOT NULL REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Ad-hoc bonuses / deductions for a period (entered before or during the DRAFT run).
CREATE TABLE payroll_adjustments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  period_year  smallint NOT NULL,
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  kind         adjustment_type NOT NULL,
  category     text NOT NULL,                            -- Performance bonus, Advance recovery, Tax, Fine…
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  description  text,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  payslip_id   uuid REFERENCES payslips(id)              -- set once consumed by a finalized run
);
CREATE INDEX ON payroll_adjustments (period_year, period_month, employee_id);

CREATE TABLE payroll_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year     smallint NOT NULL,
  period_month    smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status          payroll_run_status NOT NULL DEFAULT 'DRAFT',
  policy_id       uuid NOT NULL REFERENCES payroll_policies(id),
  policy_snapshot jsonb NOT NULL,                        -- frozen copy of the policy used
  employee_count  int NOT NULL DEFAULT 0,
  total_gross     numeric(14,2) NOT NULL DEFAULT 0,
  total_net       numeric(14,2) NOT NULL DEFAULT 0,
  run_by          uuid NOT NULL REFERENCES users(id),
  run_at          timestamptz NOT NULL DEFAULT now(),
  finalized_by    uuid REFERENCES users(id),
  finalized_at    timestamptz,
  reopened_by     uuid REFERENCES users(id),
  reopened_at     timestamptz,
  reopen_reason   text,
  notes           text,
  UNIQUE (period_year, period_month)
);

CREATE TABLE payslips (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id        uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees(id),
  payslip_number        text NOT NULL UNIQUE,            -- NT-2026-09-0042
  -- snapshots (so a payslip is reproducible even if the employee record changes later)
  employee_snapshot     jsonb NOT NULL,                  -- name, code, designation, department, bank
  salary_snapshot       jsonb NOT NULL,                  -- base + components in effect
  -- attendance inputs
  calendar_days         int NOT NULL,
  working_days          int NOT NULL,
  payable_days          numeric(6,2) NOT NULL,
  present_days          int NOT NULL,
  late_days             int NOT NULL,
  half_days             int NOT NULL,
  absent_days           int NOT NULL,
  paid_leave_days       numeric(5,1) NOT NULL,
  unpaid_leave_days     numeric(5,1) NOT NULL,
  holiday_days          int NOT NULL,
  weekly_off_days       int NOT NULL,
  -- money
  per_day_rate          numeric(14,4) NOT NULL,
  base_earned           numeric(14,2) NOT NULL,
  components_earned     numeric(14,2) NOT NULL DEFAULT 0,
  attendance_deduction  numeric(14,2) NOT NULL DEFAULT 0,
  late_deduction        numeric(14,2) NOT NULL DEFAULT 0,
  bonuses_total         numeric(14,2) NOT NULL DEFAULT 0,
  deductions_total      numeric(14,2) NOT NULL DEFAULT 0,
  gross_pay             numeric(14,2) NOT NULL,
  net_pay               numeric(14,2) NOT NULL,
  currency              char(3) NOT NULL,
  breakdown             jsonb NOT NULL,                  -- ordered line items + every rule applied (for the UI and PDF)
  generated_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,                     -- set when a REOPENED run is re-finalized; old payslip kept for audit
  UNIQUE (payroll_run_id, employee_id, generated_at)
);
CREATE UNIQUE INDEX payslips_current_uq ON payslips (payroll_run_id, employee_id) WHERE superseded_at IS NULL;
CREATE INDEX ON payslips (employee_id);
```

### 2.9 Settings & audit

```sql
CREATE TABLE company_settings (          -- single-row table (id = 1 enforced)
  id                    int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name          text NOT NULL DEFAULT 'Nexus-Tel',
  timezone              text NOT NULL DEFAULT 'Asia/Karachi',
  currency              char(3) NOT NULL DEFAULT 'PKR',
  default_schedule_id   uuid REFERENCES work_schedules(id),
  attendance_ip_allowlist cidr[],        -- NULL/empty = no IP restriction (Q8)
  payslip_footer        text,
  updated_by            uuid REFERENCES users(id),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  actor_role    user_role,
  action        audit_action NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  before_data   jsonb,
  after_data    jsonb,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (entity_type, entity_id);
CREATE INDEX ON audit_logs (actor_user_id, created_at DESC);
```

Sensitive fields are redacted before being written to `before_data`/`after_data` (password hashes never; national ID and bank account masked).

---

## 3. Application architecture

### 3.1 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Runtime / framework | **Next.js 15 (App Router) + TypeScript**, single deployable | One codebase for UI + API, server components keep data on the server, small team/ops footprint. |
| Database access | **Prisma** (schema + migrations) | Type-safe queries, migration tooling. Raw SQL escape hatch for the few gist/exclusion constraints Prisma cannot express (added as a custom migration). |
| Validation | **Zod** at every API boundary | Shared schemas between client forms and server handlers. |
| Auth | Custom session auth (Argon2id + opaque cookie + `sessions` table) | Full control over revocation and lockout; no third-party IdP required. Can add SSO later. |
| UI | Tailwind CSS + shadcn/ui, brand tokens (`#2563eb`, `#b8863a`, Inter/Sora) | Fast, accessible, consistent. |
| PDF | `@react-pdf/renderer` (server-side) | Payslips rendered from the snapshot; no headless browser needed. |
| Exports | `exceljs` (XLSX) + streaming CSV | Attendance and payroll reports. |
| Jobs | `scripts/finalize-attendance.ts` run by cron (container cron / systemd timer / pg_cron-triggered HTTP) + lazy fallback at read time | Daily materialisation of ABSENT / WEEKLY_OFF / HOLIDAY rows. |
| Tests | Vitest (payroll engine, window logic, RBAC), Playwright (login, attendance, admin flows) | The payroll engine is a pure function → exhaustively unit-tested. |
| Packaging | Docker (multi-stage) + `docker-compose.yml` (app + PostgreSQL 16) | Runs on any VPS; also works with managed Postgres. |

**Alternative considered:** separate NestJS REST API + React SPA. Cleaner API surface if a mobile app is planned soon, at the cost of two deployables and duplicated types. Recommendation: start with the Next.js monolith with a strict service layer; the service layer can be lifted into a standalone API later if needed.

### 3.2 Layering

```
src/
  app/                      # Next.js routes (thin)
    (auth)/login, change-password
    (employee)/dashboard, attendance, leave, salary, profile
    (admin)/admin/…         # employees, attendance, leave, payroll, schedules, settings, reports, audit
    api/…                   # JSON route handlers for mutations, exports, PDFs, health
  server/
    auth/                   # password hashing, session create/verify/revoke, lockout, rate limit
    rbac/                   # requireUser(), requireAdmin(), requireEmployeeSelf(); Actor type
    services/               # ALL business logic; every function takes (actor, input)
      employees.ts, schedules.ts, attendance.ts, leave.ts, payroll/engine.ts, payroll/run.ts,
      payslips.ts, reports.ts, settings.ts, audit.ts
    jobs/finalize-attendance.ts
    db/                     # prisma client, transaction helpers
  lib/                      # zod schemas, date/tz helpers (date-fns-tz), money helpers (decimal.js)
  components/               # UI
prisma/                     # schema.prisma, migrations/, seed.ts
docs/                       # this document, runbooks
```

Rules:
1. **Route handlers and server components never touch Prisma directly.** They resolve the `Actor` from the session and call a service.
2. **Every service function receives the `Actor`** (`{ userId, role, employeeId }`) and applies authorization itself. Authorization is therefore enforced even if a route forgets to.
3. Employee-facing services have no `employeeId` parameter — they use `actor.employeeId`. There is structurally no way to ask for someone else's data.
4. Admin services log to `audit_logs` inside the same transaction as the mutation.

### 3.3 Key flows

**Mark attendance (employee)**
1. `POST /api/attendance/mark` → `requireEmployeeSelf()`.
2. Service: `now = clock.now()` (server). Resolve the employee's schedule effective today. Compute the *working day* and window for that schedule (Section 5.1). Reject if: employee inactive, outside window, day is WEEKLY_OFF/HOLIDAY/approved LEAVE, IP not in allowlist (if configured), or a row already exists (DB unique constraint is the final guard — a concurrent duplicate becomes a friendly "already marked" error).
3. Compute status PRESENT / LATE / HALF_DAY from `minutes_late` vs thresholds. Insert row with `source = SELF`, audit log.

**Daily finalization (system job)**
For each active employee and each date from their last finalized date to *yesterday* (company TZ), insert a missing row as HOLIDAY, WEEKLY_OFF, LEAVE (if approved leave covers it) or ABSENT. Idempotent (`ON CONFLICT DO NOTHING`). Also runs lazily inside "month summary" and "payroll run" so a missed cron never corrupts payroll.

**Leave approval (admin)**
Transaction: set status APPROVED → for each working day in the range upsert `attendance_records` with `LEAVE` (skipping days already locked by a finalized payroll → surfaced as a warning) → audit. Rejection just updates status. Employee may cancel a PENDING request, or an APPROVED one whose start date is in the future (which deletes the LEAVE rows).

**Payroll run (admin)**
1. `POST /api/admin/payroll/runs` for (year, month) → creates/replaces DRAFT run. Fails if month is still in progress unless `allowPartial` (needed for mid-month previews) — the default UI only runs completed months.
2. Ensure attendance is finalized for the month (calls finalization).
3. For each employee active during the month: gather attendance counts, effective salary, components, adjustments → `computePayslip(policy, inputs)` (pure function) → write `payslips`.
4. Admin reviews; can edit adjustments and re-run the draft any number of times.
5. `POST …/finalize` → status FINALIZED, `is_locked = true` on the month's attendance rows, adjustments linked to payslips, payslip numbers assigned. Immutable thereafter.
6. `POST …/reopen` (admin, reason required) → status REOPENED, unlocks attendance; re-running produces a new set of payslips that **supersede** the previous ones; old ones are kept with `superseded_at` set, for audit.

**Projected salary (employee dashboard)**
Same `computePayslip()` with attendance to date + remaining scheduled days assumed PRESENT, labelled "Projected — final figure depends on the payroll run".

---

## 4. Security model

### 4.1 Authentication
- Email + password. Passwords hashed with **Argon2id** (memory 64 MB, iterations 3). Minimum 10 chars, checked against a common-password list.
- Admin creates the account with a random temporary password shown once; `must_change_password = true` forces a change at first login. (Email delivery of invites/reset links is optional — see Q6.)
- **Sessions**: 256-bit random opaque token in an `httpOnly; Secure; SameSite=Lax; Path=/` cookie; only its SHA-256 is stored. Idle timeout 12 h, absolute 30 days (configurable). Server-side revocation on logout, password change, deactivation, and "sign out everywhere".
- **Brute-force protection**: per-account lockout after 5 failures (15 min, escalating) + per-IP rate limit on `/api/auth/login`. Failed and successful logins are audit-logged.
- Optional TOTP 2FA for admin accounts (Phase 6).

### 4.2 Authorization (RBAC)
Two roles, enforced at three points:

| Point | Mechanism |
|---|---|
| Edge (`middleware.ts`) | Redirects unauthenticated users; blocks `/admin/**` and `/api/admin/**` for non-admins. Convenience only — **not** relied on (Next.js middleware bypass CVE-2025-29927 is the reason). |
| Route handler / server component | `const actor = await requireAdmin()` or `requireEmployeeSelf()` as the first line. |
| Service layer | Re-checks the actor; employee-scoped queries are filtered by `actor.employeeId`. |

Permission matrix (v1):

| Capability | EMPLOYEE | ADMIN |
|---|---|---|
| Own profile read / limited edit | ✔ | ✔ (any) |
| Own attendance mark / read | ✔ | ✔ (any, + correct) |
| Own leave create / cancel / read | ✔ | ✔ (any, + approve/reject) |
| Own payslips / projected salary | ✔ | ✔ (any) |
| Employees CRUD, salaries, schedules | ✖ | ✔ |
| Attendance windows, holidays, policies, settings | ✖ | ✔ |
| Payroll runs, adjustments, exports, audit log | ✖ | ✔ |
| Manage admin accounts | ✖ | ✔ (cannot deactivate the last active admin or self) |

### 4.3 Data isolation guarantees (the "never another employee's data" rule)
1. Employee API routes carry **no employee identifier**: `/api/me/attendance`, `/api/me/payslips/:payslipId`. Where a resource id is accepted (payslip, leave request), the service loads it **and** asserts `resource.employee_id === actor.employeeId`, returning 404 (not 403) to avoid existence leaks.
2. Admin routes live under a separate prefix and are the only place employee ids appear.
3. Integration tests: for every employee endpoint, a test logs in as employee A and attempts to access B's resources by id → must get 404.
4. **Optional defence in depth (Phase 6): PostgreSQL Row-Level Security.** The app sets `SET LOCAL app.current_employee_id` / `app.current_role` per transaction and RLS policies on `attendance_records`, `leave_requests`, `payslips`, `employee_salaries` restrict EMPLOYEE role to its own rows. Even a service-layer bug then cannot leak data.

### 4.4 Web security
- CSRF: `SameSite=Lax` cookie + `Origin`/`Sec-Fetch-Site` check on every state-changing request; JSON-only bodies.
- Headers: strict CSP (self + Google Fonts), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- All input validated with Zod; Prisma parameterises SQL. Uploaded avatars (if enabled) are type-sniffed and size-limited.
- Secrets via environment only; `.env.example` committed, `.env` never.
- Structured logging (pino) with PII redaction; request ids.

### 4.5 Data protection
- National ID and bank account numbers encrypted at the application layer (AES-256-GCM with a key from env) and masked in UI/logs.
- Payslip PDFs generated on demand and streamed — nothing is written to disk or a public bucket.
- Finalized payroll and locked attendance are immutable; changes require an audited "reopen".
- Backups: documented `pg_dump` cron + retention in the runbook.

---

## 5. Attendance & payroll rules (configurable)

### 5.1 Working day and window (handles shifts crossing midnight)
For an employee whose schedule has `shift_start = 20:00`, `shift_end = 05:00`, `checkin_opens_min_before = 60`, `late_after_min = 15`, `half_day_after_min = 240`, `checkin_closes_after_min = 480`, in `Asia/Karachi`:

- The **attendance date** is the local date on which the shift *starts*. A check-in at 01:30 on 12 Sep belongs to the working day **11 Sep** if it falls within 11 Sep's window.
- Window for day D: opens `D 19:00`, on-time until `D 20:15`, LATE until `D 24:00`, HALF_DAY until `D+1 04:00`, closed after that (⇒ ABSENT unless corrected).
- To resolve "which day is `now` in?", the service evaluates the windows of *yesterday* and *today* and picks the one containing `now` (they cannot overlap because the constraint `checkin_closes_after_min + checkin_opens_min_before ≤ 24h` is validated on save).
- Per-date overrides (`attendance_window_overrides`) take precedence over the schedule's defaults.

### 5.2 Status derivation
| Condition | Status |
|---|---|
| Date not in `working_days` | WEEKLY_OFF |
| Date in `holidays` | HOLIDAY |
| Covered by APPROVED leave | LEAVE |
| Checked in ≤ start + `late_after_min` | PRESENT |
| Checked in ≤ start + `half_day_after_min` | LATE |
| Checked in ≤ start + `checkin_closes_after_min` | HALF_DAY |
| No check-in and window closed | ABSENT |
| Anything, set by admin | as chosen (audited) |

### 5.3 Payroll formula (all parameters from `payroll_policies`)
```
divisor       = WORKING_DAYS  → scheduled working days in month (excl. weekly offs; holidays counted if count_holidays_as_paid)
              | CALENDAR_DAYS → days in month
              | FIXED_DIVISOR → fixed_divisor (e.g. 30)
per_day_rate  = base_salary / divisor
effective_lates     = max(0, late_days − late_grace_count)
late_deduction      = mode NONE            → 0
                    | LATES_TO_ABSENT      → floor(effective_lates / lates_per_absent) × per_day_rate
                    | FIXED_AMOUNT         → effective_lates × late_penalty_amount
                    | FRACTION_OF_DAY      → effective_lates × late_penalty_day_fraction × per_day_rate
attendance_deduction = (absent_days × absent_deduction_days
                      + half_days × half_day_deduction_days
                      + unpaid_leave_days × unpaid_leave_deduction_days) × per_day_rate
                      + (days before join / after termination when prorate_new_joiners) × per_day_rate
base_earned   = base_salary − attendance_deduction − late_deduction   (floored at 0)
gross_pay     = base_earned + components(earnings, prorated if flagged) + Σ bonuses
net_pay       = gross_pay − components(deductions) − Σ deductions
rounded per rounding_mode / rounding_precision at the end; every intermediate value recorded in payslips.breakdown
```
The engine is a pure function `computePayslip(policy, inputs) → PayslipResult` with a table-driven test suite covering each basis and penalty mode, mid-month joiners/leavers, and a month with zero working days.

---

## 6. Implementation plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundation** (½ day) | Repo scaffold, Next.js + TS + Prisma, Docker Compose (app + Postgres 16), CI (lint, typecheck, test), `.env.example`, brand theme, seed script (admin, departments, leave types, default schedule, default payroll policy, sample employees). | `docker compose up` gives a running login page; seed creates an admin. |
| **1. Auth & people** (1 day) | Login/logout/change password, sessions, lockout, RBAC guards, audit logging; admin: employees CRUD, activate/deactivate, departments, salary history; employee: profile & employment info. | RBAC integration tests pass (employee A cannot see B). |
| **2. Schedules & attendance** (1–1.5 days) | Work schedules, employee schedule assignment, holidays, overrides; employee mark attendance + history + monthly summary; admin today board, by-employee, by-date, manual correction; finalization job. | Window/status unit tests incl. midnight-crossing shifts; duplicate-mark test hits DB constraint. |
| **3. Leave** (½–1 day) | Leave types, balances, request/cancel, approve/reject, LEAVE attendance rows. | Overlap constraint test; approval writes correct working days only. |
| **4. Payroll** (1.5 days) | Payroll policies UI, adjustments, run/draft/finalize/reopen, payslip breakdown view, projected salary, payslip PDF. | Engine test matrix green; finalized data provably immutable. |
| **5. Reports & exports** (½ day) | Attendance CSV/XLSX (range, employee, dept), payroll register CSV/XLSX, per-run summary. | Exports reconcile with on-screen totals. |
| **6. Hardening & ops** (½–1 day) | Security headers, rate limiting, RLS policies, admin TOTP (optional), health endpoint, backup runbook, README/deployment docs, Playwright smoke suite. | Security review checklist complete. |

Estimated total: ~6–7 working days of implementation for a single agent, delivered incrementally by phase on branch `claude/nexus-tel-employee-portal-xa798f`.

---

## 7. Open questions, assumptions and risks

Each item lists the **default I will use if you don't say otherwise**. Confirming or overriding these is the only input needed to begin coding.

### 7.1 Decisions that change the build materially

| # | Question | Default assumption |
|---|---|---|
| **Q1** | **Tech stack.** Not specified beyond PostgreSQL. | Next.js 15 + TypeScript + Prisma + Tailwind, Docker Compose deployment (Section 3.1). |
| **Q2** | **Check-in only, or check-in + check-out?** "Mark attendance once per working day" reads as a single check-in. Without check-out there is no worked-hours data, so Half Day can only come from a late check-in or admin correction. | Check-in only. Schema leaves room for a `check_out_at` column later. |
| **Q3** | **Night shifts crossing midnight.** As an outbound agency serving US/UK clients, shifts like 20:00–05:00 are likely. | Supported: the working day is the date the shift starts (Section 5.1). |
| **Q4** | **Salary basis default and penalty rules.** You asked for working-days vs calendar-days to be configurable. Defaults for absent/half-day/late treatment still need a starting value. | Basis = WORKING_DAYS; absent = 1 day, half day = 0.5 day, unpaid leave = 1 day; 3 lates = 1 absent with 0 grace lates; holidays and weekly offs paid. All editable in Admin → Payroll Policy. |
| **Q5** | **Leave types and quotas.** Not specified. | Annual 14 (paid), Sick 8 (paid), Casual 10 (paid), Unpaid (unlimited, deducted). Quotas per calendar year, no carry-forward in v1. Editable. |
| **Q6** | **Email delivery.** Password resets and invites need SMTP; no mail provider was mentioned. | No email in v1: admin generates a temporary password and shares it; "forgot password" is admin-assisted reset. SMTP support is a small add-on if you provide a provider. |
| **Q7** | **Should employees see their base salary on the employment-info page?** Some companies show only payslips. | Yes, show current base salary and components (they appear on payslips anyway). |
| **Q8** | **Attendance location control.** Nothing stops an employee marking attendance from home. | Off by default; optional office IP/CIDR allowlist in settings. Geolocation/selfie/biometric are out of scope. |
| **Q9** | **Deployment target.** VPS with Docker, or a PaaS (Vercel/Railway) with managed Postgres? Affects the cron job design. | Docker Compose on a VPS; cron runs inside the app container. The job is also invocable via an authenticated HTTP endpoint so a PaaS scheduler works too. |
| **Q10** | **Which personal fields to collect.** CNIC, bank details, DOB are standard for Pakistani payroll but are sensitive. | Collected, encrypted at rest, admin-only, masked in UI. |

### 7.2 Assumptions (stated, low risk)

- Single company, single legal entity, single currency (PKR), single timezone for the org; each schedule still carries its own timezone field for future remote staff.
- Payroll period = calendar month. Payroll is run after the month ends; mid-month "projected salary" is an estimate.
- Salary is a fixed monthly amount (no hourly staff). Overtime, commissions and income tax slabs are **not** modelled beyond generic bonus/deduction adjustments. Commission for sales agents is a likely future ask — the `payroll_adjustments.category` field and per-run import can absorb it initially.
- Admins are trusted; there is no maker/checker approval on payroll finalization in v1 (the audit log records who did what).
- No existing data to migrate; employees will be created in the portal. A CSV import can be added if you have an existing roster.
- Employee cannot edit or delete an attendance record once created; only admin corrections apply.

### 7.3 Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Missed/failed nightly finalization job | Absent days not recorded → payroll under-deducts | Idempotent job + lazy finalization on read and before every payroll run; health check exposes last successful run. |
| Timezone / DST bugs | Wrong day marked, wrong Late status | `timestamptz` everywhere, one `toWorkingDay()` helper with exhaustive tests; Pakistan has no DST but the helper uses IANA tz regardless. |
| Admin edits after payroll is finalized | Payslip no longer matches data | Attendance rows locked; payslips store full snapshots; reopen is explicit and audited. |
| Floating-point money errors | Off-by-one rupee disputes | `numeric` in DB, `decimal.js` in engine, rounding only at the end and recorded. |
| IDOR / horizontal privilege escalation | Salary leak between employees | Structural (no employee id on employee routes), service-layer checks, 404 on foreign ids, RBAC test suite, optional RLS. |
| Next.js middleware bypass | Unauthenticated access to admin pages | Middleware is convenience only; every handler and service re-authorizes. |
| Race on double check-in (two tabs) | Duplicate rows | DB unique constraint is the arbiter; second insert becomes "already marked". |
| Weak temporary passwords / shared credentials | Account takeover | Random 16-char temp passwords, forced change, lockout, session revocation, optional admin TOTP. |
| Scope creep (overtime, commissions, tax, biometrics) | Delays v1 | Explicitly out of scope; extension points noted above. |

---

## Appendix A — Screens (v1)

**Employee:** Login · Change password · Dashboard (today's window status, mark attendance button, month summary, projected salary) · Attendance history · Leave (balances, new request, my requests) · Salary (payslips list, download PDF) · Profile & employment info.

**Admin:** Dashboard (today's attendance board, pending leave, payroll status) · Employees (list, create, edit, salary history, schedule assignment, activate/deactivate) · Attendance (today, by date, by employee, correct) · Schedules & windows (templates, overrides, holidays) · Leave (queue, approve/reject, leave types) · Payroll (policy, adjustments, runs, payslips) · Reports (attendance export, payroll register export) · Settings (company, IP allowlist, admins) · Audit log.

## Appendix B — Brand assets
`docs/brand/nexus-tel-icon-dark.png`, `docs/brand/nexus-tel-icon-light.png` (732×899, from nexus-tel.com). Primary `#2563eb`, accent `#b8863a`, fonts Inter (body) and Sora (headings).


---

## Appendix C — Implementation notes (post-build)

The application was built to this design with the defaults from Section 7. Deviations and clarifications:

- **Mutations use Next.js Server Actions** (`src/server/actions/*`) instead of JSON route handlers. Every action still resolves the actor from the session and delegates to the same service layer; route handlers remain for downloads (PDF, CSV/XLSX), the health check and the scheduled job. Server Actions carry Next's built-in origin check, which covers the CSRF requirement.
- **Times of day are stored as minutes after midnight** (`shift_start_min`, `shift_end_min`) rather than `time` columns, which keeps window arithmetic and midnight-crossing logic simple.
- **Sensitive identifiers** (`national_id`, `bank_account_no`) are stored as `*_encrypted` + `*_last4` columns; the plaintext is never persisted.
- **Payslips** carry `superseded_at`; re-running a reopened month supersedes rather than deletes finalized payslips. Draft payslips are replaced.
- **Row-Level Security** (optional Phase 6 item) was not enabled; isolation is enforced structurally in the service layer and verified by the integration tests in `tests/integration.test.ts`.
- **Half-day leave** counts as 0.5 leave days in payroll; the other half is treated as worked.
- **Admin TOTP** was left out of v1.
