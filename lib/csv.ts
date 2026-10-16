export type CsvField =
  | "channel_id"
  | "channel_name"
  | "channel_url"
  | "video_url"
  | "country"
  | "subscriber_count"
  | "website_url"
  | "email"
  | "ignore";

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") continue;
    cell += char ?? "";
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

export function sanitizeCsvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function encodeCsvCell(value: unknown): string {
  const safe = sanitizeCsvCell(value);
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map((header) => encodeCsvCell(header)).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => encodeCsvCell(cell)).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const HEADER_ALIASES: Record<string, CsvField> = {
  channel_id: "channel_id",
  channelid: "channel_id",
  youtube_channel_id: "channel_id",
  id: "channel_id",
  channel_name: "channel_name",
  channelname: "channel_name",
  name: "channel_name",
  title: "channel_name",
  channel_url: "channel_url",
  channelurl: "channel_url",
  url: "channel_url",
  video_url: "video_url",
  videourl: "video_url",
  video: "video_url",
  country: "country",
  country_code: "country",
  subscriber_count: "subscriber_count",
  subscribers: "subscriber_count",
  subscribercount: "subscriber_count",
  website_url: "website_url",
  website: "website_url",
  official_website: "website_url",
  email: "email",
  business_email: "email",
  contact_email: "email",
};

export function suggestMapping(headers: string[]): Record<number, CsvField> {
  const mapping: Record<number, CsvField> = {};
  headers.forEach((header, index) => {
    const key = header.trim().toLowerCase().replace(/[\s-]+/g, "_");
    mapping[index] = HEADER_ALIASES[key] ?? "ignore";
  });
  return mapping;
}

export type ImportRow = {
  rowNumber: number;
  channelId: string | null;
  channelName: string | null;
  channelUrl: string | null;
  videoUrl: string | null;
  country: string | null;
  subscriberCount: number | null;
  websiteUrl: string | null;
  email: string | null;
};

export type ImportIssue = { rowNumber: number; message: string };

export function mapImportRows(table: string[][], mapping: Record<number, CsvField>) {
  const [header, ...body] = table;
  if (!header || header.length === 0) {
    return { rows: [] as ImportRow[], errors: [{ rowNumber: 1, message: "The CSV file has no header row" }] };
  }
  const rows: ImportRow[] = [];
  const errors: ImportIssue[] = [];
  body.forEach((cells, index) => {
    const rowNumber = index + 2;
    const read = (field: CsvField) => {
      const position = Object.entries(mapping).find(([, value]) => value === field)?.[0];
      if (position == null) return "";
      return (cells[Number(position)] ?? "").trim();
    };
    const subscriberRaw = read("subscriber_count").replaceAll(",", "");
    let subscriberCount: number | null = null;
    if (subscriberRaw) {
      const parsed = Number(subscriberRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push({ rowNumber, message: "Subscriber count must be a positive number" });
      } else {
        subscriberCount = Math.round(parsed);
      }
    }
    const email = read("email").toLowerCase();
    rows.push({
      rowNumber,
      channelId: read("channel_id") || null,
      channelName: read("channel_name") || null,
      channelUrl: read("channel_url") || null,
      videoUrl: read("video_url") || null,
      country: read("country").toUpperCase() || null,
      subscriberCount,
      websiteUrl: read("website_url") || null,
      email: email || null,
    });
  });
  return { rows, errors };
}

export function findInFileDuplicates(rows: ImportRow[]) {
  const seen = new Map<string, number>();
  const duplicates: ImportIssue[] = [];
  for (const row of rows) {
    if (!row.channelId) continue;
    const previous = seen.get(row.channelId);
    if (previous) {
      duplicates.push({
        rowNumber: row.rowNumber,
        message: `Channel ${row.channelId} is repeated from row ${previous}`,
      });
    } else {
      seen.set(row.channelId, row.rowNumber);
    }
  }
  return duplicates;
}
