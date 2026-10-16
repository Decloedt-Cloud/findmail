"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CSV_FIELDS, type CsvField } from "@/lib/constants";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";

type Preview = {
  token: string;
  fileName: string;
  headers: string[];
  mapping: Record<string, CsvField>;
  preview: string[][];
  rowCount: number;
};

export default function ImportPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, CsvField>>({});
  const [strategy, setStrategy] = useState("SKIP");
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import CSV</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Accepted columns include channel id, name, URL, video URL, country, subscribers, website, and email. Imported emails keep CSV provenance and are not marked verified.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>1. Upload</CardTitle>
          <CardDescription>CSV files up to 5 MB. The first rows are previewed before anything is saved.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setPending(true);
              try {
                const result = await api<Preview>("/api/imports/preview", { method: "POST", body: form });
                setPreview(result);
                setMapping(result.mapping);
                toast.success(`Previewing ${result.rowCount} rows`);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Upload failed");
              } finally {
                setPending(false);
              }
            }}
          >
            <input name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
            <Button type="submit" disabled={pending}>{pending ? "Checking..." : "Preview"}</Button>
          </form>
        </CardContent>
      </Card>
      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Map columns</CardTitle>
            <CardDescription>{preview.fileName} · {preview.rowCount} data rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {preview.headers.map((header, index) => (
                      <th key={`${header}-${index}`} className="px-2 py-2">
                        <div className="mb-2 font-medium">{header || `Column ${index + 1}`}</div>
                        <Select
                          value={mapping[String(index)] || "ignore"}
                          onChange={(event) => setMapping((current) => ({ ...current, [String(index)]: event.target.value as CsvField }))}
                        >
                          {CSV_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t">
                      {preview.headers.map((_, cellIndex) => <td key={cellIndex} className="px-2 py-2">{row[cellIndex]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="block max-w-sm space-y-2 text-sm">
              If the channel already exists
              <Select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
                <option value="SKIP">Skip existing records</option>
                <option value="UPDATE">Update existing records</option>
                <option value="MERGE">Fill only empty fields</option>
              </Select>
            </label>
            <Button
              onClick={async () => {
                setPending(true);
                try {
                  const result = await api<{ processingJobId: string }>("/api/imports", {
                    method: "POST",
                    body: JSON.stringify({ token: preview.token, mapping, duplicateStrategy: strategy }),
                  });
                  toast.success("Import queued");
                  router.push(`/jobs/${result.processingJobId}`);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Import failed");
                } finally {
                  setPending(false);
                }
              }}
            >
              Start import
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
