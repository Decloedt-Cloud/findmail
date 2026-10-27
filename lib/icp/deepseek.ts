import { logger } from "@/lib/logger";
import { parseSearchQueries } from "@/lib/icp/queries";

const SYSTEM = [
  "You turn a simplified advertiser ICP into YouTube search queries.",
  "Return JSON only: {\"queries\": string[], \"note\": string}.",
  "Write 3 or 4 short search phrases, 2 to 6 words, that would find public videos whose viewers match this ICP.",
  "Search for the educational, professional, or entertainment topics the target people watch, not the advertiser's product.",
  "For a B2B product, target the profession and its day-to-day work, problems, skills, and goals.",
  "The first phrase is special: write only the broad profession or audience topic in 2 or 3 words.",
  "Examples of a first phrase: veterinary medicine, software engineering, personal finance, skincare.",
  "Do not add management, workflow, productivity, records, software, or another problem or product qualifier to the first phrase.",
  "The remaining phrases may describe day-to-day work, problems, skills, and goals.",
  "Avoid brand names, domains, software, app, platform, product features, review, tutorial, and demo unless the audience itself watches that exact product category.",
  "Use the ICP name, problems, goals, and interests. Do not name specific channels or people.",
].join(" ");

export async function searchQueriesForIcp(input: {
  brandName: string;
  websiteUrl: string;
  snapshot: unknown;
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
        { role: "system", content: SYSTEM },
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
