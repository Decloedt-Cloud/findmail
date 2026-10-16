"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/client";
import type { CreatorRow } from "@/lib/types";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export default function EmailFinderPage() {
  const router = useRouter();
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [provider, setProvider] = useState<string>("none");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api<{ creators: CreatorRow[] }>("/api/creators?hasEmail=false&pageSize=50").then((result) => setCreators(result.creators)).catch(() => undefined);
    api<{ integrations: { verification: { provider: string; configured: boolean } } }>("/api/settings")
      .then((result) => {
        setProvider(result.integrations.verification.provider);
        setConfigured(result.integrations.verification.configured);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Email finder</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The finder reads public websites and contact pages linked from a creator, plus emails already published in the channel description. It does not guess addresses, and it does not send test messages.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Verification provider</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {configured ? <p>Configured provider: {provider}. Results are stored with the provider name and time.</p> : <p>No verification provider is configured. Discovered addresses can be syntax-checked, but they will not be marked verified.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Creators without a stored email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {creators.length === 0 ? <EmptyState title="Nothing waiting" body="Creators without a stored email will show up here after discovery or import." /> : creators.map((creator) => (
            <label key={creator.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(creator.id)}
                  onChange={(event) => setSelected((current) => event.target.checked ? [...current, creator.id] : current.filter((id) => id !== creator.id))}
                />
                {creator.channelName}
              </span>
              <Badge tone={statusTone(creator.emailSearchStatus)}>{creator.emailSearchStatus.replaceAll("_", " ")}</Badge>
            </label>
          ))}
          <Button
            disabled={selected.length === 0}
            onClick={async () => {
              try {
                const result = await api<{ job: { id: string } }>("/api/creators/bulk-discover-email", {
                  method: "POST",
                  body: JSON.stringify({ creatorIds: selected }),
                });
                toast.success("Email discovery queued");
                router.push(`/jobs/${result.job.id}`);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not start discovery");
              }
            }}
          >
            Find public emails
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
