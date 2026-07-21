// Computed titles/descriptions/JSON-LD. Unique per page, from data only.
import { SITE, SEASON, mToFt, fmt, displayName } from './data.mjs';

export function pageMeta({ title, description, path }) {
  return {
    title,
    description,
    alternates: { canonical: `${SITE}${path}` }, // self-referencing canonical
    openGraph: { title, description, url: `${SITE}${path}`, siteName: 'Skivio' },
  };
}

export function resortMeta(r) {
  const bits = [];
  if (r.vertical_m) bits.push(`${fmt(mToFt(r.vertical_m))} ft vertical`);
  if (r.lifts_total) bits.push(`${r.lifts_total} lifts`);
  if (r.runs_total) bits.push(`${r.runs_total} runs`);
  return pageMeta({
    title: `${displayName(r)} Ski Resort: Stats, Terrain, and Pass Coverage`,
    description: `${r.name} (${r.region}, ${r.country}): ${bits.join(', ')}. Terrain split, elevation, ${SEASON()} pass coverage, and head-to-head comparisons.`,
    path: `/resort/${r.slug}`,
  });
}

export function vsMeta(a, b, key) {
  return pageMeta({
    title: `${displayName(a)} vs ${displayName(b)}: Stats, Terrain, and Which Pass Covers Them`,
    description: `${displayName(a)} or ${displayName(b)}? Compare vertical, lifts, runs, terrain split, and ${SEASON()} pass coverage side by side.`,
    path: `/vs/${key}`,
  });
}

// SkiResort structured data (schema.org) for resort pages.
export function skiResortJsonLd(r) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SkiResort',
    name: r.name,
    url: `${SITE}/resort/${r.slug}`,
    address: { '@type': 'PostalAddress', addressRegion: r.region, addressCountry: r.country },
    geo: { '@type': 'GeoCoordinates', latitude: r.lat, longitude: r.lng },
  };
}
