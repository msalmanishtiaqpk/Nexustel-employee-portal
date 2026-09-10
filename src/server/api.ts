import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

export function handleApiError(e: unknown): NextResponse {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  logger.error({ err: e }, "Unhandled API error");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function fileResponse(body: Buffer | string, filename: string, contentType: string): NextResponse {
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]+/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
