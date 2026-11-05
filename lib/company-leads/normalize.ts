export type RawCompanyLeadCsvRow = Record<string, string>;

export type NormalizedCompanyLead = {
  businessName: string;
  websiteUrl: string | null;
  domain: string | null;
  email: string;
  emailNormalized: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  phone: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  countryCode: string;
  sicCode: string | null;
  sicName: string | null;
  naicsCode: string | null;
  salesVolume: string | null;
  employeeCount: string | null;
  companyType: string | null;
};

function clean(value: string | undefined | null, max = 300): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cell(row: RawCompanyLeadCsvRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && String(direct).trim()) return String(direct);
    const found = Object.keys(row).find((k) => k.trim().toUpperCase() === key.toUpperCase());
    if (found && String(row[found] ?? "").trim()) return String(row[found]);
  }
  return null;
}

export function normalizeCompanyLeadEmail(raw: string | null | undefined): string | null {
  const value = clean(raw, 320)?.toLowerCase();
  if (!value || !value.includes("@")) return null;
  if (value.endsWith(".png") || value.endsWith(".jpg") || value.includes(" ")) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

export function normalizeCompanyLeadDomain(raw: string | null | undefined): {
  websiteUrl: string | null;
  domain: string | null;
} {
  const text = clean(raw, 500);
  if (!text) return { websiteUrl: null, domain: null };
  let candidate = text;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || !host.includes(".")) return { websiteUrl: null, domain: null };
    url.hostname = host;
    url.hash = "";
    url.search = "";
    return { websiteUrl: url.toString().replace(/\/$/, ""), domain: host };
  } catch {
    return { websiteUrl: null, domain: null };
  }
}

export function normalizeCompanyLeadRow(row: RawCompanyLeadCsvRow): NormalizedCompanyLead | null {
  const emailRaw = cell(row, "EMAIL", "Email", "email");
  const emailNormalized = normalizeCompanyLeadEmail(emailRaw);
  if (!emailNormalized) return null;

  const businessName =
    clean(cell(row, "BUSINESS NAME", "Business Name", "COMPANY", "Company"), 240) ||
    emailNormalized.split("@")[1] ||
    "Unknown company";

  const web = normalizeCompanyLeadDomain(cell(row, "WEB ADDRESS", "Website", "WEBSITE", "URL"));

  return {
    businessName,
    websiteUrl: web.websiteUrl,
    domain: web.domain,
    email: emailRaw?.trim() || emailNormalized,
    emailNormalized,
    firstName: clean(cell(row, "FIRSTNAME", "First Name", "FIRST NAME"), 80),
    lastName: clean(cell(row, "LASTNAME", "Last Name", "LAST NAME"), 80),
    title: clean(cell(row, "TITLE", "Title"), 160),
    phone: clean(cell(row, "AREA CODE AND PHONE", "PHONE", "Phone"), 40),
    mailingAddress: clean(cell(row, "MAILING ADDRESS", "Address"), 240),
    mailingCity: clean(cell(row, "MAILING CITY", "City"), 100),
    mailingState: clean(cell(row, "MAILING STATE", "State"), 40)?.toUpperCase() ?? null,
    mailingZip: clean(cell(row, "MAILING ZIP", "Zip", "ZIP"), 20),
    countryCode: "US",
    sicCode: clean(cell(row, "SIC"), 20),
    sicName: clean(cell(row, "SIC NAME1", "SIC NAME", "SIC Name"), 200),
    naicsCode: clean(cell(row, "NAICS"), 20),
    salesVolume: clean(cell(row, "SALES VOLUME"), 80),
    employeeCount: clean(cell(row, "NUMBER OF EMPLOYEES"), 40),
    companyType: clean(cell(row, "PUBLIC PRIVATE COMPANY"), 40),
  };
}
