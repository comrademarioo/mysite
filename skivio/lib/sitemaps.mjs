// Segmented sitemaps — per-cluster indexation telemetry in GSC. Do not merge.
import {
  SITE, qualifyingResorts, vsPairs, geoHubs, bestPages, recordsPages, passRegions, db,
} from './data.mjs';

export function urlsResorts() {
  return qualifyingResorts().map((r) => `/resort/${r.slug}`);
}

export function urlsVs() {
  return vsPairs().map((p) => `/vs/${p.key}`);
}

export function urlsPass() {
  const out = ['/ski-pass-finder'];
  for (const p of db().passes) {
    out.push(`/pass/${p.slug}`);
    for (const g of passRegions(p.slug)) out.push(`/pass/${p.slug}/${g.regionSlug}`);
  }
  return out;
}

export function urlsGeo() {
  return [
    '/',
    ...geoHubs().map((g) => g.path),
    ...bestPages().map((b) => b.path),
    ...recordsPages().map((p) => p.path),
  ];
}

export function xmlUrlset(paths) {
  const body = paths
    .map((p) => `  <url><loc>${SITE}${p}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function xmlIndex(files) {
  const body = files
    .map((f) => `  <sitemap><loc>${SITE}/${f}</loc></sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}
