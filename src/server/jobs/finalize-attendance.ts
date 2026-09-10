/**
 * Nightly job: materialise ABSENT / WEEKLY_OFF / HOLIDAY / LEAVE rows up to yesterday.
 * Run with `npm run job:finalize-attendance` (cron) or POST /api/jobs/finalize-attendance.
 */
import { finalizeAllUpToYesterday } from "@/server/services/attendance";
import { prisma } from "@/server/db";

async function main() {
  const res = await finalizeAllUpToYesterday();
  console.log(JSON.stringify({ job: "finalize-attendance", ...res, at: new Date().toISOString() }));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
