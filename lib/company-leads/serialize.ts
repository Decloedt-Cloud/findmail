import type { CompanyLead } from "@prisma/client";

export type WayoAdsCompanyLead = {
  id: string;
  businessName: string;
  domain: string | null;
  email: string;
  sicName: string | null;
  city: string | null;
  state: string | null;
  /** Raw cells, shown as-is next to the band badge. */
  employeeCount: string | null;
  salesVolume: string | null;
  /** 0 MICRO / 1 MID / 2 MACRO / 3 MEGA — null when the cell was unparseable. */
  employeeBand: number | null;
  revenueBand: number | null;
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
  employeeCount: true,
  salesVolume: true,
  employeeBand: true,
  revenueBand: true,
} as const;

export { PREFILTER_SELECT };

export function toWayoAdsCompanyLead(
  row: Pick<
    CompanyLead,
    | "id"
    | "businessName"
    | "domain"
    | "email"
    | "sicName"
    | "mailingCity"
    | "mailingState"
    | "employeeCount"
    | "salesVolume"
    | "employeeBand"
    | "revenueBand"
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
    employeeCount: row.employeeCount,
    salesVolume: row.salesVolume,
    employeeBand: row.employeeBand,
    revenueBand: row.revenueBand,
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
