# Creator Email Finder

Creator Email Finder is a Wayo Ads workspace for discovering YouTube creators, storing channel metadata from the official YouTube Data API, and collecting professional email addresses that are already published on permitted public pages. It does not guess emails, invent creator records, or mark an address verified unless a configured provider says so.

## What it does

- Search YouTube by keyword, niche, country, subscriber range, language, and recent activity.
- Store channel IDs, titles, descriptions, thumbnails, public statistics, and the country only when YouTube provides it.
- Find an official website from links the creator published. Social profiles and link hubs are not treated as that website.
- Read `robots.txt`, then fetch a limited number of public contact pages.
- Extract published addresses and mailto links, drop placeholders, and keep the source URL.
- Import and export CSV, with formula-injection protection on export.
- Run discovery, import, email finding, verification, and export as BullMQ jobs.
- Show dashboard numbers from PostgreSQL. An empty database shows zeros.

The YouTube Data API does not expose the business email behind YouTube's contact button. An address found in the public channel description is labeled as description text, not as a YouTube contact-email result.

## Requirements

- Node.js 22 or newer
- PostgreSQL 16+ and Redis 7+, or Docker Compose. BullMQ rejects Redis 3.x, including the old Windows port that listens on 6379.
- A YouTube Data API v3 key for discovery
- Optional ZeroBounce, NeverBounce, or Hunter keys

On a machine without Docker, this repository can start a local PostgreSQL with `npm run db:start`. Redis must already be running.

## Setup

```bash
cp .env.example .env
```

Fill in `AUTH_SECRET`, `DATABASE_URL`, `REDIS_URL`, and `SEED_ADMIN_PASSWORD`. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start PostgreSQL and Redis, then change `DATABASE_URL` to port `5433` when you use `npm run db:start` instead of Docker:

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
npm run worker
```

Open `http://localhost:3000` and sign in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

Docker Compose starts Postgres, Redis, the web process, and the worker:

```bash
docker compose up --build
```

Apply migrations inside the web container before the first sign-in:

```bash
docker compose exec web npx prisma migrate deploy
docker compose exec web npm run db:seed
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `AUTH_SECRET` | Yes | Auth.js session signing, at least 16 characters |
| `APP_BASE_URL` | Yes | Public URL, also used in the crawler user agent |
| `REDIS_URL` | For jobs | BullMQ queue. Without it, job routes return a configuration error |
| `YOUTUBE_API_KEY` | For discovery | Official YouTube Data API v3 key |
| `EMAIL_VERIFICATION_PROVIDER` | No | `none`, `zerobounce`, or `neverbounce` |
| `EMAIL_VERIFICATION_API_KEY` | With a provider | Provider credential. The app never sends a test email |
| `CONTACT_PROVIDER` | No | `none` or `hunter` |
| `CONTACT_SEARCH_API_KEY` | With Hunter | Hunter domain-search key. Name-based guessing is not used |
| `MAX_PAGES_PER_DOMAIN` | No | Default 10 |
| `REQUEST_TIMEOUT_MS` | No | Default 10000 |
| `MAX_CONCURRENT_JOBS` | No | Worker concurrency, default 5 |
| `YOUTUBE_DAILY_QUOTA` | No | Local budget check, default 10000 units |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | For seed | Initial administrator |

Settings shows whether each integration is configured. It never displays secret values.

## Processes

- `npm run dev` — Next.js app
- `npm run worker` — BullMQ worker. Keep this running or jobs stay queued
- `npm run db:start` — user-space PostgreSQL on `LOCAL_POSTGRES_PORT` (default 5433) when Docker is not available. The cluster is created with UTF-8 so channel titles and descriptions can be stored. Point `DATABASE_URL` at that same port. If the port is already taken, pick another one in both places.
- `npm run test` — unit tests with mocked external services
- `npm run lint` — ESLint
- `npm run build` — production build

Health check: `GET /api/health`. Database failure returns 503. Redis failure returns 200 with `"status": "degraded"` so the site can still explain that jobs are unavailable.

## YouTube quota

`search.list` costs 100 units. `channels.list` and `videos.list` cost 1 unit per request. The discover form estimates the cost and refuses a search that would pass `YOUTUBE_DAILY_QUOTA` based on usage this app has recorded. Quota exhaustion stops the job and leaves a partial result instead of retrying immediately. A default Google project quota is 10,000 units per day.

Search `regionCode` only biases results. A channel's country stays empty when YouTube does not send `snippet.country`. Hidden subscriber counts stay null.

## Email discovery limits

Outbound fetches allow public HTTP and HTTPS on ports 80 and 443. Localhost, private networks, link-local addresses, and cloud metadata addresses are refused, including after redirects. Responses over 1 MB and unsupported content types are dropped. Each domain is requested one at a time, with a gap of `DOMAIN_REQUEST_INTERVAL_MS`. `robots.txt` disallow rules are followed. If `robots.txt` cannot be read, that site is skipped. The crawler does not log in, solve CAPTCHAs, or bypass paywalls.

Syntax validation only checks the shape of an address. Verification status changes only through the allowed status transitions and a configured provider response.

## CSV

Imports accept `channel_id`, `channel_name`, `channel_url`, `video_url`, `country`, `subscriber_count`, `website_url`, and `email`. Headers can be mapped before the job starts. Duplicate channels can be skipped, updated, or merged. A downloadable error report is saved for failed rows.

Exports use the columns `channel_name`, `channel_id`, `channel_url`, `country`, `niche`, `subscriber_count`, `official_website`, `business_email`, `email_status`, `email_source_url`, and `email_discovered_at`. Values that start with `=`, `+`, `-`, `@`, or a tab are prefixed so spreadsheet apps do not treat them as formulas.

## Data retention and backups

Administrators set export and creator retention under Settings. Creator retention of 0 keeps records until a person deletes them. The worker removes expired export files.

Back up PostgreSQL with `pg_dump` on a schedule and keep the dump off the app server. Redis only holds the job queue and can be recreated; the durable job state is in PostgreSQL. The `data/exports` and `data/uploads` directories contain files and should be included in the server backup if those files must be retained.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=findmail.dump
```

Deleting a creator removes the stored channel and its email rows. Audit events record sign-in, discovery, import, export, deletion, and settings changes without copying message contents.

## Tests

Automated tests mock YouTube, verification providers, and page fetches. Production clients live in `lib/youtube/client.ts` and `lib/email/providers.ts` and are not replaced by those mocks at runtime.

```bash
npm test
```

## Troubleshooting

- **Jobs stay queued.** Redis is running, but `npm run worker` is not. The job page says so.
- **Discovery says the YouTube key is missing.** Set `YOUTUBE_API_KEY` and restart both the web app and the worker.
- **Verification returns 503.** Choose `zerobounce` or `neverbounce` and set the API key. Addresses are left unchanged.
- **A website was skipped.** The host blocked the request, `robots.txt` disallows the path, or the URL is not public HTTP(S).
- **Sign-in fails after seed.** Confirm `DATABASE_URL` points at the database you migrated, then run `npm run db:seed` again.
- **Prisma client errors after a schema change.** Run `npx prisma generate` and restart the worker.

## Project layout

- `app/` — App Router pages and route handlers
- `components/` — dashboard shell and table
- `lib/` — YouTube, email discovery, CSV, jobs, and auth
- `worker/` — separate BullMQ process
- `prisma/` — schema, migrations, and seed
- `tests/` — unit tests
