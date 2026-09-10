import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { safeEqual } from "@/lib/crypto";
import { finalizeAllUpToYesterday } from "@/server/services/attendance";
import { handleApiError } from "@/server/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Trigger the nightly finalization. Authorised by `Authorization: Bearer <JOB_SECRET>`. */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!config.jobSecret || config.jobSecret === "change-me" || !token || !safeEqual(token, config.jobSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await finalizeAllUpToYesterday());
  } catch (e) {
    return handleApiError(e);
  }
}
