#!/bin/sh
# Tiny scheduler sidecar: calls the finalization job every night at 03:30 company time (default Asia/Karachi = 22:30 UTC).
# Override with CRON_HOUR_UTC / CRON_MINUTE_UTC.
HOUR=${CRON_HOUR_UTC:-22}; MIN=${CRON_MINUTE_UTC:-30}
echo "cron sidecar: finalize-attendance daily at ${HOUR}:${MIN} UTC"
while true; do
  now_h=$(date -u +%H); now_m=$(date -u +%M)
  if [ "$now_h" -eq "$HOUR" ] && [ "$now_m" -eq "$MIN" ]; then
    echo "$(date -u +%FT%TZ) running finalize-attendance"
    curl -fsS -X POST -H "Authorization: Bearer ${JOB_SECRET}" "${APP_INTERNAL_URL:-http://app:3000}/api/jobs/finalize-attendance" || echo "job call failed"
    sleep 61
  fi
  sleep 20
done
