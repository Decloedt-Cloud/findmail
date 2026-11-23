import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  emailFindUnique: vi.fn(),
  emailCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    creator: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    emailContact: { findUnique: mocks.emailFindUnique, create: mocks.emailCreate },
  },
  isUniqueViolation: (error: unknown) =>
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002",
}));

import { upsertMatchedChannel } from "@/lib/icp/store";

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed on the fields: (`youtubeChannelId`)"), { code: "P2002" });
}

const channel = {
  id: "UC_test",
  title: "Test channel",
  customUrl: "@testchannel",
  description: "",
  country: "FR",
  defaultLanguage: "fr",
  subscriberCount: 12_000,
  subscriberVisibility: "PUBLIC",
  videoCount: 40,
  viewCount: "2100000",
  thumbnailUrl: null,
  keywords: [],
} as never;

/** Each call that looks a row up by YouTube channel id gets the next answer in `lookups`. */
function scriptLookups(lookups: Array<{ id: string } | null>) {
  const queue = [...lookups];
  mocks.findUnique.mockImplementation(async ({ where }: { where: { youtubeChannelId?: string } }) =>
    where.youtubeChannelId !== undefined ? (queue.shift() ?? null) : null,
  );
}

describe("upsertMatchedChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "creator-1" });
  });

  it("creates the row when no run has saved the channel yet", async () => {
    scriptLookups([null]);
    mocks.create.mockResolvedValue({ id: "creator-1" });

    const result = await upsertMatchedChannel(channel, null);

    expect(result.created).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reads again and updates when another run created the row first", async () => {
    scriptLookups([null, { id: "creator-1" }]);
    mocks.create.mockRejectedValueOnce(uniqueViolation());
    mocks.update.mockResolvedValue({ id: "creator-1" });

    const result = await upsertMatchedChannel(channel, null);

    expect(result.created).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "creator-1" } }));
  });

  it("retries an update that hits a unique conflict, then succeeds", async () => {
    scriptLookups([{ id: "creator-1" }, { id: "creator-1" }]);
    mocks.update.mockRejectedValueOnce(uniqueViolation()).mockResolvedValue({ id: "creator-1" });

    const result = await upsertMatchedChannel(channel, null);

    expect(result.created).toBe(false);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("gives up after three conflicts and raises, so the caller can skip the channel", async () => {
    scriptLookups([null, null, null]);
    mocks.create.mockRejectedValue(uniqueViolation());

    await expect(upsertMatchedChannel(channel, null)).rejects.toThrow(/youtubeChannelId/);
    expect(mocks.create).toHaveBeenCalledTimes(3);
  });
});
