import { describe, expect, it } from "vitest";
import { parseDomainSelection } from "@/lib/icp/select-creators";

const allowed = new Set(["fashion", "travel", "weak", "unsupported"]);

function response(decisions: unknown[]) {
  return JSON.stringify({ decisions });
}

describe("parseDomainSelection", () => {
  it("keeps only strongly supported same-domain or direct-subdomain channels", () => {
    const parsed = parseDomainSelection(
      response([
        {
          id: "fashion",
          path: "fashion/apparel/streetwear",
          label: "Streetwear",
          evidence: ["Recent videos cover outfits and streetwear styling."],
          audienceFit: "strong",
          confidence: 0.94,
        },
        {
          id: "travel",
          path: "travel/destinations/general",
          label: "Travel",
          evidence: ["Recent videos publish destination guides."],
          audienceFit: "weak",
          confidence: 0.99,
        },
        {
          id: "weak",
          path: "fashion/apparel/general",
          label: "Fashion",
          evidence: ["One keyword says style."],
          audienceFit: "strong",
          confidence: 0.84,
        },
      ]),
      allowed,
      10,
    );

    expect(parsed.decisions.map((decision) => decision.creatorId)).toEqual(["fashion", "travel"]);
  });

  it("rejects a bare id list without domains, evidence, and confidence", () => {
    expect(
      parseDomainSelection(
        JSON.stringify({ creatorIds: ["fashion"] }),
        allowed,
        10,
      ),
    ).toEqual({ decisions: [] });
  });

  it("rejects a path outside the canonical taxonomy", () => {
    const parsed = parseDomainSelection(
      response([
        {
          id: "fashion",
          path: "made/up/domain",
          label: "Fashion",
          evidence: ["Fashion tutorials"],
          audienceFit: "strong",
          confidence: 0.99,
        },
      ]),
      allowed,
      10,
    );

    expect(parsed).toEqual({ decisions: [] });
  });

  it("rejects a high-confidence claim without channel evidence", () => {
    const parsed = parseDomainSelection(
      response([
        {
          id: "unsupported",
          path: "fashion/apparel/general",
          label: "Fashion",
          evidence: [],
          audienceFit: "strong",
          confidence: 0.99,
        },
      ]),
      allowed,
      10,
    );

    expect(parsed.decisions).toEqual([]);
  });
});
