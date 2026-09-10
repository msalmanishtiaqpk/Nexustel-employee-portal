import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const lastJob = await prisma.attendanceRecord.findFirst({ where: { source: "SYSTEM" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return NextResponse.json({ status: "ok", db: "ok", lastSystemAttendanceWrite: lastJob?.createdAt ?? null, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
