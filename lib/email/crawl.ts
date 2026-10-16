import { scheduleDomain } from "@/lib/email/domain-limit";
import type { PageFetchResult } from "@/lib/email/discovery";
import { safeFetch } from "@/lib/ssrf";

function numberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function crawlerUserAgent() {
  const base = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  return `WayoAdsCreatorEmailFinder/1.0 (+${base}; public contact discovery)`;
}

async function fetchLimited(url: string, accept?: string[]): Promise<PageFetchResult> {
  let host = "unknown";
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, url, error: "URL is not valid" };
  }
  return scheduleDomain(host, numberEnv("DOMAIN_REQUEST_INTERVAL_MS", 1000), async () => {
    try {
      const response = await safeFetch(url, {
        timeoutMs: numberEnv("REQUEST_TIMEOUT_MS", 10_000),
        maxBytes: 1_000_000,
        userAgent: crawlerUserAgent(),
        accept,
      });
      return { ok: true, url: response.url, status: response.status, body: response.body };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fetch failed";
      return { ok: false, url, error: message };
    }
  });
}

export function fetchPublicPage(url: string) {
  return fetchLimited(url);
}

export function fetchPublicText(url: string) {
  return fetchLimited(url, ["text/plain", "text/html", "application/xhtml+xml"]);
}
