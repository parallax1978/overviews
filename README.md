# Legiit Overviews

Track one Google AI Overview for 7 days, see what Google keeps citing, and get a page written to
beat it. Built on Next.js, Supabase, DataForSEO, Claude, and Vercel.

The product plan is in [`PLAN.md`](./PLAN.md). Conventions for contributors (and Claude Code) are
in [`CLAUDE.md`](./CLAUDE.md).

## How it works

1. **Add a keyword.** We capture today's AI Overview immediately with DataForSEO.
2. **We watch it for 7 days.** A daily cron captures the full answer and every citation.
3. **You get the report and the page.** On day 7 Claude finds the patterns, reads the most-cited
   pages, and writes a page built around the findings, with placeholders for your own data.
4. **Keep tracking.** After you publish, we keep checking and tell you when your site gets cited.

## Setup (about 20 minutes)

### 1. Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open the SQL editor and run `supabase/migrations/0001_init.sql`
   (or `supabase link` + `supabase db push` with the CLI).
3. Authentication: follow [`docs/auth-setup.md`](./docs/auth-setup.md). The app uses email codes
   and magic links, no passwords.
4. Project Settings -> API: copy the project URL, the publishable (anon) key, and the service
   role key.

### 2. DataForSEO

1. Create an account at https://app.dataforseo.com and add the minimum $50 balance.
2. API Access: copy the API login and password.

Each daily capture costs about $0.004 (Live SERP $0.002 plus the async AI Overview surcharge,
refunded when the overview is cached or absent), about $0.03 per keyword week.

### 3. Anthropic

Create an API key at https://console.anthropic.com. Analysis and writing use `claude-opus-5-5`.
Expect roughly $0.50 to $0.80 per keyword for the report and the draft.

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
2. Add every variable from step 4 in Project Settings -> Environment Variables.
3. Deploy. `vercel.json` registers the daily cron at `/api/cron/capture`; Vercel sends
   `Authorization: Bearer <CRON_SECRET>` automatically.
4. In Supabase, add `https://<your-domain>/auth/confirm` to the auth Redirect URLs.

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
