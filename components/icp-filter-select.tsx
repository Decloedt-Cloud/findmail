"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type IcpOption = { id: string; brandName: string; websiteUrl: string };

function icpOptionLabel(brandName: string, websiteUrl: string) {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    return `${brandName} · ${host}`;
  } catch {
    return brandName;
  }
}

export function IcpFilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: IcpOption[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={cn("min-w-0 truncate", selected ? "text-foreground" : "text-muted-foreground")}>
          {selected ? icpOptionLabel(selected.brandName, selected.websiteUrl) : "Any ICP"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-300 bg-zinc-200 py-1 text-zinc-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
          <li>
            <button type="button" className={cn("block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-zinc-300 dark:hover:bg-zinc-800", value === "" && "bg-zinc-300 dark:bg-zinc-800")} onClick={() => choose("")}>
              Any ICP
            </button>
          </li>
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className={cn("block w-full cursor-pointer truncate px-3 py-2 text-left text-sm hover:bg-zinc-300 dark:hover:bg-zinc-800", option.id === value && "bg-zinc-300 dark:bg-zinc-800")}
                onClick={() => choose(option.id)}
              >
                {icpOptionLabel(option.brandName, option.websiteUrl)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
