"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { flexRender } from "@tanstack/react-table";
import { getCoreRowModel, legacyCreateColumnHelper, useLegacyTable } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { formatDate, formatNumber } from "@/lib/utils";
import type { CreatorRow } from "@/lib/types";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/feedback";

const columnHelper = legacyCreateColumnHelper<CreatorRow>();

function externalLink(href: string | null) {
  if (!href) return "—";
  return <a className="underline" href={href} target="_blank" rel="noreferrer">Open</a>;
}

export function CreatorsTable({ listId, onlyWithEmail = !listId }: { listId?: string; onlyWithEmail?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<CreatorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [niche, setNiche] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [minSubscribers, setMinSubscribers] = useState("");
  const [maxSubscribers, setMaxSubscribers] = useState("");
  const [sort, setSort] = useState("discoveredAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState<CreatorRow | null>(null);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [listTarget, setListTarget] = useState("");
  const [confirm, setConfirm] = useState<"hide" | "delete" | null>(null);

  async function load(nextPage = page) {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(pageSize),
      sort,
      direction,
    });
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    if (niche) params.set("niche", niche);
    if (emailStatus) params.set("emailStatus", emailStatus);
    if (minSubscribers) params.set("minSubscribers", minSubscribers);
    if (maxSubscribers) params.set("maxSubscribers", maxSubscribers);
    if (listId) params.set("listId", listId);
    if (onlyWithEmail && !emailStatus) params.set("hasEmail", "true");
    try {
      const result = await api<{ creators: CreatorRow[]; total: number }>(`/api/creators?${params.toString()}`);
      setRows(result.creators);
      setTotal(result.total);
      setPage(nextPage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load creators");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams({ page: "1", pageSize: String(pageSize), sort, direction });
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    if (niche) params.set("niche", niche);
    if (emailStatus) params.set("emailStatus", emailStatus);
    if (minSubscribers) params.set("minSubscribers", minSubscribers);
    if (maxSubscribers) params.set("maxSubscribers", maxSubscribers);
    if (listId) params.set("listId", listId);
    if (onlyWithEmail && !emailStatus) params.set("hasEmail", "true");
    let cancelled = false;
    api<{ creators: CreatorRow[]; total: number }>(`/api/creators?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setRows(result.creators);
        setTotal(result.total);
        setPage(1);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setLoading(false);
          toast.error(error.message);
        }
      });
    api<{ lists: { id: string; name: string }[] }>("/api/contact-lists")
      .then((result) => {
        if (!cancelled) setLists(result.lists);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Filter changes are applied from the form submit handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, direction, listId]);

  const selectedIds = Object.entries(selection).filter(([, checked]) => checked).map(([id]) => id);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all on this page"
            checked={rows.length > 0 && rows.every((row) => selection[row.id])}
            onChange={(event) => {
              const next = { ...selection };
              for (const row of rows) next[row.id] = event.target.checked;
              setSelection(next);
            }}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.channelName}`}
            checked={Boolean(selection[row.original.id])}
            onChange={(event) => setSelection((current) => ({ ...current, [row.original.id]: event.target.checked }))}
          />
        ),
      }),
      columnHelper.accessor("channelName", {
        header: "Channel",
        cell: (info) => (
          <div className="flex items-center gap-3">
            <ChannelAvatar url={info.row.original.thumbnailUrl} name={info.row.original.channelName} className="h-9 w-9" />
            <div>
              <Link href={`/creators/${info.row.original.id}`} className="font-medium hover:underline">{info.getValue()}</Link>
              <p className="text-xs text-muted-foreground">{info.row.original.channelHandle || info.row.original.youtubeChannelId}</p>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor("channelUrl", {
        header: "YouTube",
        cell: (info) => <a className="text-sm underline" href={info.getValue()} target="_blank" rel="noreferrer">Open</a>,
      }),
      columnHelper.accessor("country", { header: "Country", cell: (info) => info.getValue() || "Not provided" }),
      columnHelper.accessor("niche", { header: "Niche", cell: (info) => info.getValue() || "—" }),
      columnHelper.accessor("subscriberCount", {
        header: () => <SortHeader label="Subscribers" active={sort === "subscribers"} direction={direction} onClick={() => toggleSort("subscribers")} />,
        cell: (info) => info.row.original.subscriberVisibility === "PUBLIC" ? formatNumber(info.getValue()) : info.row.original.subscriberVisibility === "HIDDEN" ? "Hidden" : "Unavailable",
      }),
      columnHelper.accessor("averageViews", {
        header: "Avg views",
        cell: (info) => info.getValue() == null ? "—" : formatNumber(info.getValue()),
      }),
      columnHelper.accessor("lastActiveAt", {
        header: "Last public video",
        cell: (info) => info.getValue() ? formatDate(info.getValue()) : "—",
      }),
      columnHelper.accessor("officialWebsiteUrl", {
        header: "website",
        cell: (info) => info.getValue() ? <a className="underline" href={info.getValue()!} target="_blank" rel="noreferrer">Site</a> : "—",
      }),
      columnHelper.accessor("instagramUrl", {
        header: "instagram",
        cell: (info) => externalLink(info.getValue()),
      }),
      columnHelper.accessor("twitterUrl", {
        header: "twitter",
        cell: (info) => externalLink(info.getValue()),
      }),
      columnHelper.accessor("tiktokUrl", {
        header: "tiktok",
        cell: (info) => externalLink(info.getValue()),
      }),
      columnHelper.accessor("matchedVideoTitle", {
        header: "matchedVideoTitle",
        cell: (info) => {
          const url = info.row.original.matchedVideoUrl;
          const title = info.getValue();
          if (!title && !url) return "—";
          return url ? <a className="underline" href={url} target="_blank" rel="noreferrer">{title || url}</a> : title;
        },
      }),
      columnHelper.display({
        id: "email",
        header: "Public email",
        cell: ({ row }) => row.original.primaryEmail?.emailAddress || null,
      }),
      columnHelper.display({
        id: "status",
        header: "Email status",
        cell: ({ row }) => {
          const status = row.original.primaryEmail?.verificationStatus;
          if (!status) return null;
          return <Badge tone={statusTone(status)}>{status.replaceAll("_", " ")}</Badge>;
        },
      }),
      columnHelper.display({
        id: "source",
        header: "Source",
        cell: ({ row }) => row.original.primaryEmail?.sourceType.replaceAll("_", " ") || row.original.discoverySource.replaceAll("_", " "),
      }),
      columnHelper.accessor("discoveredAt", {
        header: () => <SortHeader label="Discovered" active={sort === "discoveredAt"} direction={direction} onClick={() => toggleSort("discoveredAt")} />,
        cell: (info) => formatDate(info.getValue()),
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEvidence(row.original)}>Evidence</Button>
            <Button size="sm" variant="ghost" onClick={() => discover([row.original.id])}>Retry</Button>
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selection, sort, direction],
  );

  const table = useLegacyTable({
    data: rows,
    columns: columns as never,
    pageCount,
    state: { pagination: { pageIndex: page - 1, pageSize } },
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  function toggleSort(next: string) {
    if (sort === next) setDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setDirection("desc");
    }
  }

  async function discover(ids: string[]) {
    try {
      const result = await api<{ job: { id: string } }>("/api/creators/bulk-discover-email", {
        method: "POST",
        body: JSON.stringify({ creatorIds: ids }),
      });
      toast.success("Email discovery queued");
      router.push(`/jobs/${result.job.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue discovery");
    }
  }

  async function addToList() {
    if (!listTarget || selectedIds.length === 0) return;
    try {
      const result = await api<{ count: number }>(`/api/contact-lists/${listTarget}/members`, {
        method: "POST",
        body: JSON.stringify({ creatorIds: selectedIds, action: "add" }),
      });
      toast.success(`Added ${result.count} creators`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the list");
    }
  }

  async function exportSelected() {
    try {
      await api("/api/exports", {
        method: "POST",
        body: JSON.stringify({ scope: "SELECTED", creatorIds: selectedIds }),
      });
      toast.success("Export queued");
      router.push("/exports");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function bulk(action: "hide" | "delete") {
    try {
      await api("/api/creators/bulk", { method: "POST", body: JSON.stringify({ action, creatorIds: selectedIds }) });
      toast.success(action === "delete" ? "Creators deleted" : "Creators hidden");
      setSelection({});
      setConfirm(null);
      await load(page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 md:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search name or email" className="md:col-span-2" />
        <Input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} placeholder="Country" maxLength={2} />
        <Input value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="Niche" />
        <Select value={emailStatus} onChange={(event) => setEmailStatus(event.target.value)}>
          <option value="">Any email status</option>
          {["SYNTAX_VALID", "VERIFIED", "DISCOVERED", "UNKNOWN", "INVALID", "NEEDS_REVIEW", "NOT_FOUND"].map((status) => (
            <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
          ))}
        </Select>
        <Button type="submit">Filter</Button>
        <Input value={minSubscribers} onChange={(event) => setMinSubscribers(event.target.value)} placeholder="Min subscribers" type="number" />
        <Input value={maxSubscribers} onChange={(event) => setMaxSubscribers(event.target.value)} placeholder="Max subscribers" type="number" />
      </form>
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <span className="text-sm">{selectedIds.length} selected</span>
          <Select value={listTarget} onChange={(event) => setListTarget(event.target.value)} className="max-w-56">
            <option value="">Add to list</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={() => void addToList()} disabled={!listTarget}>Add</Button>
          <Button size="sm" variant="outline" onClick={() => void exportSelected()}>Export</Button>
          <Button size="sm" variant="outline" onClick={() => void discover(selectedIds)}>Find emails</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("hide")}>Hide</Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirm("delete")}>Delete</Button>
        </div>
      ) : null}
      {loading ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <EmptyState title="No creators with a public email" body="A creator stays off this list until an email is written in a public description or page. Nothing is shown in its place." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b bg-muted/60">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id} className="px-3 py-3 font-medium">{flexRender(header.column.columnDef.header, header.getContext())}</th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-3 align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span>{total} creators</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void load(page - 1)}>Previous</Button>
          <span className="px-2 py-1">Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => void load(page + 1)}>Next</Button>
        </div>
      </div>
      <Dialog open={Boolean(evidence)} onOpenChange={(open) => !open && setEvidence(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extraction evidence</DialogTitle>
            <DialogDescription>Only stored public sources are shown. A syntax check is not deliverability, and a published address is not consent.</DialogDescription>
          </DialogHeader>
          {evidence?.primaryEmail ? (
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted-foreground">Email</dt><dd>{evidence.primaryEmail.emailAddress}</dd></div>
              <div><dt className="text-muted-foreground">Status</dt><dd>{evidence.primaryEmail.verificationStatus}</dd></div>
              <div><dt className="text-muted-foreground">Method</dt><dd>{evidence.primaryEmail.extractionMethod}</dd></div>
              <div><dt className="text-muted-foreground">Source</dt><dd>{evidence.primaryEmail.sourceUrl ? <a className="underline" href={evidence.primaryEmail.sourceUrl} target="_blank" rel="noreferrer">{evidence.primaryEmail.sourceUrl}</a> : "—"}</dd></div>
              <div><dt className="text-muted-foreground">Page title</dt><dd>{evidence.primaryEmail.pageTitle || "—"}</dd></div>
              <div><dt className="text-muted-foreground">On official domain</dt><dd>{evidence.primaryEmail.isOnOfficialDomain ? "Yes" : "No"}</dd></div>
              <div><dt className="text-muted-foreground">Generic inbox</dt><dd>{evidence.primaryEmail.isGenericInbox ? "Yes" : "No"}</dd></div>
              <div><dt className="text-muted-foreground">Note</dt><dd>{evidence.primaryEmail.provenanceNote}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted-foreground">No public email is stored for this creator.</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? "Delete selected creators?" : "Hide selected creators?"}</DialogTitle>
            <DialogDescription>
              {confirm === "delete" ? "This permanently removes the creators and their stored emails." : "Hidden creators leave the default table and can be restored from the database by an administrator."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === "delete" ? "destructive" : "default"} onClick={() => confirm && void bulk(confirm)}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({ label, active, direction, onClick }: { label: string; active: boolean; direction: "asc" | "desc"; onClick: () => void }) {
  return (
    <button type="button" className="font-medium" onClick={onClick}>
      {label} {active ? (direction === "asc" ? "↑" : "↓") : ""}
    </button>
  );
}
