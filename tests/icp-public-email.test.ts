import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  applyEmailOutcome: vi.fn(),
  fetchPublicPage: vi.fn(),
  fetchPublicText: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { creator: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/jobs/discover", () => ({
  applyEmailOutcome: mocks.applyEmailOutcome,
}));
vi.mock("@/lib/email/crawl", () => ({
  fetchPublicPage: mocks.fetchPublicPage,
  fetchPublicText: mocks.fetchPublicText,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: () => undefined, error: () => undefined, warn: () => undefined },
}));

import { discoverPublicEmail } from "@/lib/icp/public-email";

const creator = {
  id: "creator-1",
  description: "Partnerships: ada@brand.test",
  channelUrl: "https://www.youtube.com/channel/abc",
  officialWebsiteUrl: null,
  emailSearchStatus: "NOT_SEARCHED",
};

describe("discoverPublicEmail", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.applyEmailOutcome.mockReset();
    mocks.fetchPublicPage.mockReset();
    mocks.fetchPublicText.mockReset();
    mocks.applyEmailOutcome.mockResolvedValue(1);
  });

  it("leaves a channel that was already searched", async () => {
    mocks.findUnique.mockResolvedValue({ ...creator, emailSearchStatus: "FOUND" });
    await expect(discoverPublicEmail(creator.id)).resolves.toEqual({ skipped: true });
    expect(mocks.applyEmailOutcome).not.toHaveBeenCalled();
    expect(mocks.fetchPublicPage).not.toHaveBeenCalled();
  });

  it("stores an email published in the channel description without opening a website", async () => {
    mocks.findUnique.mockResolvedValue(creator);
    const result = await discoverPublicEmail(creator.id);
    expect(result).toMatchObject({ skipped: false, found: 1, stored: 1 });
    expect(mocks.applyEmailOutcome).toHaveBeenCalledWith(
      creator.id,
      expect.objectContaining({ officialWebsiteUrl: null }),
      [expect.objectContaining({ normalizedEmail: "ada@brand.test", sourceType: "CHANNEL_DESCRIPTION" })],
      expect.objectContaining({ instagram: null, twitter: null, tiktok: null }),
    );
    expect(mocks.fetchPublicPage).not.toHaveBeenCalled();
  });

  it("reads the public site when the description links to one", async () => {
    mocks.findUnique.mockResolvedValue({
      ...creator,
      description: "Site https://brand.test",
    });
    mocks.fetchPublicText.mockResolvedValue({ ok: true, url: "https://brand.test/robots.txt", status: 404, body: "" });
    mocks.fetchPublicPage.mockResolvedValue({
      ok: true,
      url: "https://brand.test/",
      status: 200,
      body: "<html><title>Brand</title><a href=\"mailto:press@brand.test\">Press</a><a href=\"https://www.instagram.com/brand\">Instagram</a><a href=\"https://x.com/brand\">X</a></html>",
    });
    const result = await discoverPublicEmail(creator.id);
    expect(result).toMatchObject({ skipped: false, found: 1 });
    expect(mocks.fetchPublicPage).toHaveBeenCalled();
    expect(mocks.applyEmailOutcome).toHaveBeenCalledWith(
      creator.id,
      expect.objectContaining({ officialWebsiteUrl: "https://brand.test" }),
      [expect.objectContaining({ normalizedEmail: "press@brand.test" })],
      expect.objectContaining({
        instagram: "https://www.instagram.com/brand",
        twitter: "https://x.com/brand",
        tiktok: null,
      }),
    );
  });
});
