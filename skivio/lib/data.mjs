// Build-time data layer. Reads ONLY data/snapshot.json (exported from Postgres
// by pipeline/05-export-snapshot.mjs). All page sets, floors, and link
// relationships are computed here so templates stay dumb.
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from './slug.mjs';

export const SITE = 'https://skivio.org';

let cache = null;
export function db() {
  if (cache) return cache;
  const snap = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data', 'snapshot.json'), 'utf8'),
  );
  const resorts = snap.resorts;
  const bySlug = new Map(resorts.map((r) => [r.slug, r]));
  const passes = snap.passes;
  const passBySlug = new Map(passes.map((p) => [p.slug, p]));
  // resort slug -> [{pass, access, days_limit}]
  const passesOf = new Map();
  // pass slug -> [{resort, access, days_limit}]
  const rosterOf = new Map(passes.map((p) => [p.slug, []]));
  for (const m of snap.passResorts) {
    if (!passesOf.has(m.resort)) passesOf.set(m.resort, []);
    passesOf.get(m.resort).push(m);
    rosterOf.get(m.pass).push(m);
  }
  cache = { resorts, bySlug, passes, passBySlug, passesOf, rosterOf };
  return cache;
}

export const SEASON = () => db().passes[0]?.season || '2026-27';

// Names like "Blue Mountain" (ON + PA) exist twice; append the region whenever
// the bare name is ambiguous so every title/link is unique and unmistakable.
let ambiguousNames = null;
export function displayName(r) {
  if (!ambiguousNames) {
    const counts = new Map();
    for (const x of db().resorts) counts.set(x.name, (counts.get(x.name) || 0) + 1);
    ambiguousNames = new Set([...counts].filter(([, c]) => c > 1).map(([n]) => n));
  }
  return ambiguousNames.has(r.name) ? `${r.name} (${r.region})` : r.name;
}

// ---------- floors ----------
// Score floor + scope floor. North America is v1 scope; rest-of-world rows
// get pages only when they sit in a real cluster (a floor-passing region) or
// on a tracked pass — isolated one-offs (a lone Kazakh or Greek hill) fail
// the 4-clicks-from-home reachability law and are exactly the thin tail the
// spec says not to ship. They stay in the DB as inventory.
const NA = new Set(['United States', 'Canada', 'Mexico']);

let regionCountCache = null;
function regionCount(r) {
  if (!regionCountCache) {
    regionCountCache = new Map();
    for (const x of db().resorts) {
      if (x.data_score >= 3 && x.region) {
        const k = `${x.country}|${x.region}`;
        regionCountCache.set(k, (regionCountCache.get(k) || 0) + 1);
      }
    }
  }
  return r.region ? regionCountCache.get(`${r.country}|${r.region}`) || 0 : 0;
}

export function resortQualifies(r) {
  if (r.data_score < 3) return false;
  if (NA.has(r.country)) return true;
  const onPass = db().passesOf.has(r.slug);
  return onPass || regionCount(r) >= 3;
}
export const vsQualifies = (r) => r.data_score >= 4 && resortQualifies(r);

export function qualifyingResorts() {
  return db().resorts.filter(resortQualifies);
}

// ---------- units ----------
export const mToFt = (m) => (m == null ? null : Math.round(m * 3.28084));
export const fmt = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

// ---------- geo ----------
export const countrySlug = (country) => slugify(country);
export const regionSlug = (region) => slugify(region);

export function geoHubs() {
  const groups = new Map();
  for (const r of qualifyingResorts()) {
    if (!r.region) continue;
    const key = `${r.country}|${r.region}`;
    if (!groups.has(key)) groups.set(key, { country: r.country, region: r.region, resorts: [] });
    groups.get(key).resorts.push(r);
  }
  // Floor: filter/geo pages exist only with >= 3 qualifying resorts.
  return [...groups.values()]
    .filter((g) => g.resorts.length >= 3)
    .map((g) => ({
      ...g,
      countrySlug: countrySlug(g.country),
      regionSlug: regionSlug(g.region),
      path: `/${countrySlug(g.country)}/${regionSlug(g.region)}`,
    }))
    .sort((a, b) => b.resorts.length - a.resorts.length);
}

