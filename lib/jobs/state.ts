export type JobStatusName =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED"
  | "CANCELLED";

export function progressPercent(processed: number, total: number) {
  if (total <= 0) return processed > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

export function backoffMs(attempt: number, baseMs = 2000) {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(baseMs * 2 ** safeAttempt, 60_000);
}

export function resolveCompletionStatus(input: {
  cancelRequested: boolean;
  success: number;
  failed: number;
}): JobStatusName {
  if (input.cancelRequested) return "CANCELLED";
  if (input.failed > 0 && input.success > 0) return "PARTIALLY_COMPLETED";
  if (input.failed > 0 && input.success === 0) return "FAILED";
  return "COMPLETED";
}

export function canRetryJob(status: JobStatusName) {
  return status === "FAILED" || status === "PARTIALLY_COMPLETED";
}

export function canCancelJob(status: JobStatusName) {
  return status === "QUEUED" || status === "RUNNING";
}

export function shouldRetryAttempt(attempt: number, maxAttempts: number, retryable: boolean) {
  return retryable && attempt < maxAttempts;
}
