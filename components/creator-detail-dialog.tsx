"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { countryName, formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import type { CreatorRow, EmailRow } from "@/lib/types";
import { ChannelAvatar } from "@/components/channel-avatar";
import { ChannelIcpSection } from "@/components/channel-icp-section";
import { Badge, statusTone } from "@/components/ui/badge";
import { emailStatusLabel } from "@/lib/email/status";
import { channelOriginLabel, emailOriginLabel } from "@/lib/creators/email";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";

export function CreatorDetailDialog({ creatorId, onClose }: { creatorId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [creator, setCreator] = useState<(CreatorRow & { emails: EmailRow[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedId, setLoadedId] = useState(creatorId);
  if (creatorId !== loadedId) {
    setLoadedId(creatorId);
    setCreator(null);
    setError(null);
  }

  useEffect(() => {
    if (!creatorId) return;
    let cancelled = false;
    api<{ creator: CreatorRow & { emails: EmailRow[] } }>(`/api/creators/${creatorId}`)
      .then((result) => {
        if (!cancelled) setCreator(result.creator);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [creatorId]);

  return (
    <Dialog open={creatorId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[min(85vh,44rem)] w-[min(100%-2rem,40rem)] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-8">
            <ChannelAvatar url={creator?.thumbnailUrl ?? null} name={creator?.channelName || "Channel"} className="h-11 w-11" />
            <div className="min-w-0">
              <DialogTitle className="truncate">
                {creator?.channelUrl ? (
                  <a className="cursor-pointer hover:underline" href={creator.channelUrl} target="_blank" rel="noreferrer">{creator.channelName}</a>
                ) : (
                  creator?.channelName || "Channel"
                )}
              </DialogTitle>
              <DialogDescription className="truncate">{creator?.youtubeChannelId || "Loading the channel"}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!creator && !error ? <Skeleton className="h-40" /> : null}
        {creator ? (
          <div className="space-y-4 text-sm">
            <dl className="space-y-2">
              <Row label="ICP" value={(creator.icps ?? []).map((icp) => icp.brandName).join(", ") || "Not linked"} />
              <Row label="Handle" value={creator.channelHandle || "Not provided"} />
              <Row label="Country" value={countryName(creator.country) || "Not provided by YouTube"} />
              <Row label="Subscribers" value={creator.subscriberVisibility === "PUBLIC" ? formatNumber(creator.subscriberCount) : creator.subscriberVisibility} />
              <Row label="Average views" value={creator.averageViews == null ? "Unavailable" : formatNumber(creator.averageViews)} />
              <Row label="Last public video" value={creator.lastActiveAt ? formatDateTime(creator.lastActiveAt) : "Unavailable"} />
              <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
                <dt className="text-muted-foreground">Matched video</dt>
                <dd className="min-w-0 break-words">
                  {creator.matchedVideoUrl ? (
                    <a className="underline" href={creator.matchedVideoUrl} target="_blank" rel="noreferrer">{creator.matchedVideoTitle || "Open"}</a>
                  ) : (
                    creator.matchedVideoTitle || "—"
                  )}
                </dd>
              </div>
              <Row label="Found via" value={channelOriginLabel(creator.discoverySource)} />
              {creator.primaryEmail ? <Row label="Email from" value={emailOriginLabel(creator.primaryEmail.sourceType)} /> : null}
              <Row label="Discovered" value={formatDate(creator.discoveredAt)} />
            </dl>
            <ChannelIcpSection profile={creator.channelIcp} />
            <div className="space-y-1">
              <p className="text-muted-foreground">Channel description</p>
              <p className="whitespace-pre-wrap">{creator.description || "No description stored."}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="rounded-full border px-3 py-1 text-xs" href={creator.channelUrl} target="_blank" rel="noreferrer">YouTube</a>
              {creator.officialWebsiteUrl ? <a className="rounded-full border px-3 py-1 text-xs" href={creator.officialWebsiteUrl} target="_blank" rel="noreferrer">Website</a> : null}
              {creator.instagramUrl ? <a className="rounded-full border px-3 py-1 text-xs" href={creator.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}
              {creator.twitterUrl ? <a className="rounded-full border px-3 py-1 text-xs" href={creator.twitterUrl} target="_blank" rel="noreferrer">X</a> : null}
              {creator.tiktokUrl ? <a className="rounded-full border px-3 py-1 text-xs" href={creator.tiktokUrl} target="_blank" rel="noreferrer">TikTok</a> : null}
            </div>
            {creator.emails.length > 0 ? (
              <div className="space-y-2">
                {creator.emails.map((email) => (
                  <div key={email.id} className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all font-medium">{email.emailAddress}</span>
                    <Badge tone={statusTone(email.verificationStatus)}>{emailStatusLabel(email.verificationStatus)}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No public email</p>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api<{ job: { id: string } }>(`/api/creators/${creator.id}/discover-email`, { method: "POST" })
                  .then((result) => {
                    toast.success("Email discovery queued");
                    router.push(`/jobs/${result.job.id}`);
                  })
                  .catch((reason: unknown) => {
                    toast.error(reason instanceof Error ? reason.message : "Could not queue discovery");
                    setBusy(false);
                  });
              }}
            >
              Find public email
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
