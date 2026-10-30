import { afterEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const updateMany = vi.fn();
const del = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    creator: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      delete: (...args: unknown[]) => del(...args),
    },
    jobItem: {
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

import { discardCreatorIfUnreachable, hasPublicContact } from "@/lib/creators/contact";

describe("hasPublicContact", () => {
  it("ignores a zero usable email count without socials", () => {
    expect(hasPublicContact({ emailCount: 0 })).toBe(false);
  });

  it("accepts a usable email or a filled social url", () => {
    expect(hasPublicContact({ emailCount: 1 })).toBe(true);
    expect(hasPublicContact({ instagramUrl: " https://instagram.com/x " })).toBe(true);
    expect(hasPublicContact({ twitterUrl: "" })).toBe(false);
  });
});

describe("discardCreatorIfUnreachable", () => {
  afterEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
    del.mockReset();
  });

  it("keeps a creator with usable email and channel icp", async () => {
    findUnique.mockResolvedValue({
      id: "c1",
      channelIcp: { name: "Audience" },
      instagramUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      emails: [{ id: "e1" }],
    });
    expect(await discardCreatorIfUnreachable("c1")).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it("drops a creator with only INVALID emails and no socials", async () => {
    findUnique.mockResolvedValue({
      id: "c1",
      channelIcp: { name: "Audience" },
      instagramUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      emails: [],
    });
    expect(await discardCreatorIfUnreachable("c1")).toBe(true);
    expect(updateMany).toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("drops a creator missing channel icp even with contact", async () => {
    findUnique.mockResolvedValue({
      id: "c1",
      channelIcp: null,
      instagramUrl: "https://instagram.com/x",
      twitterUrl: null,
      tiktokUrl: null,
      emails: [],
    });
    expect(await discardCreatorIfUnreachable("c1")).toBe(true);
    expect(del).toHaveBeenCalled();
  });
});
