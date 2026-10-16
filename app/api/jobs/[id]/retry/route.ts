import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { retryJob } from "@/lib/jobs/actions";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const job = await retryJob(id, user.id);
    return NextResponse.json({ job });
  } catch (error) {
    return jsonError(error);
  }
}
