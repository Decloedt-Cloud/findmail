import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { brandIcp: { updateMany: mocks.updateMany } },
}));

import { failIcpMatchForJob } from "@/lib/icp/fail";

describe("failIcpMatchForJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("closes only a profile still queued or running for this job", async () => {
    await failIcpMatchForJob("job-1", "The job stalled.");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { processingJobId: "job-1", status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", errorSummary: "The job stalled." },
    });
  });

  it("keeps the stored error short", async () => {
    await failIcpMatchForJob("job-1", "x".repeat(2000));

    const data = mocks.updateMany.mock.calls[0][0].data;
    expect(data.errorSummary).toHaveLength(800);
  });
});
