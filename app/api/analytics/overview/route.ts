import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { analyticsOverview } from "@/lib/analytics";

export async function GET() {
  try {
    await requireUser();
    const overview = await analyticsOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return jsonError(error);
  }
}
