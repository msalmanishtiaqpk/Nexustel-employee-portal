export const config = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  isProd: process.env.NODE_ENV === "production",
  sessionIdleHours: Number(process.env.SESSION_IDLE_HOURS ?? 12),
  sessionAbsoluteHours: Number(process.env.SESSION_ABSOLUTE_HOURS ?? 720),
  jobSecret: process.env.JOB_SECRET ?? "",
  cookieName: "nt_session",
  login: {
    maxFailures: 5,
    lockMinutes: 15,
    ipLimitPerMinute: 20,
  },
};
