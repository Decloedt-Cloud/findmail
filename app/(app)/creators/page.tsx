"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { CreatorRow } from "@/lib/types";
import { CreatorResultList } from "@/components/creator-result-list";

export default function CreatorsPage() {
  const [rows, setRows] = useState<CreatorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("relevance");
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction: "desc",
    });
    api<{ creators: CreatorRow[]; total: number }>(`/api/creators?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setRows(result.creators);
        setTotal(result.total);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, sort]);

  return (
    <CreatorResultList
      title="Creators"
      creators={rows}
      total={total}
      loading={loading}
      finished={!loading}
      sort={sort}
      onSort={(value) => {
        setSort(value);
        setPage(1);
      }}
      page={page}
      pageCount={Math.max(1, Math.ceil(total / pageSize))}
      onPage={setPage}
    />
  );
}
