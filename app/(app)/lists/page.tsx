"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/feedback";

type ListRow = { id: string; name: string; notes: string | null; createdAt: string; _count: { members: number } };

const SUGGESTIONS = ["US AI Creators", "Canada Tech Creators", "AI Tools 10K–100K", "Software Developers", "Verified Business Emails"];

export default function ListsPage() {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    const result = await api<{ lists: ListRow[] }>("/api/contact-lists");
    setLists(result.lists);
  }

  useEffect(() => {
    api<{ lists: ListRow[] }>("/api/contact-lists").then((result) => setLists(result.lists)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contact lists</h1>
        <p className="text-sm text-muted-foreground">Organize prospects for review and export. This release does not send messages.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>New list</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="rounded-full border px-3 py-1 text-xs" onClick={() => setName(suggestion)}>{suggestion}</button>
            ))}
          </div>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="List name" />
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
          <Button
            onClick={async () => {
              try {
                await api("/api/contact-lists", { method: "POST", body: JSON.stringify({ name, notes: notes || undefined }) });
                setName("");
                setNotes("");
                toast.success("List created");
                await load();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not create the list");
              }
            }}
          >
            Create list
          </Button>
        </CardContent>
      </Card>
      {lists.length === 0 ? <EmptyState title="No lists yet" body="Create a list, then add creators from the All Creators table." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {lists.map((list) => (
            <Link key={list.id} href={`/lists/${list.id}`} className="rounded-xl border bg-card p-4 hover:bg-accent">
              <p className="font-medium">{list.name}</p>
              <p className="text-sm text-muted-foreground">{list._count.members} creators · {formatDate(list.createdAt)}</p>
              {list.notes ? <p className="mt-2 text-sm">{list.notes}</p> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
