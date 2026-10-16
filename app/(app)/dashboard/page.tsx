"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/client";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { Badge, statusTone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/feedback";

type Overview = {
  cards: Record<string, number>;
  creatorsPerDay: { date: string; count: number }[];
  emailsPerDay: { date: string; count: number }[];
  emailsByNiche: { niche: string; creators: number; withEmail: number; rate: number }[];
  creatorsByCountry: { country: string; count: number }[];
  subscriberRanges: { range: string; count: number }[];
  sources: { source: string; count: number }[];
  recentJobs: { id: string; name: string; status: string; progress: number; createdAt: string }[];
  latestCreators: { id: string; channelName: string; country: string | null; niche: string | null; discoveredAt: string }[];
  recentExports: { id: string; fileName: string; status: string; rowCount: number; createdAt: string }[];
};

const CARDS = [
  ["totalCreators", "Creators discovered"],
  ["uniqueEmails", "Unique public emails"],
  ["creatorsWithEmail", "Creators with an email"],
  ["emailsUnverified", "Emails not yet verified"],
  ["emailsVerified", "Verified by a provider"],
  ["creatorsWithoutEmail", "Creators without an email"],
  ["duplicatesPrevented", "Duplicates prevented"],
  ["activeJobs", "Active processing jobs"],
] as const;

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>("/api/analytics/overview")
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <EmptyState title="Dashboard unavailable" body={error} />;
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
    );
  }

  const empty = data.cards.totalCreators === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live counts from PostgreSQL. Empty charts mean no creators have been stored yet.</p>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map(([key, label]) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{formatNumber(data.cards[key])}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      {empty ? (
        <EmptyState title="No creators yet" body="Run a YouTube discovery search or import a CSV. Statistics will update from the records you store." action={<Link className="text-sm font-medium underline" href="/discover">Discover creators</Link>} />
      ) : null}
      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Creators discovered per day">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.creatorsPerDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line dataKey="count" stroke="var(--primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Emails found per day">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.emailsPerDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line dataKey="count" stroke="var(--primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Email discovery rate by niche">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.emailsByNiche}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="niche" tick={{ fontSize: 11 }} interval={0} angle={-20} height={70} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="rate" fill="var(--primary)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Creators by country">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.creatorsByCountry}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="country" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--primary)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Subscriber ranges">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.subscriberRanges}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--primary)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Discovery source">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.sources}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="source" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--primary)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Recent jobs</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.recentJobs.length === 0 ? <p className="text-sm text-muted-foreground">No jobs yet.</p> : data.recentJobs.map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-lg border p-3 hover:bg-accent">
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{job.name}</span><Badge tone={statusTone(job.status)}>{job.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(job.createdAt)}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Latest creators</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.latestCreators.length === 0 ? <p className="text-sm text-muted-foreground">No creators yet.</p> : data.latestCreators.map((creator) => (
              <Link key={creator.id} href={`/creators/${creator.id}`} className="block rounded-lg border p-3 hover:bg-accent">
                <p className="truncate text-sm font-medium">{creator.channelName}</p>
                <p className="text-xs text-muted-foreground">{creator.country || "Country not provided"} · {creator.niche || "No niche"}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent exports</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.recentExports.length === 0 ? <p className="text-sm text-muted-foreground">No exports yet.</p> : data.recentExports.map((item) => (
              <Link key={item.id} href="/exports" className="block rounded-lg border p-3 hover:bg-accent">
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.fileName}</span><Badge tone={statusTone(item.status)}>{item.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{item.rowCount} rows</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="h-64">{children}</CardContent>
    </Card>
  );
}
