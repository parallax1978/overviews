# Legiit Overviews: build plan

> Status: built and deployed. Three things changed from this plan during the build, after
> measuring real data: (1) each daily capture takes three samples, because Google generates a
> different AI Overview per request, and reports count across samples; (2) the report and the
> draft run as separate requests, each a few minutes long; (3) the blueprint plans a page that
> beats the cited pages (winning angle, gaps, contradictions) and each keyword chooses whether the
> page may name other brands (default: no). `README.md` describes the current behavior.

A small SaaS that does exactly what Jake Ward's thread describes
(https://x.com/jakezward/status/2107453596107219294):

1. Pick one Google search that shows an AI Overview.
2. Track how the AI Overview changes over 7 days (full answer, citations, date).
3. Find the patterns with AI: recurring claims, repeated entities, common formats, frequent sources, differences between days.
4. Reverse engineer the most-cited pages: what they cover, how fast they answer, structure, tables/lists, data, gaps.
5. Build a better page around the findings, and add something new worth citing.
6. Publish, then keep tracking to see if you get cited.

This document is written so a Claude Code session can execute it phase by phase.
Real APIs and real data from the first commit. No mocks.

---

## 1. Decisions already made

| Area | Decision |
|---|---|
| Product name (working) | **Legiit Overviews**. Wordmark: `Legiit` + `Overviews` in brand purple, same pattern as LegiitKeywords. Easy to rename. |
| Framework | Next.js 15, App Router, TypeScript, Tailwind CSS v4, lucide-react icons (same stack as legiitkeywords.com). |
| Backend | Supabase: Postgres, Auth (email code / magic link, no password), Row Level Security. |
| Hosting | Vercel. Vercel Cron for the daily capture. Pro plan recommended (Hobby allows one daily cron with up to 59 min jitter but forbids commercial use). |
| SERP data | DataForSEO `POST /v3/serp/google/organic/live/advanced` with `load_async_ai_overview: true`. |
| AI | Anthropic SDK (`@anthropic-ai/sdk`), model `claude-opus-5-5`, adaptive thinking, streaming, structured outputs for JSON, `web_fetch` server tool for reading cited pages. |
| Billing | Not in v1. Users sign in and use it. Credits/Stripe/Legiit checkout is a later phase. |
| Scope | Google, desktop, one country + language per keyword (default United States / English). |

## 2. What the user experiences

Everything is three screens. No settings pages, no jargon.

**Screen 1: Add a keyword** (`/app/new`)
- One text box: "What search do you want to win?"
- Country (default United States) and language (default English) dropdowns.
- Optional: "Your website" (domain). Used later to tell them when they get cited.
- Optional: "Your edge" (textarea): what they know, have, or can show that competitors can't (original data, experience, product). Claude uses this when writing the page instead of inventing it.
- Click **Start tracking**. We capture today's AI Overview immediately (10 to 20 seconds), then land them on the keyword page.
- If no AI Overview appeared today, say so plainly and keep tracking anyway. If none appears across all 7 days, tell them to pick a different search.

**Screen 2: Dashboard** (`/app`)
- A list of their keywords. Each row: keyword, "Day 3 of 7", AI Overview present today (yes/no), citations seen so far, status chip (Tracking / Ready / Report ready / Paused), and a button for the next action.

**Screen 3: Keyword page** (`/app/[id]`) with four tabs
- **Timeline**: one card per day with the full AI Overview text and its citations. Changes versus the previous day are highlighted (new or dropped citations, changed sentences).
- **Citations**: a table of every source seen. Columns: domain, page, days cited (x of 7), first seen, last seen. Sorted by days cited. This is the "what Google consistently includes" view.
- **Report** (appears after day 7, or earlier via "Analyze now" once there are at least 2 snapshots): the patterns and the citation teardown, written in plain English, plus a "page blueprint" (what the page must cover, in what order, in what format).
- **Draft**: the finished article (title, meta description, H1, body in Markdown, with clearly marked `[ADD YOUR DATA: ...]` placeholders where original data or experience belongs), a "why this beats the current sources" checklist, Copy and Download buttons, and a "Regenerate with notes" box.
- After the draft exists: a **Keep tracking** toggle. Snapshots continue daily, and the dashboard shows "You were cited on day N" when their domain appears in the references.

## 3. Branding (lifted from legiitkeywords.com)

Font: **Inter Variable** (self-hosted via `@fontsource-variable/inter`, weights 100 to 900). Mono: system monospace.

Design tokens (Tailwind v4 `@theme` in `globals.css`):

```css
--color-ink: #0f172a;        --color-ink-muted: #64748b;   --color-ink-soft: #94a3b8;
--color-line: #e5e7eb;       --color-line-strong: #d1d5db;
--color-surface: #fff;       --color-surface-alt: #f7f7fb;  --color-surface-sunken: #f1f1f6;
--color-brand: #8a12dc;      --color-brand-strong: #6e0db1;
--color-brand-soft: #e9d5ff; --color-brand-faint: #f3e8ff;  --color-plum: #12081f;
--color-good: #15803d;       --color-good-soft: #dcfce7;
--color-warn: #b45309;       --color-warn-soft: #fef3c7;
--color-bad: #b91c1c;        --color-bad-soft: #fee2e2;
--radius-card: .75rem;
```

Utility classes to reproduce exactly:

```css
.brand-gradient { background-image: linear-gradient(135deg, #8a12dc, #1863dc); }
.text-gradient  { color: transparent; background-image: linear-gradient(90deg, #a855f7, #d946ef 55%, #ec4899); background-clip: text; }
.hero-dark      { color: #fff; background-color: var(--color-plum);
                  background-image: radial-gradient(60% 80% at 50% 110%, #8a12dc73, transparent 70%), radial-gradient(#ffffff0f 1px, transparent 0);
                  background-size: auto, 22px 22px; }
.eyebrow        { letter-spacing: .18em; text-transform: uppercase; font-size: 11px; font-weight: 600; }
.shadow-glow    { box-shadow: 0 8px 24px -8px #8a12dc99; }
.shadow-pop     { box-shadow: 0 8px 30px #0f172a1f, 0 2px 6px #0f172a0f; }
```

Components to match:
- **Header**: sticky, `bg-white/90 backdrop-blur border-b border-line`, container `max-w-5xl px-4 py-3`. Logo = 7x7 `brand-gradient rounded-lg shadow-glow` square with a white lucide icon (use `sparkles` instead of `search`), then wordmark `font-bold tracking-tight text-[15px]`: `Legiit<span class="text-brand">Overviews</span>`.
- **Primary button**: `rounded-full font-semibold bg-brand text-white shadow-glow hover:bg-brand-strong px-5 py-2.5`.
- **Secondary button**: `rounded-full font-semibold bg-white text-ink ring-1 ring-inset ring-line hover:bg-surface-alt`.
- **Cards**: `rounded-2xl border border-line bg-white shadow-pop p-5`. Lists inside cards: `divide-y divide-line rounded-xl border border-line`.
- **Numbered badge**: `h-7 w-7 rounded-full bg-brand-faint text-brand-strong text-xs font-bold`.
- **Status chips**: good / warn / bad soft backgrounds with matching text colors.
- **Landing hero**: `hero-dark` section, eyebrow in `text-brand-soft`, H1 `text-4xl sm:text-5xl font-bold tracking-tight` with the second line in `text-gradient`, subhead `text-white/75`, a single keyword input (`rounded-full bg-white/10 border-white/15 text-white`) with the primary button.
- **Footer**: `border-t border-line`, wordmark, "· A Legiit product", small nav, legal links.
- Tone: short declarative sentences, no jargon on the main screens. "No password. Cancel any time." style reassurance.

## 4. Architecture

```
Browser (Next.js app, Supabase auth cookies)
   |
   v
Next.js Route Handlers / Server Actions (Vercel)
   |-- lib/dataforseo.ts   -> DataForSEO SERP API (capture AI Overview)
   |-- lib/claude.ts       -> Anthropic API (analysis, citation research via web_fetch, draft)
   |-- lib/supabase/*      -> Supabase (user client with RLS; service-role client for cron)
   |
Vercel Cron (daily) -> GET /api/cron/capture (Bearer CRON_SECRET)
```

### 4.1 Database (Supabase, one migration file `supabase/migrations/0001_init.sql`)

```sql
create table trackers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  location_code int not null default 2840,      -- United States
  location_name text not null default 'United States',
  language_code text not null default 'en',
  device text not null default 'desktop',
  target_domain text,                            -- optional, "your website"
  user_edge text,                                -- optional, "your edge"
  status text not null default 'tracking',       -- tracking | ready | analyzing | analyzed | paused | error
  days_target int not null default 7,
  day_count int not null default 0,              -- snapshots captured so far
  next_capture_at timestamptz,
  keep_tracking boolean not null default false,
  cited_on_day int,                              -- first day target_domain appeared
  created_at timestamptz not null default now()
);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references trackers(id) on delete cascade,
  day_number int not null,
  captured_at timestamptz not null default now(),
  has_overview boolean not null,
  overview_text text,              -- plain text of the whole AI Overview
  overview_markdown text,          -- concatenated markdown of ai_overview_element items
  references jsonb not null default '[]',   -- [{url, domain, title, snippet, source, element_index}]
  inline_links jsonb not null default '[]', -- [{url, domain, title}] from items[].links
  raw jsonb,                       -- the full ai_overview item from DataForSEO
  content_hash text,
  diff jsonb,                      -- {added_refs:[], removed_refs:[], text_similarity: 0-1, changed_sentences:[]}
  cost_usd numeric(10,6) default 0,
  unique (tracker_id, day_number)
);

create table analyses (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references trackers(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'running',  -- running | done | error
  model text,
  patterns jsonb,            -- structured output (see 4.4)
  citation_research jsonb,   -- structured output (see 4.4)
  blueprint jsonb,           -- structured output (see 4.4)
  summary_md text,           -- plain-English report
  usage jsonb, error text
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references trackers(id) on delete cascade,
  analysis_id uuid references analyses(id) on delete set null,
  created_at timestamptz not null default now(),
  title text, meta_description text, h1 text,
  outline jsonb, content_md text, why_better_md text,
  notes text,                -- user's regenerate instructions
  model text, usage jsonb
);

create table api_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  tracker_id uuid, provider text, endpoint text,
  status int, cost_usd numeric(10,6), duration_ms int, error text
);
```

RLS: enable on all four user tables. Policy: `trackers.user_id = auth.uid()`; snapshots/analyses/drafts readable when `exists (select 1 from trackers t where t.id = tracker_id and t.user_id = auth.uid())`. Writes to snapshots/analyses/drafts happen server-side with the service-role client. `api_log` is service-role only.

### 4.2 DataForSEO capture (`lib/dataforseo.ts`)

- Auth: HTTP Basic, `Authorization: Basic base64(login:password)`.
- Request body (array of one task):

```json
[{
  "keyword": "best form builder",
  "location_code": 2840,
  "language_code": "en",
  "device": "desktop",
  "os": "windows",
  "depth": 10,
  "load_async_ai_overview": true
}]
```

- Response: `tasks[0].result[0].items[]`. Find the item with `type === "ai_overview"`.
  - `items[]` of that element: `ai_overview_element` (has `title`, `text`, `markdown`, `links[]`, `references[]`), `ai_overview_table_element` (`markdown`, `table`, `references[]`), `ai_overview_expanded_element` (`components[]`, each with `text`, `markdown`, `references[]`), `ai_overview_video_element`.
  - Top-level `references[]` on the ai_overview item: additional sources. Each reference has `source`, `domain`, `url`, `title`, `text` (the snippet Google used).
  - `asynchronous_ai_overview: true` means it was loaded via the async flag.
- Normalize into one `snapshot`: concatenate element markdown/text in order; union of all references (dedupe by URL, keep which element cited it); `inline_links` from `links[]`; `has_overview = false` if no ai_overview item or it has no items.
- Record cost from `tasks[0].cost` into `snapshots.cost_usd` and `api_log`.
- Always capture with the same location, language, and device so days are comparable.
- Retry once on network/5xx. On DataForSEO error status (`tasks[0].status_code != 20000`) store an `api_log` row and mark the day as failed (no snapshot row), so the cron tries again next run.

Cost: Live mode is $0.002 per request, and `load_async_ai_overview` adds another $0.002 (refunded by DataForSEO when the overview was already cached or absent). Budget **$0.004 per capture, about $0.03 per keyword-week**. Minimum DataForSEO deposit is $50.

### 4.3 Daily capture (`app/api/cron/capture/route.ts` + `vercel.json`)

```json
{ "crons": [{ "path": "/api/cron/capture", "schedule": "0 6 * * *" }] }
```

- Reject unless `Authorization: Bearer ${CRON_SECRET}`.
- `export const maxDuration = 300`.
- Select trackers where `status in ('tracking')` or `keep_tracking = true`, and `next_capture_at <= now()`.
- Capture with concurrency 4. For each: insert snapshot with `day_number = day_count + 1`, compute `diff` against the previous snapshot, bump `day_count`, set `next_capture_at = now() + interval '1 day'`, check `target_domain` against references and set `cited_on_day` if first match.
- When `day_count >= days_target` and status is `tracking`: set status `ready`, then **auto-run the analysis and draft** (section 4.4) so the everyday user just finds the report waiting. If auto-run fails, status stays `ready` and the keyword page shows an "Analyze now" button.
- Idempotent: the `unique (tracker_id, day_number)` constraint prevents double captures if a run overlaps.

Day 1 is captured synchronously inside the create flow (user is waiting), with `next_capture_at = now() + 1 day`.

Diff computation (plain TypeScript, no library needed): sentence split both texts, mark sentences present only in today's text as changed; citation sets by URL for added/removed; `text_similarity` via a simple token Jaccard. This is only for display.

### 4.4 Claude analysis and draft (`lib/claude.ts`)

Two calls, both `claude-opus-5-5`, `thinking: { type: "adaptive" }`, `output_config: { effort: "high" }`, streamed with `.stream()` + `finalMessage()`, with server-side fallbacks enabled (`betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"`). Check `stop_reason` for `refusal` before reading content. Log `usage` on the rows.

**Call 1: Analyze** (input: all snapshots' text + references, the keyword, country; tools: `web_fetch_20260209` with `max_uses` 10 and the top cited URLs listed in the prompt so they are fetchable)

Prompt tells Claude to do exactly the thread's steps 3 and 4, and to return JSON via structured outputs (`output_config.format` with a JSON schema; if the API rejects structured outputs together with server tools, request JSON in the final text block and parse it, validating with zod):

```ts
{
  patterns: {
    recurring_claims: [{ claim: string, days_present: number, example: string }],
    repeated_entities: [{ entity: string, days_present: number, role: string }],   // brands, products, concepts
    formats: { opening: string, structure: string, uses_table: boolean, uses_list: boolean, typical_length_words: number },
    frequent_sources: [{ domain: string, url: string, days_cited: number, cited_for: string }],
    differences: [{ day: number, what_changed: string }],
    stable_core: string          // the part Google always includes, in one paragraph
  },
  citation_research: [{
    url: string, domain: string, days_cited: number, fetched: boolean,
    answers_how_fast: string,    // "first sentence", "after 3 paragraphs", ...
    topics_covered: string[], entities_covered: string[],
    structure: string, uses_tables: boolean, uses_lists: boolean,
    data_included: string[], gaps: string[]
  }],
  blueprint: {
    page_goal: string, target_question: string,
    must_cover: [{ topic: string, why: string }],
    must_mention: string[],      // entities
    recommended_format: string,  // e.g. "direct answer, then comparison table, then per-option sections"
    opening_answer: string,      // the one-paragraph direct answer the page should open with
    sections: [{ heading: string, purpose: string, format: "paragraph" | "table" | "list" | "faq" }],
    something_new: [{ idea: string, why_google_would_cite_it: string }]   // original data, comparisons, unanswered questions
  },
  summary_md: string             // plain-English report for the Report tab, under 600 words
}
```

Pick the top cited URLs by `days_cited` (max 8) for fetching. If a fetch fails, set `fetched: false` and work from the snippet Google showed.

**Call 2: Draft** (input: the blueprint, the stable core text, the user's edge, optional regenerate notes)

Return JSON: `title`, `meta_description`, `h1`, `outline`, `content_md`, `why_better_md`. Rules in the prompt:
- Answer the target question in the first two sentences.
- Follow the blueprint's sections and formats; include a table when the blueprint says so.
- Mention every `must_mention` entity naturally.
- Never invent statistics, experience, or testimonials. Where the blueprint's `something_new` needs the user's data, write a visible placeholder like `[ADD YOUR DATA: average setup time from your customers]`. If `user_edge` was given, use it and cite it as the author's own.
- 1,200 to 2,500 words unless the blueprint's typical length suggests otherwise.
- `why_better_md`: a checklist comparing this page to the current top sources: what it covers that they don't, how much faster it answers, what original element it adds.

Rough Claude cost per keyword with Opus 5.5 ($4 / $20 per MTok): analysis with 8 fetched pages around 60k input and 6k output, draft around 15k input and 6k output. **About $0.50 to $0.80 per keyword**, most of it the analysis.

### 4.5 Routes

| Route | Method | Does |
|---|---|---|
| `/` | page | Landing (hero, 3 steps, CTA to `/login`). |
| `/login` | page | Email + 6-digit code via Supabase `signInWithOtp` / `verifyOtp`. No password. |
| `/auth/confirm` | GET | Magic-link `token_hash` exchange (for users who click the email link instead). |
| `/app` | page | Dashboard. |
| `/app/new` | page + server action | Create tracker, capture day 1, redirect to `/app/[id]`. |
| `/app/[id]` | page | Timeline / Citations / Report / Draft tabs. |
| `/api/trackers/[id]/analyze` | POST | Runs Call 1 then Call 2. `maxDuration = 300`. Sets `analyses.status`; the page polls every 3s and shows "Reading 7 days of overviews", "Studying 8 cited pages", "Writing your page". |
| `/api/trackers/[id]/draft` | POST | Regenerate draft with `notes`. |
| `/api/trackers/[id]` | PATCH | Pause, resume, toggle keep_tracking, delete. |
| `/api/cron/capture` | GET | Daily capture (section 4.3). |

Supabase clients: `lib/supabase/client.ts` (`createBrowserClient`), `lib/supabase/server.ts` (`createServerClient` with cookie handlers), `middleware.ts` refreshing the session with `supabase.auth.getClaims()` and redirecting unauthenticated `/app/*` to `/login`. `lib/supabase/admin.ts` uses the service-role key, server only.

### 4.6 Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=    (or the anon key)
SUPABASE_SERVICE_ROLE_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
ANTHROPIC_API_KEY=
CRON_SECRET=                              (random 32+ chars)
NEXT_PUBLIC_APP_URL=https://...
```

## 5. Phases for Claude Code (one session or PR each)

### Phase 1: Scaffold, branding, auth, schema
- `npx create-next-app@latest` (TypeScript, App Router, Tailwind v4, `src/` off, ESLint). Add `@supabase/supabase-js`, `@supabase/ssr`, `@anthropic-ai/sdk`, `lucide-react`, `@fontsource-variable/inter`, `zod`.
- `globals.css` with the tokens and utilities from section 3. Shared `Header`, `Footer`, `Button`, `Card`, `Chip`, `Eyebrow` components.
- Supabase migration `0001_init.sql` with tables, RLS, indexes (`trackers(user_id)`, `trackers(next_capture_at)`, `snapshots(tracker_id, day_number)`). Apply it to the real project (Supabase CLI `supabase db push`, or paste into the SQL editor).
- Login with email code, middleware protection, empty dashboard, landing page.
- `CLAUDE.md` with: stack, where tokens live, "no mock data", how to run, env var list.
- Done when: a real user can sign in on Vercel preview and see an empty dashboard styled like Legiit Keywords.

### Phase 2: Capture and track
- `lib/dataforseo.ts` with the normalizer and a unit test against a saved real response (save one real response as a fixture after the first live call; the fixture is for the parser test only, the app never reads it).
- `/app/new` with day-1 live capture. `/app/[id]` Timeline and Citations tabs. Diff computation.
- Cron route + `vercel.json` + `CRON_SECRET`. A `scripts/capture-now.ts` for manual runs during development (`curl` the cron route with the secret).
- Done when: three real keywords are added, day 1 shows real AI Overviews and citations, and a manual cron run creates day 2 for all three.

### Phase 3: Analysis and draft
- `lib/claude.ts` with both calls, zod schemas, usage logging.
- Analyze endpoint, polling UI with step messages, Report tab, Draft tab (copy, download `.md`, regenerate with notes).
- Auto-analysis hook inside the cron when day 7 lands.
- Done when: one of the real keywords (use "Analyze now" after 2+ days) produces a report whose cited pages were actually fetched, and a draft with real entities from the overview.

### Phase 4: Polish and ship
- Empty states, error states (no AI Overview today, DataForSEO error, Claude refusal), loading states, mobile layout check at 375px.
- Keep-tracking toggle and "You were cited" chip.
- Pause / resume / delete.
- Deploy to Vercel production, set env vars and the cron, run a smoke test with real keywords, write `README.md` (setup in 10 steps).
- Done when: a new user can go from sign-in to a tracked keyword in under a minute, and the daily cron runs in production.

### Later (not in v1, decide when v1 works)
- Billing: credits per keyword via Stripe, or route through Legiit checkout like LegiitKeywords.
- Email when the report is ready and when the user gets cited (Resend).
- Mobile SERP tracking, Google AI Mode tracking (DataForSEO has `/v3/serp/google/ai_mode/live/advanced`).
- Shareable public report links.

## 6. Running costs at small scale

| Item | Cost |
|---|---|
| DataForSEO capture | $0.004 per capture, about $0.03 per keyword over 7 days |
| Claude Opus 5.5 analysis + draft | about $0.50 to $0.80 per keyword |
| Vercel Pro | $20 per month |
| Supabase | Free tier to start, Pro $25 per month when needed |
| Anthropic + DataForSEO | pay as you go (DataForSEO minimum deposit $50) |

So one keyword, start to finished draft, costs under a dollar in API spend.

## 7. What is needed before Phase 1 starts

1. A Supabase project: URL, publishable (anon) key, service-role key. Enable Email auth with OTP codes.
2. DataForSEO account login and password with at least the $50 deposit.
3. An Anthropic API key.
4. A Vercel project linked to `parallax1978/overviews` (Pro plan recommended), with the env vars from section 4.6.
5. Those same values added as environment secrets to the Claude Code cloud environment so each phase can be tested against real APIs during the build.

## 8. Reference notes gathered during research

- DataForSEO AI Overview docs: `ai_overview` item fields (`items[]`, `references[]`, `asynchronous_ai_overview`, `markdown`), `load_async_ai_overview` parameter and its extra charge. https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
- DataForSEO pricing: Live $0.002 per request, Standard queue $0.0006, async AI Overview flag adds one base price. https://dataforseo.com/pricing/google-serp/google-organic-serp-api
- Vercel cron limits: Hobby once per day with up to 59 min jitter; Pro per minute. Functions up to 300s default on all plans, 800s on Pro. https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase SSR auth for Next.js App Router (`createBrowserClient`, `createServerClient`, `getClaims()` in middleware). https://supabase.com/docs/guides/auth/server-side/nextjs
- Legiit Keywords tokens were read from its live stylesheet; the values in section 3 are exact.
