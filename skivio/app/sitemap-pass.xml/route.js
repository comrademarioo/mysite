export const dynamic = 'force-static';
import { urlsPass, xmlUrlset } from '../../lib/sitemaps.mjs';

export function GET() {
  return new Response(xmlUrlset(urlsPass()), {
    headers: { 'Content-Type': 'application/xml' },
  });
}
