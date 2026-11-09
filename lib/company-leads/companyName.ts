/**
 * A readable company label derived from an email domain.
 *
 * A source CSV does not always carry a business-name column. The old fallback
 * used the email domain verbatim, so the outreach cards listed companies as
 * `acme.com` — a hostname in a place where a name belongs. This turns it into
 * `Acme`, which is what the reader (and the ranker) should see.
 *
 * It is not a guess at the real legal name; it is only a label. A row whose
 * name is already human is never touched.
 */

/** `acme.com`, `www.blue-sky.co.uk` — a bare host, never prose. */
const BARE_DOMAIN = /^(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** Final label of a domain: letters only, 2+ characters (so `A.B` is not one). */
function hasTextTld(domain: string): boolean {
  const tld = domain.split(".").pop() ?? "";
  return /^[a-z]{2,24}$/i.test(tld);
}

function titleCase(label: string): string {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** True when `value` is a hostname rather than a company name. */
export function isBareDomain(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!BARE_DOMAIN.test(trimmed)) return false;
  return hasTextTld(trimmed);
}

/**
 * The label to store when a lead has no business name: the domain's first
 * label, title-cased. Falls back to the domain itself for hosts like
 * `localhost.test`.
 */
export function businessNameFromDomain(domain: string | null | undefined): string {
  const trimmed = (domain ?? "").trim().replace(/^www\./i, "");
  if (!trimmed) return "";
  const first = trimmed.split(".")[0] ?? "";
  const label = titleCase(first);
  return label || trimmed;
}
