-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'PROBATION');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY', 'WEEKLY_OFF');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('SELF', 'ADMIN', 'SYSTEM', 'LEAVE_APPROVAL');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('BONUS', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED', 'REOPENED');

-- CreateEnum
CREATE TYPE "SalaryBasis" AS ENUM ('WORKING_DAYS', 'CALENDAR_DAYS', 'FIXED_DIVISOR');

-- CreateEnum
CREATE TYPE "LatePenaltyMode" AS ENUM ('NONE', 'LATES_TO_ABSENT', 'FIXED_AMOUNT', 'FRACTION_OF_DAY');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('HALF_UP', 'FLOOR', 'CEIL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'ATTENDANCE_MARK', 'ATTENDANCE_CORRECT', 'LEAVE_REVIEW', 'PAYROLL_RUN', 'PAYROLL_FINALIZE', 'PAYROLL_REOPEN', 'EXPORT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "personal_email" TEXT,
    "national_id_encrypted" TEXT,
    "national_id_last4" TEXT,
    "date_of_birth" DATE,
    "gender" TEXT,
    "address" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "department_id" UUID,
    "designation" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "manager_id" UUID,
    "joined_at" DATE NOT NULL,
    "probation_ends_at" DATE,
    "terminated_at" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "bank_name" TEXT,
    "bank_account_encrypted" TEXT,
    "bank_account_last4" TEXT,
    "bank_account_title" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "base_salary" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salary_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "is_prorated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "shift_start_min" INTEGER NOT NULL,
    "shift_end_min" INTEGER NOT NULL,
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "checkin_opens_min_before" INTEGER NOT NULL DEFAULT 60,
    "late_after_min" INTEGER NOT NULL DEFAULT 15,
    "half_day_after_min" INTEGER NOT NULL DEFAULT 240,
    "checkin_closes_after_min" INTEGER NOT NULL DEFAULT 480,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_window_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "schedule_id" UUID,
    "checkin_opens_min_before" INTEGER,
    "late_after_min" INTEGER,
    "half_day_after_min" INTEGER,
    "checkin_closes_after_min" INTEGER,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_window_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "check_in_at" TIMESTAMPTZ(6),
    "minutes_late" INTEGER,
    "source" "AttendanceSource" NOT NULL,
    "marked_by_user_id" UUID,
    "leave_request_id" UUID,
    "note" TEXT,
    "ip_address" TEXT,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_record_id" UUID NOT NULL,
    "previous_status" "AttendanceStatus",
    "previous_check_in_at" TIMESTAMPTZ(6),
    "new_status" "AttendanceStatus" NOT NULL,
    "new_check_in_at" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    "corrected_by" UUID NOT NULL,
    "corrected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "annual_quota_days" DECIMAL(5,1),
    "min_notice_days" INTEGER NOT NULL DEFAULT 0,
    "allow_half_day" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "allocated_days" DECIMAL(5,1) NOT NULL,
    "adjustment_days" DECIMAL(5,1) NOT NULL DEFAULT 0,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("employee_id","leave_type_id","year")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_half_day" BOOLEAN NOT NULL DEFAULT false,
    "working_days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "salary_basis" "SalaryBasis" NOT NULL DEFAULT 'WORKING_DAYS',
    "fixed_divisor" INTEGER,
    "count_holidays_as_paid" BOOLEAN NOT NULL DEFAULT true,
    "count_weekly_off_as_paid" BOOLEAN NOT NULL DEFAULT true,
    "absent_deduction_days" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    "half_day_deduction_days" DECIMAL(4,2) NOT NULL DEFAULT 0.50,
    "unpaid_leave_deduction_days" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    "late_penalty_mode" "LatePenaltyMode" NOT NULL DEFAULT 'LATES_TO_ABSENT',
    "lates_per_absent" INTEGER DEFAULT 3,
    "late_penalty_amount" DECIMAL(14,2),
    "late_penalty_day_fraction" DECIMAL(4,2),
    "late_grace_count" INTEGER NOT NULL DEFAULT 0,
    "prorate_new_joiners" BOOLEAN NOT NULL DEFAULT true,
    "rounding_mode" "RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "rounding_precision" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "kind" "AdjustmentType" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payslip_id" UUID,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "policy_id" UUID NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "run_by" UUID NOT NULL,
    "run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_by" UUID,
    "finalized_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopen_reason" TEXT,
    "notes" TEXT,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payroll_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "payslip_number" TEXT,
    "employee_snapshot" JSONB NOT NULL,
    "salary_snapshot" JSONB NOT NULL,
    "calendar_days" INTEGER NOT NULL,
    "working_days" INTEGER NOT NULL,
    "payable_days" DECIMAL(6,2) NOT NULL,
    "present_days" INTEGER NOT NULL,
    "late_days" INTEGER NOT NULL,
    "half_days" INTEGER NOT NULL,
    "absent_days" INTEGER NOT NULL,
    "paid_leave_days" DECIMAL(5,1) NOT NULL,
    "unpaid_leave_days" DECIMAL(5,1) NOT NULL,
    "holiday_days" INTEGER NOT NULL,
    "weekly_off_days" INTEGER NOT NULL,
    "per_day_rate" DECIMAL(14,4) NOT NULL,
    "base_earned" DECIMAL(14,2) NOT NULL,
    "components_earned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "components_deducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "attendance_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "late_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bonuses_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross_pay" DECIMAL(14,2) NOT NULL,
    "net_pay" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "company_name" TEXT NOT NULL DEFAULT 'Nexus-Tel',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "default_schedule_id" UUID,
    "attendance_ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payslip_footer" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "UserRole",
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_is_active_idx" ON "employees"("is_active");

-- CreateIndex
CREATE INDEX "employee_salaries_employee_id_effective_from_idx" ON "employee_salaries"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_name_key" ON "work_schedules"("name");

-- CreateIndex
CREATE INDEX "employee_schedules_employee_id_effective_from_idx" ON "employee_schedules"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_window_overrides_date_schedule_id_key" ON "attendance_window_overrides"("date", "schedule_id");

-- CreateIndex
CREATE INDEX "attendance_records_attendance_date_idx" ON "attendance_records"("attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employee_id_attendance_date_key" ON "attendance_records"("employee_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_name_key" ON "leave_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

-- CreateIndex
CREATE INDEX "leave_requests_employee_id_status_idx" ON "leave_requests"("employee_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_policies_effective_from_key" ON "payroll_policies"("effective_from");

-- CreateIndex
CREATE INDEX "payroll_adjustments_period_year_period_month_employee_id_idx" ON "payroll_adjustments"("period_year", "period_month", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_period_year_period_month_key" ON "payroll_runs"("period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payslip_number_key" ON "payslips"("payslip_number");

-- CreateIndex
CREATE INDEX "payslips_employee_id_idx" ON "payslips"("employee_id");

-- CreateIndex
CREATE INDEX "payslips_payroll_run_id_employee_id_idx" ON "payslips"("payroll_run_id", "employee_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_salary_id_fkey" FOREIGN KEY ("salary_id") REFERENCES "employee_salaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "work_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_window_overrides" ADD CONSTRAINT "attendance_window_overrides_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "work_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "payroll_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_default_schedule_id_fkey" FOREIGN KEY ("default_schedule_id") REFERENCES "work_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written constraints (not expressible in the Prisma schema language)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Effective-dated salary records may not overlap for the same employee.
ALTER TABLE "employee_salaries"
  ADD CONSTRAINT "employee_salaries_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);

-- Effective-dated schedule assignments may not overlap for the same employee.
ALTER TABLE "employee_schedules"
  ADD CONSTRAINT "employee_schedules_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);

-- Pending/approved leave requests may not overlap for the same employee.
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&)
  WHERE ("status" IN ('PENDING', 'APPROVED'));

-- Only one current (non-superseded) payslip per employee per run.
CREATE UNIQUE INDEX "payslips_current_uq" ON "payslips" ("payroll_run_id", "employee_id") WHERE "superseded_at" IS NULL;

-- Schedule sanity checks.
ALTER TABLE "work_schedules"
  ADD CONSTRAINT "work_schedules_thresholds_chk"
  CHECK ("late_after_min" <= "half_day_after_min" AND "half_day_after_min" <= "checkin_closes_after_min"
         AND "checkin_opens_min_before" >= 0 AND "checkin_opens_min_before" + "checkin_closes_after_min" <= 1440
         AND "shift_start_min" BETWEEN 0 AND 1439 AND "shift_end_min" BETWEEN 0 AND 1439);

ALTER TABLE "payroll_policies"
  ADD CONSTRAINT "payroll_policies_divisor_chk" CHECK ("fixed_divisor" IS NULL OR "fixed_divisor" > 0);
ALTER TABLE "payroll_adjustments"
  ADD CONSTRAINT "payroll_adjustments_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payroll_adjustments"
  ADD CONSTRAINT "payroll_adjustments_month_chk" CHECK ("period_month" BETWEEN 1 AND 12);
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_month_chk" CHECK ("period_month" BETWEEN 1 AND 12);
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_dates_chk" CHECK ("end_date" >= "start_date");
ALTER TABLE "employee_salaries"
  ADD CONSTRAINT "employee_salaries_amount_chk" CHECK ("base_salary" >= 0);
ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_singleton_chk" CHECK ("id" = 1);
