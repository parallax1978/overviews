# Legiit Overviews

A small SaaS: a user enters a Google search, we capture its AI Overview every day for 7 days
with DataForSEO, then Claude finds the patterns, studies the cited pages, and writes a better page.
The full product plan is in `PLAN.md`. Read it before changing product behavior.

## Stack

- Next.js 16 (App Router, TypeScript, Turbopack). **This Next.js version differs from older
  training data**: `proxy.ts` replaces `middleware.ts`, `params`/`searchParams` are Promises,
  `cookies()` is async. Docs ship in `node_modules/next/dist/docs/`.
- Tailwind CSS v4. Design tokens live in `app/globals.css` (`@theme`). Use the generated
  utilities (`text-ink`, `bg-brand`, `border-line`, `shadow-pop`, `rounded-card`) and the custom
  utilities (`brand-gradient`, `hero-dark`, `eyebrow`, `text-gradient`, `prose-overview`).
  Never hardcode hex colors in components.
- Supabase: Postgres + Auth (email OTP code / magic link, no passwords) + RLS.
  Schema: `supabase/migrations/0001_init.sql`. Types: `lib/types.ts`.
  Clients: `lib/supabase/server.ts` (user, RLS), `lib/supabase/client.ts` (browser),
  `lib/supabase/admin.ts` (service role, server only, bypasses RLS).
- DataForSEO SERP API for AI Overview capture: `lib/dataforseo.ts`.
- Anthropic SDK (`claude-opus-5-5`) for analysis and writing: `lib/claude.ts`.
- Vercel hosting + Vercel Cron (`vercel.json` -> `/api/cron/capture`, daily).

## Rules

- Real APIs and real data only. No mock data, no fake fixtures in the app. Test fixtures saved
  from real responses live under `tests/fixtures/` and are used by unit tests only.
- Keep it simple for an everyday user: short sentences, no SEO jargon in the UI, one obvious
  next action per screen.
- Every external API call writes an `api_log` row (provider, endpoint, status, cost, duration).
- Server code that writes `snapshots`, `analyses`, `drafts` uses the admin client **after**
  verifying the caller owns the tracker (or from the cron, which is secret-protected).
- Env vars are read through `lib/env.ts` only.
- Commit messages: imperative, one line summary, blank line, details.

## Commands

```
npm run dev          # local dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest unit tests
npm run build        # production build
```

## Layout

```
app/                 routes (landing, login, auth callbacks, /app dashboard, /api)
components/          ui primitives (button, card, chip, markdown), brand, site, app
lib/                 env, types, utils, auth, supabase clients, dataforseo, claude, capture, analyze
supabase/migrations  SQL schema (apply with `supabase db push`)
scripts/             one-off dev scripts (run with `npx tsx scripts/<name>.ts`)
tests/               vitest tests and real-response fixtures
```
