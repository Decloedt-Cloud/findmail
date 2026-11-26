import { logger } from "@/lib/logger";
import { parseSearchQueries } from "@/lib/icp/queries";
import { searchPhraseRule } from "@/lib/icp/search-language";
import type { DomainProfile } from "@/lib/icp/domain-types";

function systemPrompt(domain: DomainProfile, language: string | null, extra: string[] = []) {
  return [
  "You turn a simplified advertiser ICP into YouTube search queries.",
  "Return JSON only: {\"queries\": string[], \"note\": string}.",
  `The site's verified domain is fixed: ${domain.path} (${domain.label}). Do not reinterpret it.`,
  "Write 3 or 4 short search phrases, 2 to 6 words, that find public videos specifically about this domain.",
  searchPhraseRule(language, extra),
  "The domain is mandatory: never search broad interests merely because the same audience might watch them.",
  "For a clothing site, search fashion, clothing, apparel, styling, outfits, or sewing—not travel, cameras, AI, generic digital content, or education.",
  "For a B2B product, keep every phrase inside the customer's profession or industry domain.",
  "The first phrase is the broad domain in 2 or 3 words.",
  "Examples: fashion styling, veterinary medicine, software engineering, personal finance, skincare.",
  "The remaining phrases are direct subdomains, practices, problems, or skills within that same domain.",
  "Avoid brand names, domains, software, app, platform, product features, review, tutorial, and demo unless the audience itself watches that exact product category.",
  "Use the offer and ICP only to understand the domain. Do not name specific channels or people.",
  "The site theme is the homepage hero. If the ICP also names another theme as an example, a logo, or a blog, search the hero theme only.",
].join(" ");
}

export async function searchQueriesForIcp(input: {
  brandName: string;
  websiteUrl: string;
  snapshot: unknown;
  domain: DomainProfile;
  language?: string | null;
  languages?: string[];
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured.");
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const url = process.env.DEEPSEEK_API_URL?.trim() || "https://api.deepseek.com/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(input.domain, input.language ?? null, input.languages ?? []) },
        {
          role: "user",
          content: JSON.stringify({
            brandName: input.brandName,
            websiteUrl: input.websiteUrl,
            icp: input.snapshot,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message || "DeepSeek could not read this ICP.");
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  try {
    return parseSearchQueries(content);
  } catch (error) {
    logger.error("deepseek queries unreadable", { contentLength: content.length, preview: content.replace(/\s+/g, " ").slice(0, 180) });
    throw error;
  }
}
