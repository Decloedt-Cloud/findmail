import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground",
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  blue: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  amber: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  muted: "bg-muted text-muted-foreground",
};

export function Badge({ className, tone = "default", ...props }: React.ComponentProps<"span"> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}

export function statusTone(status?: string | null) {
  if (status === "VERIFIED" || status === "COMPLETED") return "green" as const;
  if (status === "SYNTAX_VALID" || status === "RUNNING") return "blue" as const;
  if (status === "NEEDS_REVIEW" || status === "UNKNOWN" || status === "PARTIALLY_COMPLETED" || status === "QUEUED") return "amber" as const;
  if (status === "INVALID" || status === "FAILED") return "red" as const;
  return "muted" as const;
}
