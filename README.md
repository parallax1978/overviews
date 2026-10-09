# Legiit Overviews

Track one Google AI Overview for 7 days, see what Google keeps citing, and get a page written to
beat it. Built on Next.js, Supabase, DataForSEO, Claude, and Vercel.

The product plan is in [`PLAN.md`](./PLAN.md). Conventions for contributors (and Claude Code) are
in [`CLAUDE.md`](./CLAUDE.md).

## How it works

1. **Add a keyword.** We capture today's AI Overview immediately with DataForSEO: three samples,
   because Google generates a different answer for every request (three identical back-to-back
   requests for one keyword shared no cited source).
2. **We watch it for 7 days.** A daily cron takes three more samples each day and stores the full
   answer and every citation of each one.
3. **You get the report and the page.** Claude counts what survives across all samples, reads the
   most-cited pages, and plans a page that beats them: a winning angle, the gaps no page fills,
   the contradictions between sources, and three things nobody has. Then it writes that page, with
   placeholders for your own data. The report is available from day one and refreshed on day 7.
4. **Keep tracking.** After you publish, we keep checking and tell you when your site gets cited.

Each keyword chooses whether the page may name other brands. The default is no: the page positions
your own site or product as the answer and never recommends a competitor.

## Setup (about 20 minutes)

### 1. Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open the SQL editor and run every file in `supabase/migrations/` in order
   (or `supabase link` + `supabase db push` with the CLI).
3. Authentication: follow [`docs/auth-setup.md`](./docs/auth-setup.md). The app uses email codes
   and magic links, no passwords.
4. Project Settings -> API: copy the project URL, the publishable (anon) key, and the service
   role key.

### 2. DataForSEO

1. Create an account at https://app.dataforseo.com and add the minimum $50 balance.
2. API Access: copy the API login and password.

Each request costs about $0.004 (Live SERP $0.002 plus the async AI Overview surcharge, refunded
when the overview is cached or absent). With three samples a day that is about $0.012 per keyword
per day, under $0.09 per keyword week.

### 3. Anthropic

Create an API key at https://console.anthropic.com. Analysis and writing use `claude-opus-5-5`.
Measured on a real keyword: the analysis takes about 3 minutes (10 page fetches) and the draft
about 2 minutes, roughly $0.90 together at list prices.

Use a workspace key (`sk-ant-api03-...`). A personal key (`sk-ant-usr-...`) also works, but then
set `ANTHROPIC_WORKSPACE_ID` to the workspace to bill (Console -> Settings -> Workspaces).
The analysis reads cited pages with Anthropic's web fetch tool; make sure it is enabled for the
organization in the Console.

To test the Claude integration without the app, run one real analysis on the saved
DataForSEO response:

```
npx tsx scripts/analyze-fixture.ts
```

To rebuild the report and draft for a real keyword exactly as the app does (for example after a
prompt change):

```
npx tsx --conditions=react-server scripts/run-analysis.ts <tracker-id>
```

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
ANTHROPIC_API_KEY=
CRON_SECRET=            # any random string, 32+ characters
NEXT_PUBLIC_APP_URL=    # http://localhost:3000 locally, your Vercel URL in production
```

### 5. Run locally

```
npm install
npm run dev
```

Open http://localhost:3000, sign in with your email, add a keyword. Day 1 is captured while you
wait. To simulate the next day's capture locally:

```
node scripts/capture-now.mjs
```

### 6. Deploy to Vercel

1. Import the repo at https://vercel.com/new. The Pro plan is recommended (commercial use, and
   precise cron timing). Hobby works for testing: its daily cron runs within an hour of 06:00 UTC.
2. Add every variable from step 4 in Project Settings -> Environment Variables. If you connect
   the Supabase integration from the Vercel marketplace it sets the three Supabase variables for
   you; add the rest by hand.
3. Deploy. `vercel.json` registers the daily cron at `/api/cron/capture`; Vercel sends
   `Authorization: Bearer <CRON_SECRET>` automatically. Both long routes declare
   `maxDuration = 300`, which every current Vercel plan allows.
4. In Supabase, set the Site URL to your Vercel domain and add
   `https://<your-domain>/auth/confirm` to the auth Redirect URLs.

## Commands

```
npm run dev          # local dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest unit tests
npm run build        # production build
node scripts/capture-now.mjs            # trigger the daily capture against APP_URL
node scripts/dataforseo-probe.mjs "best form builder" --save   # one real DataForSEO call, saves the response
```

## Project layout

```
app/                 routes: landing, login, auth callbacks, /app dashboard, /api
components/          ui primitives, brand, site chrome, app widgets
lib/                 env, types, utils, auth, supabase clients, dataforseo, claude, capture, analyze
supabase/migrations  SQL schema (RLS enabled)
scripts/             plain Node scripts for operators
tests/               vitest tests and response fixtures
```
