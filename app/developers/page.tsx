import type { Metadata } from "next";
import { COMPANY_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "API",
  description: "Read creators and their published email addresses.",
};

export default function DevelopersPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{COMPANY_NAME}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Creator API</h1>
        <p className="text-muted-foreground">Read creators that already have a published email. The API does not search YouTube and does not invent addresses.</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Base URL</h2>
        <pre className="overflow-x-auto rounded-lg bg-card p-4 text-sm">https://wayoadsoutreach.wayo.agency</pre>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Authentication</h2>
        <p>Send the API key on every request. Ask Wayo Ads for the key. It is not included in this page.</p>
        <pre className="overflow-x-auto rounded-lg bg-card p-4 text-sm">Authorization: Bearer YOUR_API_KEY</pre>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">List creators</h2>
        <p><code>GET /api/integrations/wayo-ads/creators</code></p>
        <p>Hidden creators and creators without an email are omitted. Results are ordered by subscriber count, highest first.</p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-3">Parameter</th>
              <th className="py-2 pr-3">Default</th>
              <th className="py-2">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border"><td className="py-2 pr-3">page</td><td className="py-2 pr-3">1</td><td className="py-2">Page number, starting at 1</td></tr>
            <tr className="border-b border-border"><td className="py-2 pr-3">pageSize</td><td className="py-2 pr-3">50</td><td className="py-2">1 to 100 creators</td></tr>
            <tr className="border-b border-border"><td className="py-2 pr-3">country</td><td className="py-2 pr-3"></td><td className="py-2">Two-letter code, for example FR</td></tr>
            <tr className="border-b border-border"><td className="py-2 pr-3">niche</td><td className="py-2 pr-3"></td><td className="py-2">Exact niche name, case-insensitive</td></tr>
            <tr><td className="py-2 pr-3">q</td><td className="py-2 pr-3"></td><td className="py-2">Channel name, handle, or niche</td></tr>
          </tbody>
        </table>
        <pre className="overflow-x-auto rounded-lg bg-card p-4 text-sm">{`curl "https://wayoadsoutreach.wayo.agency/api/integrations/wayo-ads/creators?country=FR&pageSize=50" \\
  -H "Authorization: Bearer YOUR_API_KEY"`}</pre>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Response</h2>
        <p>The body is a JSON array. The total number of matching creators is the <code>X-Total-Count</code> header. <code>X-Page</code> and <code>X-Page-Size</code> repeat the page you requested.</p>
        <pre className="overflow-x-auto rounded-lg bg-card p-4 text-sm">{`[
  {
    "id": "c1",
    "youtubeChannelId": "UC1",
    "channelName": "Ada",
    "channelHandle": "@ada",
    "channelUrl": "https://www.youtube.com/channel/UC1",
    "country": "FR",
    "niche": "Business",
    "subscriberCount": 1200,
    "viewCount": "3400",
    "officialWebsiteUrl": "https://ada.test",
    "email": {
      "address": "ada@ada.test",
      "sourceType": "CHANNEL_DESCRIPTION",
      "sourceUrl": "https://www.youtube.com/channel/UC1",
      "verificationStatus": "SYNTAX_VALID",
      "isGenericInbox": false
    },
    "emails": []
  }
]`}</pre>
        <p><code>email</code> is the preferred address: a named inbox is chosen before a generic one such as info@. <code>emails</code> contains every stored address. <code>viewCount</code> is a string. <code>verificationStatus</code> is <code>VERIFIED</code> only after a configured verification provider says so.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Errors and limit</h2>
        <p>At most 60 requests per minute for this endpoint.</p>
        <ul className="list-disc pl-5 text-sm">
          <li><code>400</code> — a query parameter is invalid</li>
          <li><code>401</code> — the API key is missing or wrong</li>
          <li><code>429</code> — the rate limit was reached. <code>details.retryAfterMs</code> says how long to wait</li>
          <li><code>503</code> — the server has no API key configured</li>
        </ul>
        <p>Machine-readable description: <a className="underline" href="/api/integrations/wayo-ads/openapi">OpenAPI JSON</a>.</p>
      </section>
    </main>
  );
}
