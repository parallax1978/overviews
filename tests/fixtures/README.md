# Test fixtures

These files are read by the unit tests only. The app never loads anything
from this folder; it always talks to the real DataForSEO API.

## `dataforseo-ai-overview.documented-sample.json`

A hand-written response that mirrors the **documented** DataForSEO structure
for `POST /v3/serp/google/organic/live/advanced` with `load_async_ai_overview`
(https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/).

It is not a real capture. It exists so `tests/overview.test.ts` can check the
normalizer against every documented element type:

- one `ai_overview` item with `asynchronous_ai_overview: true`
- an `ai_overview_element` with markdown, 2 inline links and 2 references
- an `ai_overview_table_element` with a 2x3 table and 1 reference
- an `ai_overview_expanded_element` with 2 components, 1 reference each
- 2 top-level `references`, one of which duplicates an element reference with
  a trailing slash and `utm_*` params (so the dedupe is exercised)
- a couple of `organic` items and a `people_also_ask` item, so the finder has
  to pick the right item

## `dataforseo-ai-overview.real.json` (not committed until you create it)

A real response saved from a live call. Create it with:

```
node scripts/dataforseo-probe.mjs "best form builder" --save
```

This costs about $0.004 and needs `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`
in `.env.local`. Once the file exists, `tests/overview.test.ts` also runs the
normalizer against it. Pick a search that actually shows an AI Overview;
the probe prints whether one was found. It is fine to commit the file.
