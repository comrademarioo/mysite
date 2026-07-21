export const dynamic = 'force-static';
import { xmlIndex } from '../../lib/sitemaps.mjs';

export function GET() {
  return new Response(
    xmlIndex(['sitemap-resorts.xml', 'sitemap-vs.xml', 'sitemap-pass.xml', 'sitemap-geo.xml']),
    { headers: { 'Content-Type': 'application/xml' } },
  );
}