export function geoHub(cSlug, rSlug) {
  return geoHubs().find((g) => g.countrySlug === cSlug && g.regionSlug === rSlug) || null;
}

// ---------- vs pages ----------
// Pairing rule: same region OR (same pass AND within 250 km), BOTH
// data_score >= 4. The distance qualifier exists because the real Indy roster
// (138 resorts) turns an unqualified same-pass leg into a ~10k-page full mesh
// of implausible cross-country pairs — the spec's stated expectation is 3-5k
// vs-pages, and 250 km keeps the pass leg to genuine "which mountain on my
// pass" decisions. Canonical URL orders slugs alphabetically; separator
// '-vs-' (slugs contain hyphens, so a bare '{a}-{b}' join is unparseable).
const SAME_PASS_MAX_KM = 250;
let vsCache = null;
export function vsPairs() {
  if (vsCache) return vsCache;
  const { resorts, passesOf } = db();
  const eligible = resorts.filter(vsQualifies);
  const passSets = new Map(
    eligible.map((r) => [r.slug, new Set((passesOf.get(r.slug) || []).map((m) => m.pass))]),
  );
  const pairs = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j];
      const sameRegion = a.country === b.country && a.region && a.region === b.region;
      let samePass = false;
      if (!sameRegion && distanceKm(a, b) <= SAME_PASS_MAX_KM) {
        for (const p of passSets.get(a.slug)) {
          if (passSets.get(b.slug).has(p)) { samePass = true; break; }
        }
      }
      if (sameRegion || samePass) {
        const [s1, s2] = [a.slug, b.slug].sort();
        pairs.push({ a: s1, b: s2, key: `${s1}-vs-${s2}` });
      }
    }
  }
  vsCache = pairs;
  return pairs;
}

let vsByKeyCache = null;
export function vsByKey(key) {
  if (!vsByKeyCache) vsByKeyCache = new Map(vsPairs().map((p) => [p.key, p]));
  return vsByKeyCache.get(key) || null;
}

let vsOfCache = null;
export function vsPagesOf(slug) {
  if (!vsOfCache) {
    vsOfCache = new Map();
    for (const p of vsPairs()) {
      if (!vsOfCache.has(p.a)) vsOfCache.set(p.a, []);
      if (!vsOfCache.has(p.b)) vsOfCache.set(p.b, []);
      vsOfCache.get(p.a).push(p);
      vsOfCache.get(p.b).push(p);
    }
  }
  return vsOfCache.get(slug) || [];
}

// ---------- pass pages ----------
export function passRoster(passSlug) {
  const { rosterOf, bySlug } = db();
  return (rosterOf.get(passSlug) || [])
    .map((m) => ({ ...m, r: bySlug.get(m.resort) }))
    .filter((m) => m.r && resortQualifies(m.r));
}

// /pass/{pass}/{region}: floor >= 3 qualifying resorts in that region.
export function passRegions(passSlug) {
  const groups = new Map();
  for (const m of passRoster(passSlug)) {
    if (!m.r.region) continue;
    const key = regionSlug(m.r.region);
    if (!groups.has(key)) groups.set(key, { region: m.r.region, regionSlug: key, members: [] });
    groups.get(key).members.push(m);
  }
  return [...groups.values()]
    .filter((g) => g.members.length >= 3)
    .sort((a, b) => b.members.length - a.members.length);
}

// ---------- best pages ----------
export const TRAITS = [
  {
    slug: 'for-beginners', label: 'Beginners', noun: 'beginner terrain',
    filter: (r) => r.pct_beginner != null && r.pct_beginner >= 20,
    rank: (r) => r.pct_beginner * 2 + (r.runs_total || 0) / 10,
    line: (r) => `${r.pct_beginner}% beginner terrain across ${fmt(r.runs_total)} runs`,
  },
  {
    slug: 'for-experts', label: 'Experts', noun: 'expert terrain',
    filter: (r) => r.pct_expert != null && r.pct_expert >= 30,
    rank: (r) => r.pct_expert * 2 + (r.vertical_m || 0) / 25,
    line: (r) => `${r.pct_expert}% expert terrain with ${fmt(mToFt(r.vertical_m))} ft of vertical`,
  },
  {
    slug: 'for-night-skiing', label: 'Night Skiing', noun: 'night skiing',
    filter: (r) => r.night_skiing === true,
    rank: (r) => (r.vertical_m || 0) + (r.runs_total || 0),
    line: (r) => `night skiing on ${fmt(r.runs_total)} total runs, ${fmt(mToFt(r.vertical_m))} ft vertical`,
  },
];

