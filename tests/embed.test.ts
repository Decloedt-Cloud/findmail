import { describe, expect, it } from "vitest";
import { channelEmbeddingText, hashedEmbedding, l2Normalize } from "@/lib/icp/embed";

describe("hashedEmbedding", () => {
  it("returns a stable unit vector", () => {
    const first = hashedEmbedding("veterinary clinics and patient records");
    const second = hashedEmbedding("veterinary clinics and patient records");
    expect(first).toHaveLength(768);
    expect(first).toEqual(second);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("moves when the topic changes", () => {
    const clinic = hashedEmbedding("veterinary clinics and patient records");
    const games = hashedEmbedding("speedrun world records and game reviews");
    expect(clinic).not.toEqual(games);
  });
});

describe("channelEmbeddingText", () => {
  it("includes the channel audience profile", () => {
    const text = channelEmbeddingText({
      channelName: "Vet Clinic",
      description: "Records for vets",
      keywords: ["veterinary"],
      channelIcp: {
        name: "Clinic owners",
        description: "People who run a veterinary clinic",
        interests: ["patient records"],
        problems: [],
        goals: [],
        useCases: [],
        productCategories: [],
      },
    });
    expect(text).toContain("Vet Clinic");
    expect(text).toContain("Clinic owners");
    expect(text).toContain("patient records");
  });
});

describe("l2Normalize", () => {
  it("keeps a zero vector at zero", () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
