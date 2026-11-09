import { describe, expect, it } from "vitest";
import { businessNameFromDomain, isBareDomain } from "@/lib/company-leads/companyName";
import { normalizeCompanyLeadRow } from "@/lib/company-leads/normalize";

describe("businessNameFromDomain", () => {
  it("turns a hostname into a readable label", () => {
    expect(businessNameFromDomain("acme.com")).toBe("Acme");
    expect(businessNameFromDomain("www.blue-sky.co.uk")).toBe("Blue Sky");
    expect(businessNameFromDomain("")).toBe("");
  });

  it("detects a hostname but not a name", () => {
    expect(isBareDomain("acme.com")).toBe(true);
    expect(isBareDomain("Acme Labs")).toBe(false);
  });
});

describe("normalizeCompanyLeadRow — business name", () => {
  it("keeps the CSV business name when there is one", () => {
    const row = normalizeCompanyLeadRow({
      "BUSINESS NAME": "Acme Labs",
      EMAIL: "ada@acme.com",
    });
    expect(row?.businessName).toBe("Acme Labs");
  });

  it("falls back to a label, never the raw domain", () => {
    const row = normalizeCompanyLeadRow({ EMAIL: "ada@acme.com" });
    expect(row?.businessName).toBe("Acme");
    // The domain columns stay sourced from the website cell, not the email.
    expect(row?.domain).toBe(null);
  });

  it("keeps the website host as the domain", () => {
    const row = normalizeCompanyLeadRow({
      EMAIL: "ada@acme.com",
      "WEB ADDRESS": "https://www.acme.com",
    });
    expect(row?.businessName).toBe("Acme");
    expect(row?.domain).toBe("acme.com");
  });
});
