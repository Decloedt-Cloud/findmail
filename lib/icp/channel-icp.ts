import { logger } from "@/lib/logger";
import type { YouTubeChannel } from "@/lib/youtube/client";

export type ChannelIcp = {
  name: string;
  description: string;
  interests: string[];
  problems: string[];
  goals: string[];
  useCases: string[];
  productCategories: string[];
};

function lines(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 120) continue;
    items.push(text);
    if (items.length >= max) break;
  }
  return items;
}

type ChannelIcpDiagnostic = {
  reason: string;
  fields: string[];
  preview: string;
};

function diagnostic(raw: string, reason: string, fields: string[] = []): ChannelIcpDiagnostic {
  return {
    reason,
    fields: fields.slice(0, 20),
    preview: raw.replace(/\s+/g, " ").trim().slice(0, 240),
  };
}

export function diagnoseChannelIcp(raw: string): { profile: ChannelIcp | null; diagnostic: ChannelIcpDiagnostic | null } {
  if (!raw.trim()) return { profile: null, diagnostic: diagnostic(raw, "empty-response") };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { profile: null, diagnostic: diagnostic(raw, "json-object-not-found") };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { profile: null, diagnostic: diagnostic(raw, "invalid-json") };
  }
  if (!parsed || typeof parsed !== "object") {
    return { profile: null, diagnostic: diagnostic(raw, "json-root-not-object") };
  }
  const root = parsed as Record<string, unknown>;
  const nested = [root.channelIcp, root.channel_icp, root.icp, root.audience, root.profile]
    .find((value) => value && typeof value === "object");
  const record = (nested || root) as Record<string, unknown>;
  const fields = Object.keys(record);
  const rawName = record.name ?? record.audienceName ?? record.audience_name ?? record.title ?? record.who;
  const rawDescription = record.description ?? record.summary ?? record.who;
  const name = typeof rawName === "string" ? rawName.replace(/\s+/g, " ").trim() : "";
  const description = typeof rawDescription === "string" ? rawDescription.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2) {
    return { profile: null, diagnostic: diagnostic(raw, "missing-or-invalid-name", fields) };
  }
  if (description.length < 2) {
    return { profile: null, diagnostic: diagnostic(raw, "missing-or-invalid-description", fields) };
  }
  return {
    profile: {
      name: name.slice(0, 120),
      description: description.slice(0, 500),
      interests: lines(record.interests, 6),
      problems: lines(record.problems, 4),
      goals: lines(record.goals, 4),
      useCases: lines(record.useCases ?? record.use_cases, 4),
      productCategories: lines(record.productCategories ?? record.product_categories, 4),
    },
    diagnostic: null,
  };
}

export function parseChannelIcp(raw: string): ChannelIcp | null {
  return diagnoseChannelIcp(raw).profile;
}

export function readChannelIcp(value: unknown): ChannelIcp | null {
  if (!value || typeof value !== "object") return null;
  return parseChannelIcp(JSON.stringify(value));
}

type ChannelIcpSource = Pick<YouTubeChannel, "id" | "title" | "description" | "keywords" | "country">;

function fallbackChannelIcp(channel: ChannelIcpSource): ChannelIcp {
  const interests = channel.keywords
    .map((keyword) => keyword.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);
  const topic = interests.slice(0, 3).join(", ");
  return {
    name: `${channel.title} viewers`.slice(0, 120),
    description: topic
      ? `People who watch ${channel.title} for content about ${topic}.`.slice(0, 500)
      : `People who watch ${channel.title}.`.slice(0, 500),
    interests,
    problems: [],
    goals: [],
    useCases: [],
    productCategories: [],
  };
}

export async function writeChannelIcp(channel: ChannelIcpSource): Promise<ChannelIcp> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return fallbackChannelIcp(channel);
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const url = process.env.DEEPSEEK_API_URL?.trim() || "https://api.deepseek.com/chat/completions";
  const requestBody = JSON.stringify({
    model,
    temperature: 0.2,
    max_tokens: 1400,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You describe who watches a YouTube channel.",
          "Use the channel description and keywords.",
          "name is the audience, not the channel name.",
          "Include problems and goals those viewers have.",
          "Do not invent a product the videos do not mention.",
          'Return JSON only: {"name":"","description":"","interests":[],"problems":[],"goals":[],"useCases":[],"productCategories":[]}.',
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          name: channel.title,
          country: channel.country,
          description: channel.description.slice(0, 800),
          keywords: channel.keywords.slice(0, 12),
        }),
      },
    ],
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(25_000),
      });
      const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content ?? "";
      const parsed = diagnoseChannelIcp(content);
      if (response.ok) {
        if (parsed.profile) return parsed.profile;
      }
      const retryable = response.ok || response.status === 429 || response.status >= 500;
      if (attempt === 1 && retryable) {
        logger.warn("channel icp retry", {
          channelId: channel.id,
          attempt,
          ...(response.ok
            ? (parsed.diagnostic ?? diagnostic(content, "unreadable"))
            : { reason: `http-${response.status}`, fields: [], preview: parsed.diagnostic?.preview || "" }),
        });
        continue;
      }
      logger.warn("channel icp fallback", {
        channelId: channel.id,
        attempt,
        status: response.status,
        ...(response.ok
          ? (parsed.diagnostic ?? diagnostic(content, "unreadable"))
          : { reason: `http-${response.status}`, fields: [], preview: parsed.diagnostic?.preview || "" }),
      });
      return fallbackChannelIcp(channel);
    } catch (error) {
      if (attempt === 1) {
        logger.warn("channel icp retry", { channelId: channel.id, reason: error instanceof Error ? error.name : "request" });
        continue;
      }
      logger.warn("channel icp fallback", { channelId: channel.id, reason: error instanceof Error ? error.name : "request" });
    }
  }
  return fallbackChannelIcp(channel);
}
