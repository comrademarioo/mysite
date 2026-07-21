# Skivio (skivio.org)

Programmatic SEO site for ski resorts: **entities × modifiers**. Resorts in Postgres crossed
against intent patterns, rendering static pages from templates. Zero hand-written content —
every page is computed from data. See `CLAUDE.md` at the repo root for the full spec (source of truth).

## Stack

- **Next.js (App Router, `output: 'export'`)** — every page is complete HTML at build time.
- **Postgres 16** — entity store for the ingest pipeline.
- **`data/snapshot.json`** — the build's only data input, exported from Postgres. Committed, so
  `npm run build` works anywhere without a database.

## Current data state

The full pipeline HAS run (2026-07): Wikidata skeleton (1,326 entities) → OpenSkiMap
enrichment (964 matched, stats + regions from the daily GeoJSON) → curated-seed overlay
(night skiing, gap-fill, verified pass tiers; 26 majors missing from Wikidata's class tree
inserted from seed) → live roster scrape. Roster sources that actually work headlessly:

- **Ikon** — the Sanity CMS dataset the site itself reads (public, includes coords).
- **Indy** — server-rendered `/our-resorts` page (138 alpine matches of 276 roster rows;
  the rest are XC/international, listed in `data/unmatched-roster.csv`).
- **Mountain Collective** — server-rendered `/resorts/` page.
- **Epic** — bot-walled to non-browser clients AND headless Chromium is blocked by this
  environment's egress proxy, so Epic stays on the seed roster (verified against 2026-27
  press coverage). Re-run `npm run ingest:passes` from an unrestricted machine to scrape live.

Review files (spec-mandated, never silently guessed): `data/ambiguous-matches.csv`
(34 Wikidata↔OpenSkiMap ambiguities, e.g. Whistler vs Blackcomb as separate OSM areas),
`data/unmatched-roster.csv`.

Refresh everything:

```bash
npm run pipeline:full     # wikidata → openskimap → rosters → score → snapshot
node pipeline/06-overlay-seed.mjs   # seed overlay (run between openskimap and rosters)
npm run build && npm run audit
```

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
