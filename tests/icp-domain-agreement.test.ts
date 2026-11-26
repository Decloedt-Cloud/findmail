import { describe, expect, it } from "vitest";
import { agreeDomainAudits } from "@/lib/icp/select-creators";
import { readDomainMatchAudit } from "@/lib/icp/domain-types";

const fashion = {
  creatorId: "fashion",
  path: "fashion/apparel/streetwear",
  label: "Streetwear",
  evidence: ["Recent videos cover outfits and streetwear styling."],
  audienceFit: "strong" as const,
  confidence: 0.94,
};

const travel = {
  creatorId: "travel",
  path: "travel/destinations/general",
  label: "Travel",
  evidence: ["Recent videos publish destination guides."],
  audienceFit: "strong" as const,
  confidence: 0.96,
};

describe("agreeDomainAudits", () => {
  it("keeps only channels both passes name with a strong same-domain path", () => {
    const audits = agreeDomainAudits({
      advertiserPath: "fashion/apparel/general",
      classifier: [fashion, travel],
      verifier: [
        { ...fashion, confidence: 0.91 },
        { ...travel, audienceFit: "weak" },
      ],
      model: "deepseek-chat",
      limit: 10,
    });
    expect(audits.map((audit) => audit.classifier.creatorId)).toEqual(["fashion"]);
    expect(audits[0]?.relationship).toBe("direct_subdomain");
  });

  it("rejects when the two passes disagree on the path", () => {
    const audits = agreeDomainAudits({
      advertiserPath: "fashion/apparel/general",
      classifier: [fashion],
      verifier: [{ ...fashion, path: "fashion/styling/general", label: "Styling" }],
      model: "deepseek-chat",
      limit: 10,
    });
    expect(audits).toEqual([]);
  });
});

describe("readDomainMatchAudit", () => {
  it("accepts a verified audit and rejects an incomplete one", () => {
    const audit = agreeDomainAudits({
      advertiserPath: "fashion/apparel/general",
      classifier: [fashion],
      verifier: [{ ...fashion, confidence: 0.9 }],
      model: "deepseek-chat",
      limit: 1,
    })[0];
    expect(readDomainMatchAudit(audit)?.classifier.creatorId).toBe("fashion");
    expect(readDomainMatchAudit({ ...audit, evidence: [] })).toBeNull();
  });
});
