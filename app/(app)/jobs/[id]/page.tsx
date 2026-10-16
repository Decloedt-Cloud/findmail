"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/utils";
import type { JobRow } from "@/lib/types";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/feedback";

type Detail = JobRow & {
  errors: { id: string; message: string; recordKey: string | null; createdAt: string }[];
  importBatch?: { id: string; errorCount: number; duplicateCount: number; errorReportPath: string | null } | null;
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Detail | null>(null);

  async function load() {
    const result = await api<{ job: Detail }>(`/api/jobs/${params.id}`);
    setJob(result.job);
  }

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      api<{ job: Detail }>(`/api/jobs/${params.id}`).then((result) => {
        if (!cancelled) setJob(result.job);
      });
    void pull();
    const timer = window.setInterval(() => void pull(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [params.id]);

  if (!job) return null;
  const waiting = job.status === "QUEUED";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{job.name}</h1>
          <p className="text-sm text-muted-foreground">{job.type.replaceAll("_", " ")} · started {formatDateTime(job.startedAt)} · finished {formatDateTime(job.completedAt)}</p>
        </div>
        <Badge tone={statusTone(job.status)}>{job.status.replaceAll("_", " ")}</Badge>
      </div>
      {waiting ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">Queued. Start the worker with <code>npm run worker</code> if it is not already running.</p> : null}
      <Progress value={job.progress} />
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <Stat label="Processed" value={job.processedRecords} />
        <Stat label="Succeeded" value={job.successCount} />
        <Stat label="Without email" value={job.noEmailCount} />
        <Stat label="Errors" value={job.failureCount} />
        <Stat label="Duplicates prevented" value={job.duplicatesPrevented} />
        <Stat label="Retries" value={job.retryCount} />
      </dl>
      {job.errorSummary ? <p className="text-sm text-destructive">{job.errorSummary}</p> : null}
      <div className="flex flex-wrap gap-2">
        {job.status === "QUEUED" || job.status === "RUNNING" ? (
          <Button variant="outline" onClick={async () => { await api(`/api/jobs/${job.id}/cancel`, { method: "POST" }); toast.success("Cancellation requested"); await load(); }}>Cancel</Button>
        ) : null}
        {job.status === "FAILED" || job.status === "PARTIALLY_COMPLETED" ? (
          <Button onClick={async () => { try { await api(`/api/jobs/${job.id}/retry`, { method: "POST" }); toast.success("Retry queued"); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : "Retry failed"); } }}>Retry failed records</Button>
        ) : null}
        {job.importBatch?.errorReportPath ? <a className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium" href={`/api/imports/${job.importBatch.id}/errors`}>Download error report</a> : null}
        <Button variant="ghost" onClick={() => router.push("/jobs")}>All jobs</Button>
      </div>
      <section className="space-y-2">
        <h2 className="font-medium">Error summary</h2>
        {job.errors.length === 0 ? <p className="text-sm text-muted-foreground">No errors recorded.</p> : job.errors.map((error) => (
          <p key={error.id} className="rounded-lg border px-3 py-2 text-sm">{error.recordKey ? `${error.recordKey}: ` : ""}{error.message}</p>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>;
}
