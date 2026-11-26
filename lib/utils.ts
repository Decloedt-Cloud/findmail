import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const regionNames = new Intl.DisplayNames("en", { type: "region" });
const languageNames = new Intl.DisplayNames("en", { type: "language" });

export function countryName(code: string | null | undefined) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return code;
  try {
    const name = regionNames.of(normalized);
    if (!name || name.toUpperCase() === normalized) return normalized;
    return name;
  } catch {
    return normalized;
  }
}

/** Stored spoken codes (`fr,en`) as English names. Null when nothing is stored. */
export function spokenLanguageLabel(value: string | null | undefined) {
  const codes = [...new Set(
    (value ?? "")
      .split(",")
      .map((code) => code.trim().toLowerCase().slice(0, 2))
      .filter((code) => /^[a-z]{2}$/.test(code)),
  )];
  if (codes.length === 0) return null;
  return codes.map((code) => {
    try {
      const name = languageNames.of(code);
      return name && name.toLowerCase() !== code ? name : code;
    } catch {
      return code;
    }
  }).join(", ");
}

/** Countries read from the channel texts. Empty string means the read found none. */
export function statedCountryLabel(value: string | null | undefined) {
  if (value == null) return null;
  const names = value.split(",").map((code) => countryName(code)).filter((name): name is string => Boolean(name));
  return names.join(", ");
}

/** Long videos and Shorts. Null when the durations have not been read. */
export function formatLabel(longForm: boolean | null | undefined, shorts: boolean | null | undefined) {
  if (longForm == null && shorts == null) return null;
  const parts = [
    longForm ? "Long videos" : null,
    shorts ? "Shorts" : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(", ") || "None";
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompact(value: number | null | undefined) {
  if (value == null) return null;
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10}M`.replace(".0M", "M");
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10}K`.replace(".0K", "K");
  }
  return String(value);
}

export function formatAgo(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
