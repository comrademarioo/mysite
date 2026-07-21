// Internal-link generator — hierarchical, NOT flat mesh. All links derive from
// data relationships; no hand-placed links anywhere.
import {
  db, vsPagesOf, vsPairs, distanceKm, prominence, geoHubs,
  countrySlug, regionSlug, resortQualifies,
} from './data.mjs';

// Resort page → ALL of its vs-pages (guarantees every vs URL is reachable at
// home → geo hub → resort → vs = 3 clicks), ordered by the partner's prominence.
export function resortVsLinks(r) {
  const { bySlug } = db();
  return vsPagesOf(r.slug)
    .map((p) => {
      const other = bySlug.get(p.a === r.slug ? p.b : p.a);
      return { key: p.key, other };
    })
    .sort((x, y) => prominence(y.other) - prominence(x.other));
}

// Resort page → pass siblings nearby (same pass, closest 5 by distance).
export function passSiblingsNearby(r, limit = 5) {
  const { passesOf, rosterOf, bySlug } = db();
  const mine = passesOf.get(r.slug) || [];
  const seen = new Set([r.slug]);
  const out = [];
  for (const m of mine) {
    for (const rm of rosterOf.get(m.pass) || []) {
      if (seen.has(rm.resort)) continue;
      const other = bySlug.get(rm.resort);
      if (!other || !resortQualifies(other)) continue;
      seen.add(rm.resort);
      out.push({ other, pass: m.pass, km: distanceKm(r, other) });
    }
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

// Resort page → nearby resorts by geodesic distance (any pass status).
// Symmetrized nearest-neighbor: r links its 5 nearest, PLUS any resort that
// counts r among its own 5 nearest. The reverse edges guarantee resorts in
// below-floor regions (no geo hub) still get an inbound link from a page
// that hangs off a hub or pass roster — no orphans.
let nnCache = null;
export function nearbyResorts(r, limit = 8) {
  if (!nnCache) {
    const all = db().resorts.filter(resortQualifies);
    const nearest = new Map(); // slug -> [slug x5]
    for (const a of all) {
      const ranked = all
        .filter((b) => b.slug !== a.slug)
        .map((b) => ({ b, km: distanceKm(a, b) }))
        .sort((x, y) => x.km - y.km)
        .slice(0, 5);
      nearest.set(a.slug, ranked);
    }
    nnCache = new Map(all.map((a) => [a.slug, new Map()]));
    for (const a of all) {
      for (const { b, km } of nearest.get(a.slug)) {
        nnCache.get(a.slug).set(b.slug, km); // forward edge
        nnCache.get(b.slug).set(a.slug, km); // reverse edge (symmetrize)
      }
    }
  }
  const { bySlug } = db();
  return [...(nnCache.get(r.slug) || new Map()).entries()]
    .sort((x, y) => x[1] - y[1])
    .slice(0, limit)
    .map(([slug, km]) => ({ other: bySlug.get(slug), km }));
}

// Resort page → its region hub (if the hub passed the floor).
export function regionHubOf(r) {
  if (!r.region) return null;
  return geoHubs().find((g) => g.country === r.country && g.region === r.region) || null;
}

// Vs page → 5–10 related vs-pages: pairs sharing a resort with this pair,
// ranked by combined prominence.
export function relatedVsLinks(a, b, limit = 8) {
  const { bySlug } = db();
  const key = [a.slug, b.slug].sort().join('-vs-');
  const candidates = [...vsPagesOf(a.slug), ...vsPagesOf(b.slug)]
    .filter((p) => p.key !== key);
  const uniq = new Map();
  for (const p of candidates) {
    if (!uniq.has(p.key)) {
      uniq.set(p.key, { key: p.key, ra: bySlug.get(p.a), rb: bySlug.get(p.b) });
    }
  }
  return [...uniq.values()]
    .sort((x, y) => prominence(y.ra) + prominence(y.rb) - prominence(x.ra) - prominence(x.rb))
    .slice(0, limit);
}

// Vs page swap-selector: for each side, alternate partners that form a real
// generated vs-page with the kept resort (client routes to the sibling URL).
export function swapOptions(keep, drop) {
  const { bySlug } = db();
  return vsPagesOf(keep.slug)
    .map((p) => bySlug.get(p.a === keep.slug ? p.b : p.a))
    .filter((o) => o.slug !== drop.slug)
    .sort((x, y) => prominence(y) - prominence(x))
    .map((o) => ({
      slug: o.slug, name: o.name, region: o.region,
      key: [keep.slug, o.slug].sort().join('-vs-'),
    }));
}

export const resortPath = (r) => `/resort/${r.slug}`;
export const vsPath = (key) => `/vs/${key}`;
export const passPath = (p) => `/pass/${p}`;
export const geoPath = (r) => `/${countrySlug(r.country)}/${regionSlug(r.region)}`;
