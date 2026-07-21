export const dynamic = 'force-static';
import { urlsGeo, xmlUrlset } from '../../lib/sitemaps.mjs';

export function GET() {
  return new Response(xmlUrlset(urlsGeo()), {
    headers: { 'Content-Type': 'application/xml' },
  });
}
