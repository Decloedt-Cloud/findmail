import { describe, expect, it } from "vitest";
import { findInFileDuplicates, mapImportRows, parseCsv, suggestMapping, toCsv } from "@/lib/csv";
import { exportCells } from "@/lib/jobs/export";

describe("csv import", () => {
  it("maps flexible headers and reports duplicate channel ids", () => {
    const table = parseCsv("Channel Name,Subscribers,Email\nAda,1000,ada@brand.com\n");
    const mapping = suggestMapping(table[0] ?? []);
    const mapped = mapImportRows(table, mapping);
    expect(mapped.rows[0]?.channelName).toBe("Ada");
    expect(mapped.rows[0]?.subscriberCount).toBe(1000);
    expect(mapped.rows[0]?.email).toBe("ada@brand.com");
    const duplicates = findInFileDuplicates([
      { ...mapped.rows[0]!, channelId: "UC1234567890123456789012" },
      { ...mapped.rows[0]!, rowNumber: 3, channelId: "UC1234567890123456789012" },
    ]);
    expect(duplicates).toHaveLength(1);
  });

  it("rejects a bad subscriber count before import", () => {
    const mapped = mapImportRows(
      [
        ["subscriber_count"],
        ["nope"],
      ],
      { 0: "subscriber_count" },
    );
    expect(mapped.errors[0]?.message).toMatch(/positive number/);
  });
});

describe("csv export", () => {
  it("escapes commas, quotes, unicode, and formula characters", () => {
    const csv = toCsv(
      ["channel_name", "business_email"],
      [["=HYPERLINK(\"x\")", "ada, \"lead\"@brand.com"], ["Émile", "hello@brand.com"]],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"ada, ""lead""@brand.com"`);
    expect(csv).toContain("Émile");
  });

  it("leaves hidden subscriber counts blank", () => {
    const cells = exportCells(
      {
        channelName: "Ada",
        youtubeChannelId: "UC1",
        channelUrl: "https://www.youtube.com/channel/UC1",
        country: null,
        niche: "AI Tools",
        subscriberCount: null,
        subscriberVisibility: "HIDDEN",
        officialWebsiteUrl: null,
        emailSearchStatus: "NOT_FOUND",
      },
      null,
    );
    expect(cells).toHaveLength(15);
    expect(cells[0]).toBe("Ada");
    expect(cells[1]).toBe("");
    expect(cells[3]).toBe("");
    expect(cells[5]).toBe("");
    expect(cells[6]).toBe("");
  });

  it("matches the YouTube Email Finder column order", () => {
    const cells = exportCells(
      {
        channelName: "Linus Tech Tips",
        youtubeChannelId: "UC1",
        channelUrl: "https://www.youtube.com/@LinusTechTips",
        country: "CA",
        niche: "Tech",
        subscriberCount: 16900000,
        subscriberVisibility: "PUBLIC",
        officialWebsiteUrl: "https://www.lttstore.com/",
        emailSearchStatus: "FOUND",
        channelHandle: "@LinusTechTips",
        averageViews: 1791499,
        lastActiveAt: "2026-10-12T17:25:25.000Z",
        instagramUrl: null,
        twitterUrl: null,
        tiktokUrl: null,
        matchedVideoTitle: "THE NEW GeForce",
        matchedVideoUrl: "https://www.youtube.com/watch?v=abc",
        matchedVideoViews: 1200000,
        matchedVideoPublishedAt: "2026-10-12T17:25:25.000Z",
      },
      {
        emailAddress: "partnerships@linusmediagroup.com",
        verificationStatus: "SYNTAX_VALID",
        sourceUrl: "https://www.youtube.com/@LinusTechTips",
        discoveredAt: new Date("2026-10-13T00:00:00.000Z"),
      },
    );
    expect(cells).toEqual([
      "Linus Tech Tips",
      "LinusTechTips",
      "https://www.youtube.com/@LinusTechTips",
      16900000,
      1791499,
      "partnerships@linusmediagroup.com",
      "https://www.lttstore.com/",
      "",
      "",
      "",
      "2026-10-12T17:25:25+00:00",
      "THE NEW GeForce",
      "https://www.youtube.com/watch?v=abc",
      1200000,
      "2026-10-12T17:25:25+00:00",
    ]);
  });
});
