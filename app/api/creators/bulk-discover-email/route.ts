import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs/actions";
import { bulkDiscoverSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`email-discovery:${user.id}`, 30, 60 * 60 * 1000);
    const input = bulkDiscoverSchema.parse(await readJson(request));
    const creators = await prisma.creator.findMany({
      where: { id: { in: input.creatorIds }, hidden: false },
      select: { id: true },
    });
    if (creators.length === 0) {
      return NextResponse.json({ error: "No matching creators were found" }, { status: 404 });
    }
    const job = await prisma.processingJob.create({
      data: {
        type: "EXTRACT_EMAILS",
        name: `Find public emails for ${creators.length} creators`,
        userId: user.id,
        payload: { creatorIds: creators.map((creator) => creator.id) },
        totalRecords: creators.length,
      },
    });
    await queueJob(job.id);
    await audit(user.id, "email.discover.bulk", "processingJob", job.id, { creators: creators.length });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
