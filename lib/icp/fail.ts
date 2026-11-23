import { prisma } from "@/lib/db";

/**
 * Closes the brand profile when its matching job fails outside the run's own catch
 * (worker killed, lock stalled, redeploy). Without this, the profile stays QUEUED or
 * RUNNING forever and Wayo keeps showing "Searching with these queries".
 */
export async function failIcpMatchForJob(processingJobId: string, message: string) {
  await prisma.brandIcp.updateMany({
    where: { processingJobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", errorSummary: message.slice(0, 800) },
  });
}
