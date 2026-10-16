import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { listCreators } from "@/lib/creators/query";
import { creatorQuerySchema } from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const input = creatorQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const result = await listCreators(
      {
        q: input.q,
        country: input.country,
        niche: input.niche,
        emailStatus: input.emailStatus,
        minSubscribers: input.minSubscribers,
        maxSubscribers: input.maxSubscribers,
        hasEmail: input.hasEmail,
        listId: input.listId,
        ids: input.ids?.split(",").filter(Boolean),
        jobId: input.jobId,
      },
      input.page,
      input.pageSize,
      input.sort,
      input.direction,
    );
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
