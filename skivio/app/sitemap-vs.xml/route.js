export const dynamic = 'force-static';
import { urlsVs, xmlUrlset } from '../../lib/sitemaps.mjs';

export function GET() {
  return new Response(xmlUrlset(urlsVs()), {
    headers: { 'Content-Type': 'application/xml' },
  });
}
