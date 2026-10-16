"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { formatAgo, formatCompact } from "@/lib/utils";
import type { CreatorRow } from "@/lib/types";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";

export type SearchActivity = {
  status: string;
  phase: string;
  progress: number;
  found: number;
  requested: number;
  scanned: number;
  quotaUsed: number;
  onCancel?: () => void;
};

export function CreatorResultList({
  title,
  creators,
  total,
  loading,
  finished,
  note,
  onBack,
  sort,
  onSort,
  page,
  pageCount,
  onPage,
  activity,
}: {
  title: string;
  creators: CreatorRow[];
  total: number;
  loading: boolean;
  finished: boolean;
  note?: string | null;
  onBack?: () => void;
  sort: string;
  onSort: (value: string) => void;
  page?: number;
  pageCount?: number;
  onPage?: (page: number) => void;
  activity?: SearchActivity | null;
}) {
  const router = useRouter();
  const visible = creators;
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const selectedIds = visible.filter((creator) => selection[creator.id]).map((creator) => creator.id);
  const allSelected = visible.length > 0 && selectedIds.length === visible.length;

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {};
    if (checked) for (const creator of visible) next[creator.id] = true;
    setSelection(next);
  }

  async function exportSelected() {
    if (selectedIds.length === 0) return;
    try {
      await api("/api/exports", {
        method: "POST",
        body: JSON.stringify({ scope: "SELECTED", creatorIds: selectedIds }),
      });
      toast.success("Export queued");
      router.push("/exports");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <div className="space-y-3">
        {onBack ? (
          <button type="button" className="text-sm font-semibold text-primary" onClick={onBack}>
            ← New Search
          </button>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <span className="inline-flex rounded-full border px-3 py-1 text-sm">Public email when available</span>
        <div>
          <p className="font-semibold">{loading && visible.length === 0 ? "Searching…" : `${total} creator${total === 1 ? "" : "s"} found`}</p>
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        </div>
        {activity && !finished ? <SearchProgress activity={activity} /> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort</span>
          <Select value={sort} onChange={(event) => onSort(event.target.value)} aria-label="Sort" className="h-9 w-40 rounded-full">
            <option value="relevance">Relevance</option>
            <option value="subscribers">Subscribers</option>
            <option value="averageViews">Average views</option>
            <option value="lastActiveAt">Last active</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} />
          Select all
        </label>
      </div>

      {loading && visible.length === 0 ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {!loading && !finished && visible.length === 0 ? <Skeleton className="h-28 rounded-2xl" /> : null}
      {!loading && finished && visible.length === 0 ? (
        <p className="rounded-2xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">No creator was found.</p>
      ) : null}

      <div className="space-y-3">
        {visible.map((creator) => (
          <article key={creator.id} className="rounded-2xl border bg-card p-3">
            <div className="flex gap-3">
              <input
                type="checkbox"
                className="mt-3 h-4 w-4 shrink-0"
                aria-label={`Select ${creator.channelName}`}
                checked={Boolean(selection[creator.id])}
                onChange={(event) => setSelection((current) => ({ ...current, [creator.id]: event.target.checked }))}
              />
              <ChannelAvatar url={creator.thumbnailUrl} name={creator.channelName} className="h-11 w-11" />
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <Link href={`/creators/${creator.id}`} className="font-semibold hover:underline">{creator.channelName}</Link>
                  <p className="text-sm text-muted-foreground">{creator.channelHandle || creator.youtubeChannelId}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
                    {creator.subscriberVisibility === "PUBLIC" && creator.subscriberCount != null ? `${formatCompact(creator.subscriberCount)} subs` : "Subs —"}
                  </span>
                  {creator.averageViews != null ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{formatCompact(creator.averageViews)} avg views</span> : null}
                </div>
                {formatAgo(creator.lastActiveAt) ? <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs">Last active {formatAgo(creator.lastActiveAt)}</span> : null}
                {creator.primaryEmail ? (
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{creator.primaryEmail.emailAddress}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No public email</p>
                )}
                {creator.matchedVideoTitle ? (
                  <p className="truncate text-sm text-muted-foreground">
                    Matched: {creator.matchedVideoTitle}
                    {creator.matchedVideoViews != null ? ` · ${formatCompact(creator.matchedVideoViews)} views` : ""}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>Links:</span>
                  <a className="rounded-full border px-3 py-1 text-xs text-foreground" href={creator.channelUrl} target="_blank" rel="noreferrer">YouTube</a>
                  {creator.officialWebsiteUrl ? <a className="rounded-full border px-3 py-1 text-xs text-foreground" href={creator.officialWebsiteUrl} target="_blank" rel="noreferrer">Website</a> : null}
                  {creator.instagramUrl ? <a className="rounded-full border px-3 py-1 text-xs text-foreground" href={creator.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}
                  {creator.twitterUrl ? <a className="rounded-full border px-3 py-1 text-xs text-foreground" href={creator.twitterUrl} target="_blank" rel="noreferrer">X</a> : null}
                  {creator.tiktokUrl ? <a className="rounded-full border px-3 py-1 text-xs text-foreground" href={creator.tiktokUrl} target="_blank" rel="noreferrer">TikTok</a> : null}
                </div>
              </div>
            </div>
          </article>
        ))}
        {!finished && visible.length > 0 ? <Skeleton className="h-16 rounded-2xl" /> : null}
      </div>

      {page && pageCount && pageCount > 1 && onPage ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
      ) : null}

      <div className="sticky bottom-3 flex items-center justify-between rounded-2xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
        <div>
          <p className="text-sm font-semibold">{selectedIds.length} creator{selectedIds.length === 1 ? "" : "s"} selected</p>
          <button type="button" className="text-sm text-muted-foreground" onClick={() => setSelection({})}>Clear selection</button>
        </div>
        <Button className="rounded-full px-6" disabled={selectedIds.length === 0} onClick={() => void exportSelected()}>Export</Button>
      </div>
    </div>
  );
}

function activityLabel(status: string, phase: string) {
  if (status === "QUEUED") return "Waiting to start";
  if (phase === "reading") return "Reading public descriptions";
  if (phase === "saving") return "Saving creators";
  return "Searching YouTube";
}

function SearchProgress({ activity }: { activity: SearchActivity }) {
  const progress = Math.max(0, Math.min(100, activity.progress));
  return (
    <section className="rounded-2xl border bg-card p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          {activityLabel(activity.status, activity.phase)}
        </p>
        <span className="text-xs text-muted-foreground">{activity.quotaUsed.toLocaleString()} units</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        {progress > 0 ? (
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {activity.requested > 0
          ? `${activity.found} of ${activity.requested} creators`
          : "Looking for creators"}
        {activity.scanned > 0 ? ` · ${activity.scanned} channels reviewed` : ""}
      </p>
      {activity.onCancel ? (
        <button type="button" className="mt-3 text-sm font-medium text-muted-foreground" onClick={activity.onCancel}>
          Stop search
        </button>
      ) : null}
    </section>
  );
}
