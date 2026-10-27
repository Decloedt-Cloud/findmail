import { z } from "zod";
import { MIN_CREATOR_SUBSCRIBERS } from "@/lib/constants";

const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const discoverySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    countries: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/)).min(1).max(8),
    language: z.string().trim().min(2).max(12).optional(),
    minSubscribers: z.number().int().min(MIN_CREATOR_SUBSCRIBERS).max(500_000_000).default(MIN_CREATOR_SUBSCRIBERS),
    maxSubscribers: z.number().int().nonnegative().max(500_000_000).optional(),
    maxResults: z.number().int().min(1).max(200),
    requirePublicEmail: z.boolean().optional().default(false),
    recencyDays: z.number().int().min(1).max(3650).optional(),
  })
  .refine((value) => value.minSubscribers == null || value.maxSubscribers == null || value.minSubscribers <= value.maxSubscribers, {
    message: "Minimum subscribers cannot exceed maximum subscribers",
    path: ["minSubscribers"],
  });

const icpText = z.string().trim().max(500);

export const wayoAdsIcpSchema = z.object({
  onboardingId: z.string().trim().min(4).max(80),
  websiteUrl: z.string().trim().url().max(300),
  brandName: z.string().trim().min(1).max(120),
  icp: z.object({
    icps: z
      .array(
        z.object({
          icpRef: z.string().trim().min(1).max(80),
          name: icpText.min(1),
          description: icpText,
          interests: z.array(icpText).max(12),
          problems: z.array(icpText).max(12),
          goals: z.array(icpText).max(12),
          useCases: z.array(icpText).max(12),
          productCategories: z.array(icpText).max(12),
        }),
      )
      .min(1)
      .max(5),
    offers: z
      .array(
        z.object({
          offerRef: z.string().trim().min(1).max(80),
          name: icpText.min(1),
          description: icpText,
          valueProposition: icpText.nullable(),
        }),
      )
      .max(8)
      .optional()
      .default([]),
  }),
});

export const wayoAdsCreatorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const creatorQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  country: z.string().trim().max(8).optional(),
  brandIcpId: z.string().trim().min(1).max(80).optional(),
  emailStatus: z
    .enum(["DISCOVERED", "SYNTAX_VALID", "VERIFIED", "INVALID", "UNKNOWN", "NOT_FOUND", "NEEDS_REVIEW"])
    .optional(),
  minSubscribers: z.coerce.number().int().nonnegative().optional(),
  maxSubscribers: z.coerce.number().int().nonnegative().optional(),
  hasEmail: z.enum(["true", "false"]).optional(),
  sort: z.enum(["relevance", "subscribers", "discoveredAt", "channelName", "averageViews", "lastActiveAt"]).default("relevance"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  listId: z.string().optional(),
  ids: z.string().optional(),
  jobId: z.string().optional(),
});

export const bulkDiscoverSchema = z.object({
  creatorIds: z.array(z.string().min(1)).min(1).max(500),
});

export const verifySchema = z.object({
  emailIds: z.array(z.string().min(1)).min(1).max(200),
});

export const exportSchema = z.object({
  scope: z.enum(["FILTERED", "SELECTED", "WITH_EMAIL", "VERIFIED_ONLY", "WITHOUT_EMAIL", "JOB", "CONTACT_LIST"]),
  creatorIds: z.array(z.string()).max(5000).optional(),
  listId: z.string().optional(),
  jobId: z.string().optional(),
  filters: z
    .object({
      q: z.string().optional(),
      country: z.string().optional(),
      emailStatus: z.string().optional(),
      minSubscribers: z.number().optional(),
      maxSubscribers: z.number().optional(),
    })
    .optional(),
});

export const contactListSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
});

export const listMembersSchema = z.object({
  creatorIds: z.array(z.string().min(1)).min(1).max(1000),
  action: z.enum(["add", "remove"]).default("add"),
});

export const mergeListsSchema = z.object({
  sourceListId: z.string().min(1),
  excludeDuplicateEmails: z.boolean().default(true),
});

export const retentionSchema = z.object({
  exportRetentionDays: z.number().int().min(1).max(3650),
  creatorRetentionDays: z.number().int().min(0).max(3650),
});

export const importConfirmSchema = z.object({
  token: z.string().min(8),
  mapping: z.record(z.string(), z.enum(["channel_id", "channel_name", "channel_url", "video_url", "country", "subscriber_count", "website_url", "email", "ignore"])),
  duplicateStrategy: z.enum(["SKIP", "UPDATE", "MERGE"]),
});

export const bulkCreatorSchema = z.object({
  action: z.enum(["hide", "delete", "restore"]),
  creatorIds: z.array(z.string().min(1)).min(1).max(500),
});

export const userSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export function optionalEnvString(value: unknown) {
  return empty(value);
}
