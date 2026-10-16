export type VerificationOutcome = "valid" | "invalid" | "unknown" | "review";

export function mapZeroBounceStatus(status: string): VerificationOutcome {
  const value = status.toLowerCase();
  if (value === "valid") return "valid";
  if (value === "invalid") return "invalid";
  if (value === "spamtrap" || value === "abuse" || value === "do_not_mail") return "review";
  return "unknown";
}

export function mapNeverBounceResult(result: string): VerificationOutcome {
  const value = result.toLowerCase();
  if (value === "valid") return "valid";
  if (value === "invalid") return "invalid";
  if (value === "disposable") return "review";
  return "unknown";
}

export type VerificationProvider = {
  id: string;
  configured: boolean;
  verify: (email: string) => Promise<{ outcome: VerificationOutcome; rawStatus: string }>;
};

export function verificationProviderFromEnv(
  env: { provider?: string; apiKey?: string },
  fetchImpl: typeof fetch = fetch,
): VerificationProvider {
  const provider = (env.provider || "none").toLowerCase();
  const apiKey = env.apiKey?.trim() ?? "";
  if (provider === "none" || provider === "") {
    return { id: "none", configured: false, verify: async () => { throw new Error("Email verification provider is not configured"); } };
  }
  if (!apiKey) {
    return { id: provider, configured: false, verify: async () => { throw new Error(`${provider} API key is not configured`); } };
  }
  if (provider === "zerobounce") {
    return {
      id: "zerobounce",
      configured: true,
      async verify(email: string) {
        const url = new URL("https://api.zerobounce.net/v2/validate");
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("email", email);
        const response = await fetchImpl(url.toString());
        if (!response.ok) throw new Error(`ZeroBounce returned HTTP ${response.status}`);
        const body = (await response.json()) as { status?: string };
        const rawStatus = body.status ?? "unknown";
        return { outcome: mapZeroBounceStatus(rawStatus), rawStatus };
      },
    };
  }
  if (provider === "neverbounce") {
    return {
      id: "neverbounce",
      configured: true,
      async verify(email: string) {
        const response = await fetchImpl("https://api.neverbounce.com/v4/single/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: apiKey, email }),
        });
        if (!response.ok) throw new Error(`NeverBounce returned HTTP ${response.status}`);
        const body = (await response.json()) as { result?: string };
        const rawStatus = body.result ?? "unknown";
        return { outcome: mapNeverBounceResult(rawStatus), rawStatus };
      },
    };
  }
  return { id: provider, configured: false, verify: async () => { throw new Error(`Unsupported verification provider: ${provider}`); } };
}

export type HunterEmail = { email: string; sourceUrl: string | null };

export function hunterEmailsFromResponse(body: unknown): HunterEmail[] {
  const record = body && typeof body === "object" ? (body as { data?: { emails?: unknown[] } }) : {};
  const emails = Array.isArray(record.data?.emails) ? record.data.emails : [];
  return emails.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const email = "value" in item && typeof item.value === "string" ? item.value : "";
    if (!email) return [];
    const sources = "sources" in item && Array.isArray(item.sources) ? item.sources : [];
    const first = sources.find((source) => source && typeof source === "object" && "uri" in source) as { uri?: string } | undefined;
    return [{ email, sourceUrl: first?.uri ?? null }];
  });
}

export function hunterProviderFromEnv(env: { provider?: string; apiKey?: string }, fetchImpl: typeof fetch = fetch) {
  const provider = (env.provider || "none").toLowerCase();
  const apiKey = env.apiKey?.trim() ?? "";
  const configured = provider === "hunter" && apiKey.length > 0;
  return {
    id: configured ? "hunter" : provider || "none",
    configured,
    async findByDomain(domain: string) {
      if (!configured) return [] as HunterEmail[];
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("domain", domain);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("limit", "10");
      const response = await fetchImpl(url.toString());
      if (!response.ok) throw new Error(`Hunter returned HTTP ${response.status}`);
      return hunterEmailsFromResponse(await response.json());
    },
  };
}
