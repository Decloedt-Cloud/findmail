import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, jsonError, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs/actions";

async function queueEmailDiscovery(userId: string, creatorIds: string[], name: string) {
  const creators = await prisma.creator.findMany({ where: { id: { in: creatorIds }, hidden: false }, select: { id: true } });
  if (creators.length === 0) throw new ApiError(404, "No matching creators were found");
  const job = await prisma.processingJob.create({
    data: {
      type: "EXTRACT_EMAILS",
      name,
      userId,
      payload: { creatorIds: creators.map((creator) => creator.id) },
      totalRecords: creators.length,
    },
  });
  await queueJob(job.id);
  await audit(userId, "email.discover", "processingJob", job.id, { creators: creators.length });
  return job;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`email-discovery:${user.id}`, 30, 60 * 60 * 1000);
    const { id } = await context.params;
    const job = await queueEmailDiscovery(user.id, [id], "Find public email");
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
