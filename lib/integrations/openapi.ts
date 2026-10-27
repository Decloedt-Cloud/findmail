export const wayoAdsOpenApi = {
  openapi: "3.0.3",
  info: {
    title: "Wayo Ads creator API",
    version: "1.0.0",
    description: "Read creators that already have a published email address. This API does not search YouTube and does not guess addresses.",
  },
  servers: [{ url: "https://wayoadsoutreach.wayo.agency" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Email: {
        type: "object",
        required: ["address", "sourceType", "sourceUrl", "verificationStatus", "isGenericInbox"],
        properties: {
          address: { type: "string", format: "email" },
          sourceType: { type: "string", enum: ["PUBLIC_PAGE", "MAILTO", "CHANNEL_DESCRIPTION", "CSV_IMPORT", "LICENSED_PROVIDER", "MANUAL"] },
          sourceUrl: { type: "string", nullable: true },
          verificationStatus: { type: "string", enum: ["DISCOVERED", "SYNTAX_VALID", "VERIFIED", "INVALID", "UNKNOWN", "NOT_FOUND", "NEEDS_REVIEW"] },
          isGenericInbox: { type: "boolean" },
        },
      },
      Creator: {
        type: "object",
        properties: {
          id: { type: "string" },
          youtubeChannelId: { type: "string" },
          channelName: { type: "string" },
          channelHandle: { type: "string", nullable: true },
          channelUrl: { type: "string" },
          description: { type: "string", nullable: true },
          country: { type: "string", nullable: true, description: "ISO 3166-1 alpha-2, only when YouTube provided it." },
          keywords: { type: "array", items: { type: "string" } },
          subscriberCount: { type: "integer", nullable: true },
          subscriberVisibility: { type: "string", enum: ["PUBLIC", "HIDDEN", "UNAVAILABLE"] },
          videoCount: { type: "integer", nullable: true },
          viewCount: { type: "string", nullable: true, description: "Decimal string, because the count can exceed a JavaScript number." },
          thumbnailUrl: { type: "string", nullable: true },
          averageViews: { type: "integer", nullable: true },
          lastActiveAt: { type: "string", format: "date-time", nullable: true },
          officialWebsiteUrl: { type: "string", nullable: true },
          instagramUrl: { type: "string", nullable: true },
          twitterUrl: { type: "string", nullable: true },
          tiktokUrl: { type: "string", nullable: true },
          matchedVideoTitle: { type: "string", nullable: true },
          matchedVideoUrl: { type: "string", nullable: true },
          matchedVideoViews: { type: "integer", nullable: true },
          matchedVideoPublishedAt: { type: "string", format: "date-time", nullable: true },
          email: { $ref: "#/components/schemas/Email" },
          emails: { type: "array", items: { $ref: "#/components/schemas/Email" } },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          details: {},
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/integrations/wayo-ads/creators": {
      get: {
        operationId: "listCreators",
        summary: "List creators that have at least one published email",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "country", in: "query", schema: { type: "string", pattern: "^[A-Za-z]{2}$" }, description: "ISO country code, for example FR." },
          { name: "q", in: "query", schema: { type: "string" }, description: "Matches channel name or handle." },
        ],
        responses: {
          "200": {
            description: "One page of creators. Total size is in X-Total-Count.",
            headers: {
              "X-Total-Count": { schema: { type: "integer" } },
              "X-Page": { schema: { type: "integer" } },
              "X-Page-Size": { schema: { type: "integer" } },
            },
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Creator" } } } },
          },
          "400": { description: "Invalid query", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or wrong API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "More than 60 requests in 60 seconds", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "503": { description: "API key is not configured on the server", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/integrations/wayo-ads/icps": {
      post: {
        operationId: "matchIcp",
        summary: "Store a simplified ICP and queue a search for YouTube channels that published a matching video in the last 6 months",
        responses: {
          "202": { description: "Matching was queued" },
          "200": { description: "This onboarding ICP is already queued or finished" },
          "400": { description: "Invalid body", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or wrong API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
  },
} as const;
