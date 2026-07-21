export const dynamic = 'force-static';
import { urlsResorts, xmlUrlset } from '../../lib/sitemaps.mjs';

export function GET() {
  return new Response(xmlUrlset(urlsResorts()), {
    headers: { 'Content-Type': 'application/xml' },
  });
}
