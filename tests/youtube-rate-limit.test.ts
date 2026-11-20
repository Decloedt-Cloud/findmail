import { describe, expect, it, vi } from "vitest";
import { YouTubeClient } from "@/lib/youtube/client";

const rateLimited = () =>
  new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

const ok = () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });

describe("YouTube rate limit handling", () => {
  it("waits and retries a rateLimitExceeded response instead of failing", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(ok());
    const onQuota = vi.fn();
    const client = new YouTubeClient("test-key", fetchImpl, onQuota, undefined, [0]);

    await expect(client.search({ query: "ai", type: "channel", maxResults: 5 })).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The rejected call is logged with 0 units; only the successful call is charged.
    expect(onQuota).toHaveBeenNthCalledWith(1, 0, "search", false, "rateLimitExceeded (retry 1)");
    expect(onQuota).toHaveBeenNthCalledWith(2, 100, "search", true);
  });

  it("gives up as retryable once every wait is used", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => rateLimited());
    const client = new YouTubeClient("test-key", fetchImpl, undefined, undefined, [0, 0]);

    await expect(client.search({ query: "ai", type: "channel", maxResults: 5 })).rejects.toMatchObject({
      code: "RETRYABLE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a daily quota error", async () => {
    const quota = new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    const fetchImpl = vi.fn().mockResolvedValue(quota);
    const client = new YouTubeClient("test-key", fetchImpl, undefined, undefined, [0, 0]);

    await expect(client.search({ query: "ai", type: "channel", maxResults: 5 })).rejects.toMatchObject({ code: "QUOTA" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
