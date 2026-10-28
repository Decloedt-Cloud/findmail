import type { SubscriberVisibility } from "@/lib/youtube/client";

/** Latest public upload must fall inside this window. */
export const ACTIVE_WINDOW_MONTHS = 2;

/** Recheck a stored channel once its last video is this close to the activity window. */
export const RECHECK_MARGIN_DAYS = 14;

/**
 * Recent average views must reach this share of the public subscriber count.
 * A channel with 100,000 subscribers and 300 views on a typical video is left out.
 */
export const MIN_VIEWS_PER_SUBSCRIBER = 0.02;

export function activeSince(now = new Date()) {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - ACTIVE_WINDOW_MONTHS);
  return cutoff;
}

export function activityRecheckBefore(now = new Date()) {
  const cutoff = activeSince(now);
  cutoff.setDate(cutoff.getDate() + RECHECK_MARGIN_DAYS);
  return cutoff;
}

/** A recent video can wait. A missing date, or one near the two-month line, is read again. */
export function needsActivityRecheck(lastActiveAt: Date | null | undefined, now = new Date()) {
  if (!lastActiveAt || Number.isNaN(lastActiveAt.getTime())) return true;
  return lastActiveAt.getTime() < activityRecheckBefore(now).getTime();
}

export function isRecentlyActive(lastActiveAt: string | Date | null | undefined, now = new Date()) {
  if (!lastActiveAt) return false;
  const date = lastActiveAt instanceof Date ? lastActiveAt : new Date(lastActiveAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= activeSince(now).getTime();
}

export function hasEnoughViews(input: {
  subscriberCount: number | null;
  subscriberVisibility?: SubscriberVisibility | null;
  averageViews: number | null;
}) {
  if (input.subscriberVisibility && input.subscriberVisibility !== "PUBLIC") return true;
  if (input.subscriberCount == null || input.subscriberCount <= 0) return true;
  if (input.averageViews == null || input.averageViews < 0) return false;
  return input.averageViews >= input.subscriberCount * MIN_VIEWS_PER_SUBSCRIBER;
}

export function qualifiesForStorage(input: {
  lastActiveAt: string | Date | null | undefined;
  subscriberCount: number | null;
  subscriberVisibility?: SubscriberVisibility | null;
  averageViews: number | null;
  now?: Date;
}) {
  return isRecentlyActive(input.lastActiveAt, input.now) && hasEnoughViews(input);
}
