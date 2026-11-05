import type { CompanyLead } from "@prisma/client";

export type WayoAdsCompanyLead = {
  id: string;
  businessName: string;
  domain: string | null;
  email: string;
  sicName: string | null;
  city: string | null;
  state: string | null;
};

export type WayoAdsCompanyLeadTeaser = {
  businessName: string;
  sicName: string | null;
  domain: string | null;
};

const PREFILTER_SELECT = {
  id: true,
  businessName: true,
  domain: true,
  email: true,
  sicName: true,
  mailingCity: true,
  mailingState: true,
} as const;

export { PREFILTER_SELECT };

export function toWayoAdsCompanyLead(
  row: Pick<
    CompanyLead,
    "id" | "businessName" | "domain" | "email" | "sicName" | "mailingCity" | "mailingState"
  >,
): WayoAdsCompanyLead {
  return {
    id: row.id,
    businessName: row.businessName,
    domain: row.domain,
    email: row.email,
    sicName: row.sicName,
    city: row.mailingCity,
    state: row.mailingState,
  };
}

export function toWayoAdsCompanyLeadTeaser(
  row: Pick<CompanyLead, "businessName" | "sicName" | "domain">,
): WayoAdsCompanyLeadTeaser {
  return {
    businessName: row.businessName,
    sicName: row.sicName,
    domain: row.domain,
  };
}
