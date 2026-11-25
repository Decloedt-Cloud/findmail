import { describe, expect, it } from "vitest";
import { catalogCreatorIds, languageReuseFilter, rankChannelsForModel, sharesAdvertiserTopic } from "@/lib/icp/reuse";

describe("catalogCreatorIds", () => {
  it("keeps the model choice when it selected channels", () => {
    expect(catalogCreatorIds(["a", "b"], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("keeps the ranked channels when the model kept none", () => {
    expect(catalogCreatorIds([], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("sharesAdvertiserTopic", () => {
  it("keeps a channel that talks about the site topic", () => {
    expect(
      sharesAdvertiserTopic(
        "veterinary clinics managing patient records",
        "Veterinary medicine for clinic owners and their patients",
      ),
    ).toBe(true);
  });

  it("rejects a channel whose only shared words are generic", () => {
    expect(
      sharesAdvertiserTopic(
        "veterinary clinics managing patient records",
        "Best lifestyle videos and business marketing tips",
      ),
    ).toBe(false);
  });
});

describe("rankChannelsForModel", () => {
  it("puts the closest topic first and drops a channel that does not share it", () => {
    const ranked = rankChannelsForModel(
      "veterinary clinics managing patient records",
      [
        { id: "off", topic: "Best lifestyle videos and business marketing tips" },
        { id: "near", topic: "clinic patient care" },
        { id: "close", topic: "Veterinary clinics and patient records" },
      ],
      (channel) => channel.topic,
      40,
    );
    expect(ranked.map((channel) => channel.id)).toEqual(["close", "near"]);
  });

  it("sends only as many channels as the model call can read", () => {
    const channels = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      topic: "veterinary clinics and patient records",
    }));
    expect(rankChannelsForModel("veterinary patient records", channels, (channel) => channel.topic, 2)).toHaveLength(2);
  });
});

describe("languageReuseFilter", () => {
  it("does not filter when no language was chosen", () => {
    expect(languageReuseFilter([])).toBeNull();
    expect(languageReuseFilter(["", "  "])).toBeNull();
  });

  it("keeps a regional variant and a channel with no language stored", () => {
    expect(languageReuseFilter(["en", "EN"])).toEqual({
      OR: [
        { language: { equals: "en", mode: "insensitive" } },
        { language: { startsWith: "en-", mode: "insensitive" } },
        { language: null },
        { language: "" },
      ],
    });
  });
});
