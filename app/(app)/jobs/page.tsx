"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/utils";
import type { JobRow } from "@/lib/types";
import { Badge, statusTone } from "@/components/ui/badge";
import { Progress, EmptyState, Skeleton } from "@/components/ui/feedback";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      api<{ jobs: JobRow[] }>("/api/jobs")
        .then((result) => {
          if (cancelled) return;
          setJobs(result.jobs);
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    void pull();
    const timer = window.setInterval(() => void pull(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Processing jobs</h1>
        <p className="text-sm text-muted-foreground">Jobs stay queued until the worker process is running with Redis. Progress comes from the database, not a placeholder.</p>
      </div>
      {loading ? <Skeleton className="h-40" /> : jobs.length === 0 ? <EmptyState title="No jobs yet" body="Discovery, imports, email finding, verification, and exports appear here." /> : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-xl border bg-card p-4 hover:bg-accent/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{job.name}</p>
                  <p className="text-xs text-muted-foreground">{job.type.replaceAll("_", " ")} · {formatDateTime(job.createdAt)}</p>
                </div>
                <Badge tone={statusTone(job.status)}>{job.status.replaceAll("_", " ")}</Badge>
              </div>
              <div className="mt-3"><Progress value={job.progress} /></div>
              <p className="mt-2 text-xs text-muted-foreground">{job.successCount} succeeded · {job.failureCount} errors · {job.noEmailCount} without an email</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
