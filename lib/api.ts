import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { ApiError, type SessionUser } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";

export { ApiError, assertCanAccess, type SessionUser } from "@/lib/authz";

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new ApiError(401, "Authentication required");
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role === "ADMIN" ? "ADMIN" : "MEMBER",
  };
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ApiError(403, "Administrator access is required");
  return user;
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const result = await rateLimit(key, limit, windowMs, getRedis());
  if (!result.ok) {
    throw new ApiError(429, "Too many requests. Please wait and try again.", {
      retryAfterMs: result.retryAfterMs,
    });
  }
}

export function jsonError(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, details: error.details ?? null }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid input", details: error.flatten() }, { status: 400 });
  }
  logger.error("request failed", { message: error instanceof Error ? error.message : "unknown" });
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Request body must be JSON");
  }
}
