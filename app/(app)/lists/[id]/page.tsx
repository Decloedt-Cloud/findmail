"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreatorsTable } from "@/components/creators-table";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ListDetail = { id: string; name: string; notes: string | null };

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  const [source, setSource] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api<{ list: ListDetail }>(`/api/contact-lists/${params.id}`).then((result) => setList(result.list)).catch(() => undefined);
    api<{ lists: { id: string; name: string }[] }>("/api/contact-lists").then((result) => setOthers(result.lists.filter((item) => item.id !== params.id))).catch(() => undefined);
  }, [params.id]);

  if (!list) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{list.name}</h1>
          <p className="text-sm text-muted-foreground">{list.notes || "No notes"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={source} onChange={(event) => setSource(event.target.value)} className="w-56">
            <option value="">Merge from...</option>
            {others.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Button
            variant="outline"
            disabled={!source}
            onClick={async () => {
              try {
                const result = await api<{ added: number }>(`/api/contact-lists/${list.id}/merge`, {
                  method: "POST",
                  body: JSON.stringify({ sourceListId: source, excludeDuplicateEmails: true }),
                });
                toast.success(`Added ${result.added} creators`);
                router.refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Merge failed");
              }
            }}
          >
            Merge
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await api("/api/exports", { method: "POST", body: JSON.stringify({ scope: "CONTACT_LIST", listId: list.id }) });
                toast.success("Export queued");
                router.push("/exports");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Export failed");
              }
            }}
          >
            Export list
          </Button>
          <Button variant="destructive" onClick={() => setConfirm(true)}>Delete list</Button>
        </div>
      </div>
      <CreatorsTable listId={list.id} />
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this list?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Creators stay in the database. Only the list membership is removed.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await api(`/api/contact-lists/${list.id}`, { method: "DELETE" });
                router.push("/lists");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form
        className="hidden"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await api(`/api/contact-lists/${list.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: form.get("name"), notes: form.get("notes") }),
          });
        }}
      >
        <Input name="name" defaultValue={list.name} />
        <Textarea name="notes" defaultValue={list.notes || ""} />
      </form>
    </div>
  );
}
