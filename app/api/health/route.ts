import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { redisStatus } from "@/lib/redis";

export async function GET() {
  try {
    let database: "ok" | "down" = "down";
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch {
      database = "down";
    }
    const redis = await redisStatus();
    const status = database === "ok" ? "ok" : "down";
    return NextResponse.json(
      {
        status: database === "ok" && redis === "ok" ? "ok" : database === "ok" ? "degraded" : "down",
        database,
        redis,
        time: new Date().toISOString(),
      },
      { status: status === "down" ? 503 : 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
