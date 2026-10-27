import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseChannelIcp, parseChannelIcp, writeChannelIcp } from "@/lib/icp/channel-icp";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseChannelIcp", () => {
  it("keeps the audience profile", () => {
    const profile = parseChannelIcp(`{
      "name": "Veterinary clinic owners",
      "description": "People who run a small animal clinic and look for practice software.",
      "interests": ["clinic software"],
      "problems": ["paper records"],
      "goals": ["faster billing"],
      "useCases": ["appointment reminders"],
      "productCategories": ["veterinary software"]
    }`);
    expect(profile?.name).toBe("Veterinary clinic owners");
    expect(profile?.problems).toEqual(["paper records"]);
  });

  it("drops a reply that has no audience name", () => {
    expect(parseChannelIcp('{"description":"Viewers"}')).toBeNull();
    expect(diagnoseChannelIcp('{"description":"Viewers"}').diagnostic).toMatchObject({
      reason: "missing-or-invalid-name",
      fields: ["description"],
    });
  });

  it("reads a nested profile with alternate field names", () => {
    const profile = parseChannelIcp(
      '{"audience":{"audience_name":"Clinic teams","summary":"Veterinary professionals improving patient care.","use_cases":["case reviews"],"product_categories":["veterinary education"]}}',
    );
    expect(profile?.name).toBe("Clinic teams");
    expect(profile?.useCases).toEqual(["case reviews"]);
  });

  it("retries one unreadable DeepSeek response", async () => {
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"name":"Veterinary teams","description":"People working in veterinary clinics.","interests":[],"problems":[],"goals":[],"useCases":[],"productCategories":[]}' } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const profile = await writeChannelIcp({
        id: "channel-1",
        title: "Vet channel",
        description: "Clinical education",
        keywords: ["veterinary"],
        country: "FR",
      });
      expect(profile.name).toBe("Veterinary teams");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });
});
