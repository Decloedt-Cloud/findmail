import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { integrationStatus } from "@/lib/config";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs/actions";
import { verifySchema } from "@/lib/schemas";
import { ApiError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`verify:${user.id}`, 20, 60 * 60 * 1000);
    const status = integrationStatus();
    if (!status.verification.configured) {
      throw new ApiError(
        503,
        "Email verification is not configured. Set EMAIL_VERIFICATION_PROVIDER to zerobounce or neverbounce and provide EMAIL_VERIFICATION_API_KEY. No test emails are sent, and nothing was marked verified.",
      );
    }
    const input = verifySchema.parse(await readJson(request));
    const emails = await prisma.emailContact.findMany({ where: { id: { in: input.emailIds } }, select: { id: true } });
    if (emails.length === 0) throw new ApiError(404, "No email contacts were found");
    const job = await prisma.processingJob.create({
      data: {
        type: "VERIFY_EMAILS",
        name: `Verify ${emails.length} email${emails.length === 1 ? "" : "s"}`,
        userId: user.id,
        payload: { emailIds: emails.map((email) => email.id) },
        totalRecords: emails.length,
      },
    });
    await queueJob(job.id);
    await audit(user.id, "email.verify", "processingJob", job.id, { count: emails.length });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
