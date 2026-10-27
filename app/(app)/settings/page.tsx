"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Settings = {
  integrations: {
    youtube: boolean;
    redis: boolean;
    database: boolean;
    auth: boolean;
    verification: { provider: string; configured: boolean };
    contactSearch: { provider: string; configured: boolean };
    limits: { maxPagesPerDomain: number; requestTimeoutMs: number; maxConcurrentJobs: number; youtubeDailyQuota: number };
  };
  settings: Record<string, string>;
  user: { role: string; email: string; name?: string | null };
};

export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [exportDays, setExportDays] = useState("30");
  const [creatorDays, setCreatorDays] = useState("0");

  useEffect(() => {
    api<Settings>("/api/settings")
      .then((settings) => {
        setData(settings);
        setExportDays(settings.settings.exportRetentionDays || "30");
        setCreatorDays(settings.settings.creatorRetentionDays || "0");
      })
      .catch(() => undefined);
  }, []);

  if (!data) return null;
  const admin = data.user.role === "ADMIN";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Signed in as {data.user.email}. Secret values are never shown.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Integrations</CardTitle><CardDescription>Missing optional providers stay disabled. The app does not simulate them.</CardDescription></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <Status label="YouTube Data API" ok={data.integrations.youtube} />
          <Status label="Redis / background jobs" ok={data.integrations.redis} />
          <Status label="Database" ok={data.integrations.database} />
          <Status label="Authentication secret" ok={data.integrations.auth} />
          <Status label={`Email verification (${data.integrations.verification.provider})`} ok={data.integrations.verification.configured} />
          <Status label={`Contact provider (${data.integrations.contactSearch.provider})`} ok={data.integrations.contactSearch.configured} />
          <p className="md:col-span-2 text-muted-foreground">Up to {data.integrations.limits.maxPagesPerDomain} pages per site, {data.integrations.limits.requestTimeoutMs} ms timeout, {data.integrations.limits.maxConcurrentJobs} concurrent jobs, {data.integrations.limits.youtubeDailyQuota} daily YouTube units tracked by this app.</p>
        </CardContent>
      </Card>
      {admin ? (
        <Card>
          <CardHeader><CardTitle>Retention</CardTitle><CardDescription>Creator retention of 0 keeps records until someone deletes them. Export files expire after the chosen number of days.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className="text-sm">Export retention days<Input value={exportDays} onChange={(event) => setExportDays(event.target.value)} type="number" min={1} /></label>
            <label className="text-sm">Creator retention days<Input value={creatorDays} onChange={(event) => setCreatorDays(event.target.value)} type="number" min={0} /></label>
            <Button
              onClick={async () => {
                try {
                  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ exportRetentionDays: Number(exportDays), creatorRetentionDays: Number(creatorDays) }) });
                  toast.success("Retention saved");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not save settings");
                }
              }}
            >
              Save
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {admin ? (
        <Card>
          <CardHeader><CardTitle>Team access</CardTitle><CardDescription>New users can sign in with the password you set here. It is hashed before storage.</CardDescription></CardHeader>
          <CardContent>
            <form
              className="grid gap-2 md:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                try {
                  await api("/api/settings", {
                    method: "POST",
                    body: JSON.stringify({
                      name: form.get("name"),
                      email: form.get("email"),
                      password: form.get("password"),
                      role: form.get("role"),
                    }),
                  });
                  event.currentTarget.reset();
                  toast.success("User created");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not create the user");
                }
              }}
            >
              <Input name="name" placeholder="Name" required />
              <Input name="email" type="email" placeholder="Email" required />
              <Input name="password" type="password" minLength={8} placeholder="Password" required />
              <select name="role" className="h-10 rounded-lg border bg-card px-3 text-sm"><option value="MEMBER">Member</option><option value="ADMIN">Administrator</option></select>
              <Button type="submit">Create user</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return <p>{ok ? "Ready" : "Not configured"} · {label}</p>;
}
