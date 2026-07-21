# Skivio (skivio.org)

Programmatic SEO site for ski resorts: **entities × modifiers**. Resorts in Postgres crossed
against intent patterns, rendering static pages from templates. Zero hand-written content —
every page is computed from data. See `CLAUDE.md` at the repo root for the full spec (source of truth).

## Stack

- **Next.js (App Router, `output: 'export'`)** — every page is complete HTML at build time.
- **Postgres 16** — entity store for the ingest pipeline.
- **`data/snapshot.json`** — the build's only data input, exported from Postgres. Committed, so
  `npm run build` works anywhere without a database.

## Current data state — READ THIS

The environment this was built in blocks outbound HTTPS to the seed sources
(query.wikidata.org, tiles.openskimap.org, pass sites all 403 through the proxy). So v0 runs on
a **provisional curated seed** (`pipeline/seed/*.json`): 257 major North American resorts +
2026-27 pass rosters (Ikon unlimited-18, Mountain Collective, and Midwest Family Indy→Ikon moves
verified against press coverage; Indy roster is a partial subset).

The real pipeline (steps 1–3 below) is written and ready. Once network access to those hosts is
enabled (Claude Code environment settings → network policy, or run locally):

```bash
npm run pipeline:full     # wikidata → openskimap → rosters → score → snapshot
npm run build             # regenerate the whole site at full scale
npm run audit             # must pass before deploy
```

Until then, treat every stat as provisional; the pipeline replaces the seed wholesale.

## Pipeline (build order per spec)

| Step | Script | What it does |
|---|---|---|
| 1 | `pipeline/01-wikidata-pull.mjs` | SPARQL Q130003+subclasses → resorts skeleton (CC0) |
| 2 | `pipeline/02-openskimap-enrich.mjs` | ski_areas GeoJSON join by name+2km; ambiguous → `data/ambiguous-matches.csv` (ODbL — footer attribution required) |
| 3 | `pipeline/03-pass-rosters.mjs` | Scrape 4 roster pages → pass_resorts; unmatched → `data/unmatched-roster.csv` |
| — | `pipeline/load-seed.mjs` | Provisional seed loader (replaces 1–3 while network is blocked) |
| 4 | `pipeline/04-score-and-floor.mjs` | data_score + floor report (`data/floor-report.txt`) |
| 5 | `pipeline/05-export-snapshot.mjs` | Postgres → `data/snapshot.json` |

Postgres bootstrap: `psql -f schema.sql` against `postgres://skivio:skivio@127.0.0.1:5432/skivio`
(override with `DATABASE_URL`).

## Quality floor (enforced at generation)

- Resort page: `data_score >= 3`
- Vs-page: BOTH resorts `>= 4`, same region OR shared pass, slugs alphabetical in URL
- Filter/geo/best/records pages: `>= 3` qualifying resorts
- Below-floor resorts stay in the DB with no URL.

## Page inventory (current seed build)

See `data/floor-report.txt`. Roughly: 257 resort pages, ~5.3k vs-pages, 4 pass hubs +
regional subsets, 25 geo hubs, best-for pages, ~100 records pages.

## SEO plumbing

- Segmented sitemaps: `sitemap-resorts.xml`, `sitemap-vs.xml`, `sitemap-pass.xml`,
  `sitemap-geo.xml` + `sitemap.xml` index (per-cluster GSC telemetry — do not merge).
- Self-referencing canonicals on every page; unique computed title/meta; SkiResort JSON-LD.
- `public/robots.txt`; IndexNow key file in `public/` (key in `.indexnow-key`).
- Launch-day: deploy `out/`, submit sitemap in GSC + Bing Webmaster, run `node scripts/submit.mjs`
  for the IndexNow ping. Then the six-week hands-off window.

## Commands

```bash
npm run pipeline:seed   # seed → score → snapshot (no network needed)
npm run build           # static export to out/
npm run audit           # pre-launch audit: raw-HTML checks, link resolution,
                        # sitemap parity, orphan/depth check
npm run dev             # local dev server
```

## Deploy

`out/` is a fully static site — any static host (Cloudflare Pages, Vercel, Netlify, GitHub
Pages on the skivio.org domain). No server, no CMS, no auth. Affiliate IDs
(`NEXT_PUBLIC_BOOKING_AID`) get set at build time once the site is live and programs approve.
