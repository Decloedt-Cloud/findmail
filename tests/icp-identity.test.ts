import { describe, expect, it } from "vitest";
import { icpIdentityKey, uniqueIcpOptions, uniqueIcpsByName } from "@/lib/icp/identity";
import { chooseIcpMerge } from "@/lib/icp/merge-duplicates";

function row(id: string, status: "COMPLETED" | "FAILED" | "RUNNING", channelCount: number, createdAt: number) {
  return {
    id,
    brandName: "Vetup",
    websiteUrl: "https://vetup.com",
    status,
    matchedChannelCount: channelCount,
    createdAt: new Date(createdAt),
    channelCount,
  };
}

describe("icp identity", () => {
  it("treats the same brand and host as one ICP", () => {
    expect(icpIdentityKey("Vetup", "https://www.vetup.com/")).toBe(icpIdentityKey("vetup", "http://vetup.com"));
  });

  it("keeps the first copy of a repeated brand", () => {
    expect(uniqueIcpsByName([
      { id: "a", brandName: "Wayo" },
      { id: "b", brandName: "wayo" },
      { id: "c", brandName: "Astelventures" },
    ]).map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("keeps a finished ICP and drops the copy, never a search in progress", () => {
    const older = row("old", "COMPLETED", 4, 1);
    const newer = row("new", "FAILED", 0, 2);
    const running = row("run", "RUNNING", 0, 3);
    expect(chooseIcpMerge([older, newer])?.keep.id).toBe("old");
    expect(chooseIcpMerge([older, newer])?.drop.map((item) => item.id)).toEqual(["new"]);
    expect(chooseIcpMerge([running, older])?.drop.map((item) => item.id)).toEqual(["old"]);
    expect(chooseIcpMerge([running, { ...running, id: "run-2" }])).toBeNull();
  });

  it("keeps one filter option per brand and site", () => {
    expect(uniqueIcpOptions([
      { id: "new", brandName: "Vetup", websiteUrl: "https://vetup.com" },
      { id: "old", brandName: "Vetup", websiteUrl: "https://www.vetup.com/" },
      { id: "other", brandName: "Wayo", websiteUrl: "https://wayo-ads.com" },
    ]).map((row) => row.id)).toEqual(["new", "other"]);
  });
});
