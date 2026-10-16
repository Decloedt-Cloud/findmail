"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { toast } from "sonner";
import { ALL_COUNTRIES, MIN_CREATOR_SUBSCRIBERS } from "@/lib/constants";
import { api } from "@/lib/client";
import { CreatorResultList } from "@/components/creator-result-list";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { formatAgo, formatNumber } from "@/lib/utils";
import { estimateSearchQuota } from "@/lib/youtube/estimate";
import type { CreatorRow } from "@/lib/types";

const QUICK_TOPICS = ["Gaming", "Tech", "Finance", "Business", "Fitness", "Beauty", "Education", "Travel", "Food", "Music", "Comedy"];
const RESULT_COUNTS = [10, 25, 50, 100];

type SearchJob = { id: string; processingJobId: string | null; name: string; status: string; emailCount: number; creatorCount: number; createdAt: string };

export default function DiscoverPage() {
  const [topic, setTopic] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [countries, setCountries] = useState<string[]>(["FR"]);
  const [extraCountry, setExtraCountry] = useState("");
  const [minSubscribers, setMinSubscribers] = useState(String(MIN_CREATOR_SUBSCRIBERS));
  const [maxSubscribers, setMaxSubscribers] = useState("");
  const [recencyDays, setRecencyDays] = useState("");
  const [requireEmail, setRequireEmail] = useState(false);
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
    if (!active) return;
    let cancelled = false;
    let timer = 0;
    setResults([]);
    setResultTotal(0);
    setLive(null);
    setResultsLoading(true);

    const pull = async () => {
      try {
        const jobResult = await api<{ job: { status: string; progress: number; errorSummary: string | null; payload: { phase?: unknown; scanned?: unknown } | null; searchJob: { maxResults: number; quotaUsed: number } | null } }>(`/api/jobs/${active.jobId}`);
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
          jobId: active.jobId,
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
  }, [active?.jobId, resultSort]);

  const topicKeywords = topic.split(",").map((item) => item.trim()).filter(Boolean);
  const keywordCount = Math.max(1, topicKeywords.length);
  const countryCount = Math.max(1, countries.length);
  const estimatedQuota = estimateSearchQuota({
    keywordCount,
    countryCount,
    maxResults,
    includeRecentVideos: Boolean(recencyDays),
    keywords: topicKeywords,
    countries,
  });
  const quotaLeft = quota ? Math.max(0, quota.daily - quota.used) : null;
  const overQuota = quotaLeft != null && estimatedQuota > quotaLeft;
  const quotaRatio = quota && quota.daily > 0 ? Math.min(100, Math.round((quota.used / quota.daily) * 100)) : 0;
  const searchFinished = active ? ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(active.status) : false;

  async function findCreators() {
    const keywords = topic.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
    if (keywords.length === 0) {
      toast.error("Enter a topic or niche");
      return;
    }
    if (countries.length === 0) {
      toast.error("Choose at least one country in Filters");
      return;
    }
    setPending(true);
    try {
      const result = await api<{ processingJobId: string; estimatedQuota: number }>("/api/discovery/search", {
        method: "POST",
        body: JSON.stringify({
          keywords,
          niche: keywords.length === 1 ? keywords[0] : undefined,
          countries,
          minSubscribers: Math.max(MIN_CREATOR_SUBSCRIBERS, Number(minSubscribers) || MIN_CREATOR_SUBSCRIBERS),
          maxSubscribers: maxSubscribers ? Number(maxSubscribers) : undefined,
          maxResults,
          requirePublicEmail: requireEmail,
          recencyDays: recencyDays ? Number(recencyDays) : undefined,
        }),
      });
      toast.success(`Search queued. Estimated quota: ${formatNumber(result.estimatedQuota)} units.`);
      setLive(null);
      setResults([]);
      setResultTotal(0);
      setActive({ jobId: result.processingJobId, title: keywords[0] ?? topic, status: "QUEUED" });
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
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">TOPIC OR NICHE</p>
            <Input
              className="mt-2 h-12 rounded-2xl"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Gaming, AI tools, cooking..."
              aria-label="Topic or niche"
            />
            <p className="mt-2 text-sm text-muted-foreground">Search a topic or niche to find relevant YouTube creators</p>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">COUNTRIES</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {countries.map((code) => (
                <button key={code} type="button" className="rounded-full border bg-card px-3 py-1.5 text-sm" onClick={() => setCountries((current) => current.filter((item) => item !== code))}>
                  {code} ×
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {countries.length === 0 ? "Choose at least one country." : "Only channels that declare this country on YouTube are shown."}
            </p>
            <div className="mt-2 flex gap-2">
              <Select value={extraCountry} onChange={(event) => setExtraCountry(event.target.value)} aria-label="Add a country">
                <option value="">Add a country</option>
                {ALL_COUNTRIES.filter((country) => !countries.includes(country.code)).map((country) => (
                  <option key={country.code} value={country.code}>{country.name}</option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (extraCountry) setCountries((current) => [...current, extraCountry]);
                  setExtraCountry("");
                }}
              >
                Add
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">MINIMUM SUBSCRIBERS</p>
            <Input
              className="mt-2 h-12 rounded-2xl"
              type="number"
              min={0}
              step={1000}
              aria-label="Minimum subscribers"
              value={minSubscribers}
              onChange={(event) => setMinSubscribers(event.target.value)}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (!Number.isFinite(value) || value < MIN_CREATOR_SUBSCRIBERS) setMinSubscribers(String(MIN_CREATOR_SUBSCRIBERS));
              }}
            />
            <p className="mt-2 text-sm text-muted-foreground">Only creators with at least {formatNumber(MIN_CREATOR_SUBSCRIBERS)} subscribers.</p>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">QUICK SEARCH</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_TOPICS.map((item) => {
                const selected = topic.trim().toLowerCase() === item.toLowerCase();
                return (
                  <button
                    key={item}
                    type="button"
                    className={`rounded-full border px-4 py-2 text-sm ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
                    onClick={() => setTopic(item)}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
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
                <Input type="number" min={0} placeholder="Max subscribers" aria-label="Maximum subscribers" value={maxSubscribers} onChange={(event) => setMaxSubscribers(event.target.value)} />
                <Input type="number" min={1} placeholder="Active within days" aria-label="Recent video within days" value={recencyDays} onChange={(event) => setRecencyDays(event.target.value)} />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={requireEmail} onChange={(event) => setRequireEmail(event.target.checked)} />
                  Also open the public website when a link is written in the description
                </label>
              </div>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-medium">How many creators do you want?</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {RESULT_COUNTS.map((count) => {
                const cost = estimateSearchQuota({ keywordCount, countryCount, maxResults: count, includeRecentVideos: Boolean(recencyDays), keywords: topicKeywords, countries });
                const tooCostly = quotaLeft != null && cost > quotaLeft;
                return (
                  <button
                    key={count}
                    type="button"
                    disabled={tooCostly}
                    title={tooCostly ? `Needs about ${formatNumber(cost)} units` : `About ${formatNumber(cost)} units`}
                    className={`h-12 rounded-full text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${maxResults === count ? "bg-primary text-primary-foreground" : "border bg-card"}`}
                    onClick={() => setMaxResults(count)}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Creators are shown even when no public email is found.</p>
          </div>

          <Button type="submit" className="h-12 w-full rounded-full text-base" disabled={pending || youtube === false || countries.length === 0 || overQuota}>
            {pending ? "Finding..." : overQuota ? `${formatNumber(quotaLeft)} units left` : `Find Creators · ~${formatNumber(estimatedQuota)}`}
          </Button>
          {overQuota ? <p className="text-sm text-muted-foreground">This search needs about {formatNumber(estimatedQuota)} units.</p> : null}
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
