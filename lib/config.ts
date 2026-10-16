export function integrationStatus() {
  const verificationProvider = (process.env.EMAIL_VERIFICATION_PROVIDER || "none").toLowerCase();
  const contactProvider = (process.env.CONTACT_PROVIDER || "none").toLowerCase();
  const verificationKey = Boolean(process.env.EMAIL_VERIFICATION_API_KEY?.trim());
  const contactKey = Boolean(process.env.CONTACT_SEARCH_API_KEY?.trim());
  return {
    youtube: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    redis: Boolean(process.env.REDIS_URL?.trim()),
    database: Boolean(process.env.DATABASE_URL?.trim()),
    auth: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16),
    verification: {
      provider: verificationProvider,
      configured: (verificationProvider === "zerobounce" || verificationProvider === "neverbounce") && verificationKey,
    },
    contactSearch: {
      provider: contactProvider,
      configured: contactProvider === "hunter" && contactKey,
    },
    limits: {
      maxPagesPerDomain: Number(process.env.MAX_PAGES_PER_DOMAIN || 10),
      requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
      maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 5),
      youtubeDailyQuota: Number(process.env.YOUTUBE_DAILY_QUOTA || 10000),
    },
  };
}
