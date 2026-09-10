/**
 * Post-deploy smoke test: signs in as an admin and an employee, visits every page, and checks
 * that admin APIs are forbidden to employees. Requires `playwright` (devDependency) and a browser.
 *
 *   BASE=https://portal.example.com ADMIN_EMAIL=... ADMIN_PASSWORD=... EMPLOYEE_EMAIL=... EMPLOYEE_PASSWORD=... node scripts/smoke.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const creds = {
  admin: [process.env.ADMIN_EMAIL ?? "admin@nexus-tel.com", process.env.ADMIN_PASSWORD ?? ""],
  employee: [process.env.EMPLOYEE_EMAIL ?? "", process.env.EMPLOYEE_PASSWORD ?? ""],
};
const ADMIN_PAGES = ["/admin", "/admin/employees", "/admin/employees/new", "/admin/attendance", "/admin/leave", "/admin/leave/types", "/admin/payroll", "/admin/payroll/policy", "/admin/schedules", "/admin/schedules/new", "/admin/holidays", "/admin/reports", "/admin/settings", "/admin/audit"];
const EMPLOYEE_PAGES = ["/", "/attendance", "/leave", "/salary", "/profile"];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const problems = [];

async function run(label, [email, password], pages) {
  if (!email || !password) { console.log(`[${label}] skipped (no credentials)`); return null; }
  const page = await (await browser.newContext()).newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|fonts\./.test(m.text())) problems.push(`[${label}] console @ ${page.url()}: ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`[${label}] ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`, { waitUntil: "load" }); await page.waitForTimeout(500);
  await page.fill("#email", email); await page.fill("#password", password); await page.click("button:has-text('Sign in')");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  if (page.url().includes("change-password")) { problems.push(`[${label}] account still has a temporary password`); return page; }
  for (const p of pages) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "load" });
    const body = (await page.textContent("body")) ?? "";
    const bad = /Application error|Something went wrong/.test(body);
    console.log(`[${label}] ${res?.status()} ${p}${page.url().replace(BASE, "") !== p ? ` -> ${page.url().replace(BASE, "")}` : ""}${bad ? "  <-- ERROR" : ""}`);
    if (bad || (res && res.status() >= 400)) problems.push(`[${label}] ${res?.status()} ${p}`);
  }
  return page;
}

await run("admin", creds.admin, [...ADMIN_PAGES, ...EMPLOYEE_PAGES]);
const emp = await run("employee", creds.employee, [...EMPLOYEE_PAGES, "/admin"]);
if (emp) {
  const r1 = await emp.request.get(`${BASE}/api/admin/reports/attendance?from=2026-01-01&to=2026-01-31`);
  const r2 = await emp.request.get(`${BASE}/api/me/payslips/00000000-0000-0000-0000-000000000000/pdf`);
  console.log(`[employee] admin API -> ${r1.status()} (expect 403); unknown payslip -> ${r2.status()} (expect 404)`);
  if (r1.status() !== 403 || r2.status() !== 404) problems.push("isolation check failed");
}
console.log("\nPROBLEMS:", problems.length ? problems : "none");
await browser.close();
process.exit(problems.length ? 1 : 0);
