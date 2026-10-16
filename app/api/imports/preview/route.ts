import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, jsonError, requireUser } from "@/lib/api";
import { parseCsv, suggestMapping } from "@/lib/csv";
import { ensureDataDirs, paths } from "@/lib/paths";

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5_242_880);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`import-preview:${user.id}`, 30, 60 * 60 * 1000);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Choose a CSV file");
    if (file.size <= 0) throw new ApiError(400, "The CSV file is empty");
    if (file.size > MAX_BYTES) throw new ApiError(413, "CSV files must be 5 MB or smaller");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new ApiError(400, "Only .csv files are supported");
    const text = await file.text();
    if (text.includes("\0")) throw new ApiError(400, "The file does not look like a CSV");
    const table = parseCsv(text);
    if (table.length < 2) throw new ApiError(400, "The CSV needs a header row and at least one data row");
    const headers = table[0] ?? [];
    const mapping = suggestMapping(headers);
    const token = randomBytes(16).toString("hex");
    await ensureDataDirs();
    await writeFile(path.join(paths.uploads, `${token}.csv`), text, "utf8");
    await writeFile(
      path.join(paths.uploads, `${token}.json`),
      JSON.stringify({ fileName: path.basename(file.name), userId: user.id }),
      "utf8",
    );
    return NextResponse.json({
      token,
      fileName: path.basename(file.name),
      headers,
      mapping,
      preview: table.slice(0, 6),
      rowCount: table.length - 1,
    });
  } catch (error) {
    return jsonError(error);
  }
}
