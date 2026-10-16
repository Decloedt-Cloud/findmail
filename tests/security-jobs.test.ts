import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isBlockedIp } from "@/lib/ssrf";
import { parseRobots, pathAllowedByRobots } from "@/lib/robots";
import { resetMemoryRateLimits, takeMemoryToken } from "@/lib/rate-limit";
import { ApiError, assertCanAccess } from "@/lib/authz";
import { backoffMs, canCancelJob, canRetryJob, resolveCompletionStatus, shouldRetryAttempt } from "@/lib/jobs/state";
import { isUniqueViolation } from "@/lib/db";

describe("ssrf protection", () => {
  it("blocks localhost, private ranges, metadata, and non-public URLs", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.1.2.3")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(() => assertPublicHttpUrl("http://127.0.0.1/contact")).toThrow(/blocked/i);
    expect(() => assertPublicHttpUrl("http://user:pass@example.com")).toThrow(/credential/i);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/HTTP/i);
    expect(() => assertPublicHttpUrl("http://example.com:8080")).toThrow(/port/i);
    expect(assertPublicHttpUrl("https://brand.example/contact").hostname).toBe("brand.example");
  });
});

describe("robots.txt", () => {
  it("honors the longest matching rule", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/press\n", "WayoAdsCreatorEmailFinder");
    expect(pathAllowedByRobots("/about", rules)).toBe(true);
    expect(pathAllowedByRobots("/private", rules)).toBe(false);
    expect(pathAllowedByRobots("/private/press", rules)).toBe(true);
  });
});

describe("rate limiting", () => {
  it("blocks the request after the window limit", () => {
    resetMemoryRateLimits();
    expect(takeMemoryToken("login:test", 2, 1000, 1_000).ok).toBe(true);
    expect(takeMemoryToken("login:test", 2, 1000, 1_100).ok).toBe(true);
    const blocked = takeMemoryToken("login:test", 2, 1000, 1_200);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("authorization", () => {
  it("allows the owner or an administrator and rejects everyone else", () => {
    expect(() => assertCanAccess({ id: "u1", role: "MEMBER" }, "u1")).not.toThrow();
    expect(() => assertCanAccess({ id: "admin", role: "ADMIN" }, "u1")).not.toThrow();
    expect(() => assertCanAccess({ id: "u2", role: "MEMBER" }, "u1")).toThrow(ApiError);
  });
});

describe("jobs", () => {
  it("resolves completion, cancellation, and retry eligibility", () => {
    expect(resolveCompletionStatus({ cancelRequested: true, success: 2, failed: 1 })).toBe("CANCELLED");
    expect(resolveCompletionStatus({ cancelRequested: false, success: 2, failed: 1 })).toBe("PARTIALLY_COMPLETED");
    expect(resolveCompletionStatus({ cancelRequested: false, success: 0, failed: 2 })).toBe("FAILED");
    expect(canCancelJob("RUNNING")).toBe(true);
    expect(canCancelJob("COMPLETED")).toBe(false);
    expect(canRetryJob("FAILED")).toBe(true);
    expect(canRetryJob("COMPLETED")).toBe(false);
    expect(shouldRetryAttempt(1, 3, true)).toBe(true);
    expect(shouldRetryAttempt(3, 3, true)).toBe(false);
    expect(backoffMs(0)).toBe(2000);
    expect(backoffMs(3)).toBe(16000);
  });
});

describe("database uniqueness", () => {
  it("recognizes a Prisma unique constraint failure", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation(new Error("duplicate"))).toBe(false);
  });
});
