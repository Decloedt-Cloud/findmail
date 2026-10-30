"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { toast } from "sonner";
import { MAX_CREATOR_SUBSCRIBERS, MIN_CREATOR_SUBSCRIBERS } from "@/lib/constants";
import { DISCOVERY_AUDIENCES, audienceFocus } from "@/lib/youtube/audience";
import { DISCOVERY_COUNTRIES, DISCOVERY_NICHES } from "@/lib/discovery-catalog";
import { api } from "@/lib/client";
import { CreatorResultList } from "@/components/creator-result-list";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { formatAgo, formatNumber } from "@/lib/utils";
import { estimateSearchQuota } from "@/lib/youtube/estimate";
import type { CreatorRow } from "@/lib/types";

const RESULT_COUNTS = [10, 25, 50, 100];

type SearchJob = { id: string; processingJobId: string | null; name: string; status: string; emailCount: number; creatorCount: number; createdAt: string };

export default function DiscoverPage() {
  const [nicheId, setNicheId] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [country, setCountry] = useState("FR");
  const [minSubscribers, setMinSubscribers] = useState(String(MIN_CREATOR_SUBSCRIBERS));
  const [maxSubscribers, setMaxSubscribers] = useState(String(MAX_CREATOR_SUBSCRIBERS));
  const [jobs, setJobs] = useState<SearchJob[]>([]);
  const [quota, setQuota] = useState<{ used: number; daily: number } | null>(null);
  const [youtube, setYoutube] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState<{ jobId: string; title: string; status: string } | null>(null);
  const [live, setLive] = useState<{ status: string; phase: string; progress: number; scanned: number; requested: number; quotaUsed: number; errorSummary: string | null } | null>(null);
  const [results, setResults] = useState<CreatorRow[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultSort, setResultSort] = useState("relevance");
  const [resultsLoading, setResultsLoading] = useState(false);
  const activeJobId = active?.jobId ?? null;
  const resultsKey = activeJobId ? `${activeJobId}:${resultSort}` : "";
  const [loadedResultsKey, setLoadedResultsKey] = useState(resultsKey);
  if (resultsKey !== loadedResultsKey) {
    setLoadedResultsKey(resultsKey);
    if (resultsKey) {
      setResults([]);
      setResultTotal(0);
      setLive(null);
      setResultsLoading(true);
    }
  }

  function loadHome() {
    api<{ jobs: SearchJob[]; quota: { used: number; daily: number } }>("/api/discovery/jobs")
      .then((result) => {
        setJobs(result.jobs);
        setQuota(result.quota);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    loadHome();
    api<{ integrations: { youtube: boolean } }>("/api/settings")
      .then((result) => setYoutube(result.integrations.youtube))
      .catch(() => setYoutube(false));
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer = 0;

    const pull = async () => {
      try {
        const jobResult = await api<{ job: { status: string; progress: number; errorSummary: string | null; payload: { phase?: unknown; scanned?: unknown } | null; searchJob: { maxResults: number; quotaUsed: number } | null } }>(`/api/jobs/${activeJobId}`);
        if (cancelled) return;
        const job = jobResult.job;
        const payload = job.payload ?? {};
        setActive((current) => {
          if (!current) return current;
          const terminal = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(current.status);
          if (terminal) return current;
          return { ...current, status: job.status };
        });
        setLive({
          status: job.status,
          phase: typeof payload.phase === "string" ? payload.phase : "",
          progress: job.progress ?? 0,
          scanned: typeof payload.scanned === "number" ? payload.scanned : 0,
          requested: job.searchJob?.maxResults ?? 0,
          quotaUsed: job.searchJob?.quotaUsed ?? 0,
          errorSummary: job.errorSummary,
        });
        const params = new URLSearchParams({
          jobId: activeJobId,
          page: "1",
          pageSize: "100",
          sort: resultSort,
          direction: "desc",
        });
        const creators = await api<{ creators: CreatorRow[]; total: number }>(`/api/creators?${params.toString()}`);
        if (cancelled) return;
        setResults(creators.creators);
        setResultTotal(creators.total);
        setResultsLoading(false);
        const done = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(job.status);
        if (!done) timer = window.setTimeout(() => void pull(), 2000);
      } catch {
        if (!cancelled) {
          setResultsLoading(false);
          timer = window.setTimeout(() => void pull(), 2000);
        }
      }
    };

    void pull();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeJobId, resultSort]);

  const niche = DISCOVERY_NICHES.find((item) => item.id === nicheId) ?? null;
  const keywordCount = niche ? 1 : 0;
  const minSubscriberCount = Math.max(MIN_CREATOR_SUBSCRIBERS, Number(minSubscribers) || MIN_CREATOR_SUBSCRIBERS);
  const maxSubscriberCount = Math.min(MAX_CREATOR_SUBSCRIBERS, Math.max(MIN_CREATOR_SUBSCRIBERS, Number(maxSubscribers) || MAX_CREATOR_SUBSCRIBERS));
  const selectedAudience = DISCOVERY_AUDIENCES.find((item) => item.min === minSubscriberCount && item.max === (maxSubscriberCount ?? null))?.id ?? null;
  const audienceHint = {
    small: "Recent videos are searched first, so smaller channels are not buried under the biggest creators.",
    mid: "Popular and recent videos are both searched for this audience.",
    large: "The most viewed videos and channels are searched first.",
    broad: `Channels with at least ${formatNumber(MIN_CREATOR_SUBSCRIBERS)} subscribers.`,
  }[audienceFocus(minSubscriberCount, maxSubscriberCount)];
  const quotaInput = {
    keywordCount,
    countryCount: country ? 1 : 0,
    includeRecentVideos: false,
    keywords: niche ? [niche.query] : [],
    countries: country ? [country] : [],
    minSubscribers: minSubscriberCount,
    maxSubscribers: maxSubscriberCount,
  };
  const estimatedQuota = estimateSearchQuota({ ...quotaInput, maxResults });
  const quotaLeft = quota ? Math.max(0, quota.daily - quota.used) : null;
  const overQuota = niche != null && quotaLeft != null && estimatedQuota > quotaLeft;
  const quotaRatio = quota && quota.daily > 0 ? Math.min(100, Math.round((quota.used / quota.daily) * 100)) : 0;
  const searchFinished = active ? ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(active.status) : false;

  async function findCreators() {
    if (!niche) {
      toast.error("Choose a category");
      return;
    }
    if (!country) {
      toast.error("Choose a country");
      return;
    }
    setPending(true);
    try {
      const result = await api<{ processingJobId: string; estimatedQuota: number }>("/api/discovery/search", {
        method: "POST",
        body: JSON.stringify({
          keywords: [niche.query],
          countries: [country],
          minSubscribers: minSubscriberCount,
          maxSubscribers: maxSubscriberCount,
          maxResults,
        }),
      });
      toast.success(`Search queued. Up to about ${formatNumber(result.estimatedQuota)} API units.`);
      setLive(null);
      setResults([]);
      setResultTotal(0);
      setActive({ jobId: result.processingJobId, title: niche.label, status: "QUEUED" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setPending(false);
    }
  }

  async function stopSearch() {
    if (!active) return;
    try {
      const result = await api<{ job: { status: string; cancelRequested?: boolean } }>(`/api/jobs/${active.jobId}/cancel`, { method: "POST" });
      const status = result.job.status === "QUEUED" || result.job.status === "RUNNING" ? "CANCELLED" : result.job.status;
      setActive((current) => current ? { ...current, status } : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop the search");
    }
  }

  if (active) {
    const activity = searchFinished ? null : {
      status: live?.status ?? active.status,
      phase: live?.phase ?? "",
      progress: live?.progress ?? 0,
      found: resultTotal,
      requested: live?.requested || maxResults,
      scanned: live?.scanned ?? 0,
      quotaUsed: live?.quotaUsed ?? 0,
      onCancel: () => void stopSearch(),
    };
    const finishedNote = active.status === "CANCELLED"
      ? "Search stopped."
      : live?.errorSummary || "No more qualifying creators were found for this search.";
    return (
      <CreatorResultList
        title={active.title.split("·")[0]?.trim() || active.title}
        creators={results}
        total={resultTotal}
        loading={resultsLoading}
        finished={searchFinished}
        note={searchFinished ? finishedNote : null}
        activity={activity}
        onBack={() => {
          setActive(null);
          loadHome();
        }}
        sort={resultSort}
        onSort={setResultSort}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      {youtube === false ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          YOUTUBE_API_KEY is not configured. Discovery stays unavailable until you add the key and restart the app.
        </div>
      ) : null}

      <section className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Creator Email Finder</h1>
            <p className="text-sm text-muted-foreground">Find YouTube creators and public emails</p>
          </div>
        </div>

        <div className="rounded-2xl border px-4 py-3">
          <div className="flex items-center justify-between text-xs font-semibold tracking-wide">
            <span>QUOTA</span>
            <span>{quota ? `${formatNumber(quota.used)} / ${formatNumber(quota.daily)}` : "—"}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${quotaRatio}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{quotaLeft == null ? "YouTube Data API units used today." : `${formatNumber(quotaLeft)} units left today.`}</p>
        </div>

        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void findCreators();
          }}
        >
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">CATEGORY</p>
            <Select className="mt-2 h-12 rounded-2xl" value={nicheId} onChange={(event) => setNicheId(event.target.value)} aria-label="Category">
              <option value="">Choose a category</option>
              {DISCOVERY_NICHES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </Select>
            <p className="mt-2 text-sm text-muted-foreground">These categories are the ones used to match creators later.</p>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">COUNTRY</p>
            <Select
              className="mt-2 h-12 rounded-2xl"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              aria-label="Country"
            >
              {DISCOVERY_COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </Select>
            <p className="mt-2 text-sm text-muted-foreground">Only a channel that publishes this country is stored.</p>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">AUDIENCE</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DISCOVERY_AUDIENCES.map((item) => {
                const selected = selectedAudience === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    className={`rounded-full border px-4 py-2 text-sm ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
                    onClick={() => {
                      setMinSubscribers(String(item.min));
                      setMaxSubscribers(String(item.max));
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{audienceHint}</p>
          </div>

          <div className="rounded-2xl border">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters
              <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
            {filtersOpen ? (
              <div className="space-y-3 border-t px-4 py-3">
                <Input
                  type="number"
                  min={MIN_CREATOR_SUBSCRIBERS}
                  step={1000}
                  placeholder="Min subscribers"
                  aria-label="Minimum subscribers"
                  value={minSubscribers}
                  onChange={(event) => setMinSubscribers(event.target.value)}
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (!Number.isFinite(value) || value < MIN_CREATOR_SUBSCRIBERS) setMinSubscribers(String(MIN_CREATOR_SUBSCRIBERS));
                  }}
                />
                <Input
                  type="number"
                  min={MIN_CREATOR_SUBSCRIBERS}
                  max={MAX_CREATOR_SUBSCRIBERS}
                  step={1000}
                  placeholder="Max subscribers"
                  aria-label="Maximum subscribers"
                  value={maxSubscribers}
                  onChange={(event) => setMaxSubscribers(event.target.value)}
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (!Number.isFinite(value) || value > MAX_CREATOR_SUBSCRIBERS) setMaxSubscribers(String(MAX_CREATOR_SUBSCRIBERS));
                    else if (value < MIN_CREATOR_SUBSCRIBERS) setMaxSubscribers(String(MIN_CREATOR_SUBSCRIBERS));
                  }}
                />
              </div>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-medium">How many creators do you want?</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {RESULT_COUNTS.map((count) => {
                const cost = estimateSearchQuota({ ...quotaInput, maxResults: count });
                const tooCostly = quotaLeft != null && cost > quotaLeft;
                return (
                  <button
                    key={count}
                    type="button"
                    disabled={tooCostly}
                    title={`Up to about ${formatNumber(cost)} units`}
                    className={`h-12 rounded-full text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${maxResults === count ? "bg-primary text-primary-foreground" : "border bg-card"}`}
                    onClick={() => setMaxResults(count)}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Only creators with a usable public email or a social profile are kept.</p>
          </div>

          <p className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm">
            {niche
              ? `This search uses up to about ${formatNumber(estimatedQuota)} YouTube API units.`
              : "Choose a category to see how many YouTube API units this search may use."}
          </p>
          <Button type="submit" className="h-12 w-full rounded-full text-base" disabled={pending || youtube === false || overQuota}>
            {pending ? "Finding..." : "Find Creators"}
          </Button>
          {overQuota ? (
            <p className="text-sm text-muted-foreground">
              {formatNumber(quotaLeft)} units left today. This search may need up to about {formatNumber(estimatedQuota)}.
            </p>
          ) : null}
        </form>
      </section>

      {jobs.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">RECENT</p>
          {jobs.slice(0, 5).map((job) => {
            const summary = `${job.creatorCount} creator${job.creatorCount === 1 ? "" : "s"} · ${job.emailCount} email${job.emailCount === 1 ? "" : "s"}`;
            const when = formatAgo(job.createdAt);
            const detail = job.status === "QUEUED" || job.status === "RUNNING"
              ? `${summary} · in progress`
              : job.status === "CANCELLED"
                ? `${summary} · stopped`
                : job.status === "FAILED"
                  ? "Failed"
                  : when
                    ? `${summary} · ${when}`
                    : summary;
            return (
              <button key={job.id} className="w-full rounded-2xl border bg-card px-4 py-3 text-left" disabled={!job.processingJobId} onClick={() => job.processingJobId && setActive({ jobId: job.processingJobId, title: job.name, status: job.status })}>
                <span className="block truncate text-sm font-medium">{job.name.split("·")[0]?.trim() || job.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
              </button>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
