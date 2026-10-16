"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { formatAgo } from "@/lib/utils";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

const SCOPES = [
  { value: "WITH_EMAIL", label: "Public email" },
  { value: "VERIFIED_ONLY", label: "Verified only" },
  { value: "FILTERED", label: "All creators" },
  { value: "WITHOUT_EMAIL", label: "No email yet" },
] as const;

const SCOPE_LABELS: Record<string, string> = {
  WITH_EMAIL: "Public email",
  VERIFIED_ONLY: "Verified only",
  FILTERED: "All creators",
  WITHOUT_EMAIL: "No email yet",
  SELECTED: "Selected creators",
  JOB: "One search",
  CONTACT_LIST: "Contact list",
};

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  RUNNING: "Preparing",
  COMPLETED: "Ready",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  PARTIALLY_COMPLETED: "Partial",
};

type ExportRow = {
  id: string;
  fileName: string;
  status: string;
  scope: string;
  rowCount: number;
  createdAt: string;
  errorSummary: string | null;
};

export default function ExportsPage() {
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [scope, setScope] = useState<string>("WITH_EMAIL");
  const [pending, setPending] = useState(false);
  const busy = exports.some((item) => item.status === "QUEUED" || item.status === "RUNNING");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const pull = () =>
      api<{ exports: ExportRow[] }>("/api/exports")
        .then((result) => {
          if (cancelled) return;
          setExports(result.exports);
          const stillBusy = result.exports.some((item) => item.status === "QUEUED" || item.status === "RUNNING");
          if (stillBusy) timer = window.setTimeout(pull, 2000);
        })
        .catch(() => undefined);
    void pull();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [busy]);

  async function queueExport() {
    setPending(true);
    try {
      await api("/api/exports", { method: "POST", body: JSON.stringify({ scope }) });
      toast.success("Export queued");
      const result = await api<{ exports: ExportRow[] }>("/api/exports");
      setExports(result.exports);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <section className="rounded-3xl border bg-card p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Export history</h1>
            <p className="text-sm text-muted-foreground">CSV of channel, email, website, and social links</p>
          </div>
        </div>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">WHO TO INCLUDE</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`h-11 rounded-full text-sm font-semibold ${scope === item.value ? "bg-primary text-primary-foreground" : "border bg-card"}`}
              onClick={() => setScope(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Button className="mt-4 h-12 w-full rounded-full text-base" disabled={pending} onClick={() => void queueExport()}>
          {pending ? "Queuing..." : "Export CSV"}
        </Button>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">RECENT FILES</p>
        {exports.length === 0 ? (
          <EmptyState title="No files yet" body="Export the creators you can see. The file shows up here when it is ready." />
        ) : (
          exports.map((item) => {
            const active = item.status === "QUEUED" || item.status === "RUNNING";
            return (
              <article key={item.id} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{SCOPE_LABELS[item.scope] ?? item.scope}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{`${item.rowCount} creator${item.rowCount === 1 ? "" : "s"} · ${formatAgo(item.createdAt) ?? "just now"}`}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.fileName}</p>
                  </div>
                  <Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status] ?? item.status}</Badge>
                </div>
                {item.status === "FAILED" && item.errorSummary ? <p className="mt-2 text-sm text-destructive">{item.errorSummary}</p> : null}
                {active ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                    Preparing the file
                  </p>
                ) : null}
                {item.status === "COMPLETED" ? (
                  <a className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" href={`/api/exports/${item.id}/download`}>
                    Download CSV
                  </a>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
