"use client";

import { useState } from "react";

const MIN_BOUND = 1_000;
const MAX_BOUND = 5_000_000;
const TICKS = [
  { label: "1K", value: 1_000 },
  { label: "10K", value: 10_000 },
  { label: "100K", value: 100_000 },
  { label: "1M", value: 1_000_000 },
  { label: "5M", value: 5_000_000 },
];

function expValue(pct: number) {
  const t = pct / 100;
  return Math.round(MIN_BOUND * Math.exp(Math.log(MAX_BOUND / MIN_BOUND) * t));
}

function invExp(value: number) {
  const clamped = Math.min(MAX_BOUND, Math.max(MIN_BOUND, value));
  return (Math.log(clamped / MIN_BOUND) / Math.log(MAX_BOUND / MIN_BOUND)) * 100;
}

function toPct(value: string, end: "min" | "max") {
  if (!value.trim()) return end === "min" ? 0 : 100;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return end === "min" ? 0 : 100;
  return invExp(numeric);
}

function fromPct(pct: number, end: "min" | "max") {
  if (end === "min" && pct <= 0.4) return "";
  if (end === "max" && pct >= 99.6) return "";
  return String(expValue(pct));
}

function digits(raw: string) {
  return raw.replace(/[^\d]/g, "");
}

function BoundSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const end = label === "Min" ? "min" : "max";
  const pct = toPct(value, end);
  const fill = end === "max" && !value ? 0 : pct;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value ? Number(value).toLocaleString("en-US") : "");

  function commit(raw: string) {
    const next = digits(raw);
    onChange(next && Number(next) > 0 ? next : "");
    setDraft(null);
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`subs-${end}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
        <input
          id={`subs-${end}`}
          value={shown}
          inputMode="numeric"
          placeholder="Any"
          aria-label={`${label} subscribers`}
          onFocus={() => setDraft(value)}
          onChange={(event) => setDraft(digits(event.target.value))}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit(event.currentTarget.value);
          }}
          className="h-9 w-32 rounded-lg border border-transparent bg-transparent px-2 text-right text-lg font-black tabular-nums text-foreground outline-none placeholder:text-base placeholder:font-semibold placeholder:text-muted-foreground focus:border-input focus:bg-background"
        />
      </div>
      <div className="py-2.5">
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={pct}
        aria-label={`${label} subscribers`}
        onChange={(event) => onChange(fromPct(Number(event.target.value), end))}
        className="subscriber-range w-full cursor-pointer"
        style={{ ["--range-progress" as string]: `${fill}%` }}
      />
      </div>
      <div className="relative h-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {TICKS.map((tick, index) => {
          const openEnd = (end === "min" && index === 0) || (end === "max" && index === TICKS.length - 1);
          return (
            <span
              key={tick.label}
              className="absolute -translate-x-1/2"
              style={{ left: `calc(14px + (100% - 28px) * ${invExp(tick.value) / 100})` }}
            >
              {openEnd ? "Any" : tick.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function SubscriberRangeField({
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  function changeMin(next: string) {
    onMinChange(next);
    if (next && max && Number(next) > Number(max)) onMaxChange(next);
  }

  function changeMax(next: string) {
    onMaxChange(next);
    if (next && min && Number(next) < Number(min)) onMinChange(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-input bg-card px-4 py-3 md:col-span-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subscribers</p>
      <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
        <BoundSlider label="Min" value={min} onChange={changeMin} />
        <BoundSlider label="Max" value={max} onChange={changeMax} />
      </div>
    </div>
  );
}
