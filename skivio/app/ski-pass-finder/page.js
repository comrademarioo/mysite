import Link from 'next/link';
import { db, qualifyingResorts, SEASON } from '../../lib/data.mjs';
import { pageMeta } from '../../lib/meta.mjs';
import PassFinder from '../../components/PassFinder';

export const metadata = pageMeta({
  title: `Ski Pass Finder ${'2026–27'}: Which Pass Covers Your Resorts?`,
  description: 'Select the resorts you want to ski; get Epic, Ikon, Indy, and Mountain Collective ranked by how much of your list each covers, with limited-day access flagged.',
  path: '/ski-pass-finder',
});

export default function PassFinderPage() {
  const snap = db();
  const resorts = qualifyingResorts().map((r) => ({ slug: r.slug, name: r.name, region: r.region }));
  const passes = snap.passes;
  const memberships = [];
  for (const [slug, ms] of snap.passesOf) {
    for (const m of ms) memberships.push({ resort: slug, pass: m.pass, access: m.access, days_limit: m.days_limit });
  }

  return (
    <>
      <nav className="breadcrumbs"><Link href="/">Home</Link> › Pass Finder</nav>
      <h1>Ski Pass Finder — {SEASON()}</h1>
      <p className="sub">
        Pick your season's mountains; the finder ranks Epic, Ikon, Indy Pass, and Mountain
        Collective by how many of them each pass actually covers, and flags limited-day access.
      </p>
      <PassFinder resorts={resorts} passes={passes} memberships={memberships} />
      <h2>How it works</h2>
      <p>
        Coverage is computed from each pass's published {SEASON()} roster ({resorts.length} North
        American resorts tracked). "Unlimited" means no day cap on the full pass; "limited" shows
        the day allotment. The finder doesn't model pricing — it answers the coverage question first.
      </p>
      <p>
        Browse rosters directly: {passes.map((p, i) => (
          <span key={p.slug}>{i > 0 && ' · '}<Link href={`/pass/${p.slug}`}>{p.name}</Link></span>
        ))}
      </p>
    </>
  );
}
