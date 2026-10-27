"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { StoredIcpOffer, StoredIcpProfile } from "@/lib/icp/snapshot";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";

type IcpDetail = {
  id: string;
  brandName: string;
  websiteUrl: string;
  analysisNote: string | null;
  searchQueries: string[];
  icps: StoredIcpProfile[];
  offers: StoredIcpOffer[];
};

export function IcpDetailDialog({ icpId, onClose }: { icpId: string | null; onClose: () => void }) {
  const [icp, setIcp] = useState<IcpDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState(icpId);
  if (icpId !== loadedId) {
    setLoadedId(icpId);
    setIcp(null);
    setError(null);
  }

  useEffect(() => {
    if (!icpId) return;
    let cancelled = false;
    api<{ icp: IcpDetail }>(`/api/brand-icps/${icpId}`)
      .then((result) => {
        if (!cancelled) setIcp(result.icp);
      })
      .catch((reason: unknown) => {
        console.error("[ICP] load failed:", reason);
        if (!cancelled) setError("We couldn't load this ICP. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [icpId]);

  return (
    <Dialog open={icpId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[min(85vh,44rem)] w-[min(100%-2rem,40rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{icp?.brandName || "ICP"}</DialogTitle>
          <DialogDescription>Simplified ICP used to find matching channels.</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!icp && !error ? <Skeleton className="h-40" /> : null}
        {icp ? (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Website</p>
              <a dir="ltr" className="mt-1 block break-all underline" href={icp.websiteUrl} target="_blank" rel="noreferrer">{icp.websiteUrl}</a>
            </div>
            {icp.icps.length === 0 ? <p className="text-muted-foreground">No ICP analysis is stored for this brand.</p> : null}
            {icp.icps.map((profile) => (
              <section key={profile.name} className="space-y-3">
                <h3 className="font-medium">{profile.name}</h3>
                {profile.description ? <p className="whitespace-pre-wrap text-muted-foreground">{profile.description}</p> : null}
                <Points label="Interests" items={profile.interests} />
                <Points label="Problems" items={profile.problems} />
                <Points label="Goals" items={profile.goals} />
                <Points label="Use cases" items={profile.useCases} />
                <Points label="Product categories" items={profile.productCategories} />
              </section>
            ))}
            {icp.offers.length > 0 ? (
              <section className="space-y-3">
                <h3 className="font-medium">Offers</h3>
                {icp.offers.map((offer) => (
                  <div key={offer.name} className="space-y-1">
                    <p className="font-medium">{offer.name}</p>
                    {offer.description ? <p className="whitespace-pre-wrap text-muted-foreground">{offer.description}</p> : null}
                    {offer.valueProposition ? <p>{offer.valueProposition}</p> : null}
                  </div>
                ))}
              </section>
            ) : null}
            {icp.searchQueries.length > 0 ? (
              <section className="space-y-2">
                <h3 className="font-medium">YouTube searches</h3>
                <ul className="list-disc space-y-1 pl-4">
                  {icp.searchQueries.map((query) => <li key={query}>{query}</li>)}
                </ul>
                {icp.analysisNote ? <p className="text-muted-foreground">{icp.analysisNote}</p> : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Points({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.map((item, index) => <li key={`${label}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}