export function bestPages() {
  const out = [];
  for (const g of geoHubs()) {
    for (const t of TRAITS) {
      const matches = g.resorts.filter(t.filter);
      if (matches.length >= 3) {
        out.push({
          hub: g, trait: t,
          resorts: matches.sort((a, b) => t.rank(b) - t.rank(a)),
          path: `/best/${g.regionSlug}/${t.slug}`,
        });
      }
    }
  }
  return out;
}

export function bestPage(rSlug, traitSlug) {
  return bestPages().find((b) => b.hub.regionSlug === rSlug && b.trait.slug === traitSlug) || null;
}

// ---------- records pages ----------
const METRICS = [
  { slug: 'biggest-vertical-drop', label: 'Biggest Vertical Drop', field: 'vertical_m',
    unit: 'ft', value: (r) => mToFt(r.vertical_m), metric: (r) => r.vertical_m },
  { slug: 'most-lifts', label: 'Most Lifts', field: 'lifts_total',
    unit: 'lifts', value: (r) => r.lifts_total, metric: (r) => r.lifts_total },
  { slug: 'most-runs', label: 'Most Runs', field: 'runs_total',
    unit: 'runs', value: (r) => r.runs_total, metric: (r) => r.runs_total },
  { slug: 'highest-summit', label: 'Highest Summit', field: 'summit_elev_m',
    unit: 'ft', value: (r) => mToFt(r.summit_elev_m), metric: (r) => r.summit_elev_m },
  { slug: 'most-expert-terrain', label: 'Most Expert Terrain', field: 'pct_expert',
    unit: '%', value: (r) => r.pct_expert, metric: (r) => r.pct_expert },
  { slug: 'most-beginner-terrain', label: 'Most Beginner Terrain', field: 'pct_beginner',
    unit: '%', value: (r) => r.pct_beginner, metric: (r) => r.pct_beginner },
];

export function recordScopes() {
  const scopes = [
    { slug: 'north-america', label: 'North America', filter: () => true },
    { slug: 'united-states', label: 'the United States', filter: (r) => r.country === 'United States' },
    { slug: 'canada', label: 'Canada', filter: (r) => r.country === 'Canada' },
  ];
  // Top 13 regions by qualifying-resort count → (13 + 3 scopes) × 6 metrics
  // = 96 records pages, inside the spec's ~50-100 budget. A raw >=10 floor
  // admits 30+ regions at full-data scale and triples the page count.
  for (const g of geoHubs().slice(0, 13)) {
    scopes.push({
      slug: g.regionSlug, label: g.region,
      filter: (r) => r.region === g.region && r.country === g.country,
      hub: g,
    });
  }
  return scopes;
}

export function recordsPages() {
  const out = [];
  for (const scope of recordScopes()) {
    for (const m of METRICS) {
      const ranked = qualifyingResorts()
        .filter(scope.filter)
        .filter((r) => m.metric(r) != null)
        .sort((a, b) => m.metric(b) - m.metric(a))
        .slice(0, 25);
      if (ranked.length >= 3) {
        out.push({
          slug: `${m.slug}-${scope.slug}`, metricDef: m, scope, resorts: ranked,
          path: `/records/${m.slug}-${scope.slug}`,
        });
      }
    }
  }
  return out;
}

export function recordsPage(slug) {
  return recordsPages().find((p) => p.slug === slug) || null;
}

// ---------- prominence (for homepage top-50 + link ordering) ----------
export function prominence(r) {
  return (r.lifts_total || 0) * 3 + (r.runs_total || 0) / 2 + (r.vertical_m || 0) / 10;
}

export function topResorts(n = 50) {
  return [...qualifyingResorts()].sort((a, b) => prominence(b) - prominence(a)).slice(0, n);
}

// ---------- distance (for "pass siblings nearby") ----------
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
