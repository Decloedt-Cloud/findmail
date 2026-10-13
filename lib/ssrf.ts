import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
]);

export function isBlockedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIp(normalized.slice(7));
  }
  if (normalized.includes(":")) {
    if (normalized === "::" || normalized === "::1") return true;
    const first = normalized.split(":").find((part) => part.length > 0) ?? "0";
    const value = Number.parseInt(first, 16);
    if (Number.isNaN(value)) return true;
    if ((value & 0xfe00) === 0xfc00) return true;
    if ((value & 0xffc0) === 0xfe80) return true;
    return false;
  }

  const parts = normalized.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are blocked");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Only ports 80 and 443 are allowed");
  }
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("This host is not a public destination");
  }
  if (!host.includes(".")) {
    throw new Error("Single-label hostnames are blocked");
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new Error("Private and metadata addresses are blocked");
  }
  return url;
}

function lookupPublic(
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 4);
      return;
    }
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((entry) => isBlockedIp(entry.address))) {
      callback(Object.assign(new Error(`Refusing non-public address for ${hostname}`), { code: "BLOCKED" }), "", 4);
      return;
    }
    const chosen = list[0];
    if (!chosen) {
      callback(new Error("No public address"), "", 4);
      return;
    }
    callback(null, chosen.address, chosen.family);
  });
}

const safeAgent = new Agent({
  connect: {
    lookup: lookupPublic,
  },
});

export type SafeResponse = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

const ALLOWED_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];

export async function safeFetch(
  rawUrl: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    userAgent: string;
    maxRedirects?: number;
    accept?: string[];
  },
): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? 3;
  let current = assertPublicHttpUrl(rawUrl).toString();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await undiciFetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        dispatcher: safeAgent,
        headers: {
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
      });

      const location = response.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        if (hop === maxRedirects) throw new Error("Too many redirects");
        current = assertPublicHttpUrl(new URL(location, current).toString()).toString();
        continue;
      }

      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      const allowed = options.accept ?? ALLOWED_TYPES;
      if (response.status < 400 && contentType && !allowed.includes(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > options.maxBytes) throw new Error("Response is too large");

      const reader = response.body?.getReader();
      if (!reader) {
        return { url: current, status: response.status, contentType, body: "" };
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        if (received > options.maxBytes) {
          await reader.cancel();
          throw new Error("Response is too large");
        }
        chunks.push(next.value);
      }
      const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
      return { url: current, status: response.status, contentType, body };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}
