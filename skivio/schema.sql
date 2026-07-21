-- Skivio schema (skivio.org) — per CLAUDE.md. Metric stored; imperial derived at render time.
DROP TABLE IF EXISTS pass_resorts;
DROP TABLE IF EXISTS passes;
DROP TABLE IF EXISTS resorts;

CREATE TABLE resorts (
  id            serial PRIMARY KEY,
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  country       text NOT NULL,
  region        text,            -- state/province
  lat           numeric NOT NULL,
  lng           numeric NOT NULL,
  summit_elev_m integer,
  base_elev_m   integer,
  vertical_m    integer,
  lifts_total   integer,
  runs_total    integer,
  pct_beginner  integer,         -- terrain difficulty split, sums ~100
  pct_intermediate integer,
  pct_expert    integer,
  night_skiing  boolean,
  wikidata_qid  text,
  openskimap_id text,
  data_score    integer NOT NULL DEFAULT 0   -- see quality floor
);

CREATE TABLE passes (
  id    serial PRIMARY KEY,
  slug  text UNIQUE NOT NULL,    -- epic, ikon, indy, mountain-collective
  name  text NOT NULL,
  season text NOT NULL           -- '2026-27'; re-seeded yearly
);

CREATE TABLE pass_resorts (
  pass_id    integer REFERENCES passes(id),
  resort_id  integer REFERENCES resorts(id),
  access     text NOT NULL,      -- 'unlimited' | 'limited'
  days_limit integer,            -- when access = 'limited'
  PRIMARY KEY (pass_id, resort_id)
);

CREATE INDEX idx_resorts_country_region ON resorts (country, region);
CREATE INDEX idx_resorts_data_score ON resorts (data_score);
CREATE INDEX idx_pass_resorts_resort ON pass_resorts (resort_id);
