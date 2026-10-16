import * as cheerio from "cheerio";
import { assessEmail, normalizeEmail, type EmailAssessment } from "@/lib/email/normalize";

export type ExtractedEmail = EmailAssessment & {
  original: string;
  method: "MAILTO_LINK" | "VISIBLE_TEXT";
};

const EMAIL_PATTERN =
  /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z]{2,24})+/gi;

function deobfuscate(text: string) {
  return text
    .replace(/\[\s*(?:at|@)\s*\]|\(\s*(?:at|@)\s*\)/gi, "@")
    .replace(/\[\s*dot\s*\]|\(\s*dot\s*\)/gi, ".")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s+\.\s+/g, ".");
}

function collect(text: string, method: ExtractedEmail["method"], into: Map<string, ExtractedEmail>) {
  const source = method === "VISIBLE_TEXT" ? deobfuscate(text) : text;
  for (const match of source.match(new RegExp(EMAIL_PATTERN.source, "gi")) ?? []) {
    const assessment = assessEmail(match);
    if (!assessment.validSyntax || assessment.placeholder) continue;
    if (!into.has(assessment.normalized)) {
      into.set(assessment.normalized, { ...assessment, original: normalizeEmail(match), method });
    }
  }
}

export function extractEmailsFromHtml(html: string): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>();
  const $ = cheerio.load(html);
  $("script, style, noscript, title").remove();
  $("p, div, li, td, th, h1, h2, h3, h4, section, article, br, tr, header, footer").append(" ");
  $("a[href^='mailto:'], a[href^='MAILTO:']").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    collect(href.replace(/^mailto:/i, ""), "MAILTO_LINK", found);
  });
  collect($("body").text(), "VISIBLE_TEXT", found);
  return [...found.values()];
}

export function extractEmailsFromText(text: string): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>();
  collect(text, "VISIBLE_TEXT", found);
  return [...found.values()];
}

export function pageTitle(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  return title || null;
}
