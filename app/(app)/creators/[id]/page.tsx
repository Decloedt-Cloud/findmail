"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { emailStatusLabel } from "@/lib/email/status";
import { emailOriginLabel } from "@/lib/creators/email";
import { countryName, formatDateTime, formatNumber } from "@/lib/utils";
import type { CreatorRow, EmailRow } from "@/lib/types";
import { ChannelAvatar } from "@/components/channel-avatar";
import { ChannelIcpSection } from "@/components/channel-icp-section";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/feedback";

export default function CreatorDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [creator, setCreator] = useState<(CreatorRow & { emails: EmailRow[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ creator: CreatorRow & { emails: EmailRow[] } }>(`/api/creators/${params.id}`)
      .then((result) => setCreator(result.creator))
      .catch((reason: Error) => setError(reason.message));
  }, [params.id]);

  if (error) return <EmptyState title="Creator unavailable" body={error} />;
  if (!creator) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-4">
          <ChannelAvatar url={creator.thumbnailUrl} name={creator.channelName} className="h-16 w-16 text-base" />
          <div>
            <h1 className="text-2xl font-semibold">{creator.channelName}</h1>
            <p className="text-sm text-muted-foreground">{creator.youtubeChannelId}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/creators")}>Back</Button>
          <Button
            onClick={async () => {
              try {
                const result = await api<{ job: { id: string } }>(`/api/creators/${creator.id}/discover-email`, { method: "POST" });
                toast.success("Email discovery queued");
                router.push(`/jobs/${result.job.id}`);
              } catch (reason) {
                toast.error(reason instanceof Error ? reason.message : "Could not queue discovery");
              }
            }}
          >
            Find public email
          </Button>
        </div>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Channel</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Country: {countryName(creator.country) || "Not provided by YouTube"}</p>
            <p>Language: {creator.language || "Not provided"}</p>
            <p className="break-words">
              ICP: {(creator.icps ?? []).length > 0
                ? (creator.icps ?? []).map((icp) => icp.brandName).join(", ")
                : "Not linked"}
            </p>
            <ChannelIcpSection profile={creator.channelIcp} />
            <p>Handle: {creator.channelHandle || "Not provided"}</p>
            <p>Subscribers: {creator.subscriberVisibility === "PUBLIC" ? formatNumber(creator.subscriberCount) : creator.subscriberVisibility}</p>
            <p>Average views: {creator.averageViews == null ? "Unavailable" : formatNumber(creator.averageViews)}</p>
            <p className="text-muted-foreground">{creator.averageViewsMethod || "Average is calculated only after the uploads playlist and video statistics are read."}</p>
            <p>Last public video: {creator.lastActiveAt ? formatDateTime(creator.lastActiveAt) : "Unavailable"}</p>
            <p>Videos: {formatNumber(creator.videoCount)}</p>
            <p>Views: {creator.viewCount ? formatNumber(Number(creator.viewCount)) : "Unavailable"}</p>
            <p><a className="underline" href={creator.channelUrl} target="_blank" rel="noreferrer">YouTube channel</a></p>
            <p>Website: {creator.officialWebsiteUrl ? <a className="underline" href={creator.officialWebsiteUrl} target="_blank" rel="noreferrer">{creator.officialWebsiteUrl}</a> : "Not in the public description"}</p>
            <p>Instagram: {creator.instagramUrl ? <a className="underline" href={creator.instagramUrl} target="_blank" rel="noreferrer">{creator.instagramUrl}</a> : "Not in the public description"}</p>
            <p>X / Twitter: {creator.twitterUrl ? <a className="underline" href={creator.twitterUrl} target="_blank" rel="noreferrer">{creator.twitterUrl}</a> : "Not in the public description"}</p>
            <p>TikTok: {creator.tiktokUrl ? <a className="underline" href={creator.tiktokUrl} target="_blank" rel="noreferrer">{creator.tiktokUrl}</a> : "Not in the public description"}</p>
            <p className="text-muted-foreground">{creator.websiteEvidence}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Description</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{creator.description || "No description stored."}</p></CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader><CardTitle>Matched video</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {creator.matchedVideoUrl ? (
            <>
              <p>{creator.matchedVideoTitle || "Untitled video"}</p>
              <p><a className="underline" href={creator.matchedVideoUrl} target="_blank" rel="noreferrer">{creator.matchedVideoUrl}</a></p>
              <p>Views: {creator.matchedVideoViews == null ? "Unavailable" : formatNumber(creator.matchedVideoViews)}</p>
              <p>Published: {creator.matchedVideoPublishedAt ? formatDateTime(creator.matchedVideoPublishedAt) : "Unavailable"}</p>
            </>
          ) : (
            <p className="text-muted-foreground">No public video from search.list is stored for this channel.</p>
          )}
        </CardContent>
      </Card>
      {creator.emails.length > 0 ? <Card>
        <CardHeader><CardTitle>Public emails</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {creator.emails.map((email) => (
            <article key={email.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{email.emailAddress}</strong>
                <Badge tone={statusTone(email.verificationStatus)}>{emailStatusLabel(email.verificationStatus)}</Badge>
                <Badge tone="muted">{email.confidenceStatus}</Badge>
              </div>
              <p className="mt-2 text-muted-foreground">{email.provenanceNote}</p>
              <p>Email from: {emailOriginLabel(email.sourceType)}</p>
              {email.sourceUrl ? <p><a className="underline" href={email.sourceUrl} target="_blank" rel="noreferrer">{email.sourceUrl}</a></p> : null}
              <p>Page title: {email.pageTitle || "—"}</p>
              <p>Official domain: {email.isOnOfficialDomain ? "Yes" : "No"} · Generic inbox: {email.isGenericInbox ? "Yes" : "No"}</p>
              <p>Found {formatDateTime(email.discoveredAt)}{email.verifiedAt ? ` · Provider ${email.verificationProvider} at ${formatDateTime(email.verifiedAt)}` : ""}</p>
              {email.verificationStatus !== "VERIFIED" && email.verificationStatus !== "INVALID" ? (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const result = await api<{ job: { id: string } }>("/api/emails/verify", { method: "POST", body: JSON.stringify({ emailIds: [email.id] }) });
                      toast.success("Verification queued");
                      router.push(`/jobs/${result.job.id}`);
                    } catch (reason) {
                      toast.error(reason instanceof Error ? reason.message : "Verification is not available");
                    }
                  }}
                >
                  Verify with configured provider
                </Button>
              ) : null}
            </article>
          ))}
        </CardContent>
      </Card> : null}
      <Link className="text-sm underline" href="/creators">Return to all creators</Link>
    </div>
  );
}
