"use client";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string }) : {};
  if (response.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth")) {
    window.location.replace("/login");
  }
  if (!response.ok) throw new ApiClientError(body.error || "Request failed", response.status);
  return body as T;
}
