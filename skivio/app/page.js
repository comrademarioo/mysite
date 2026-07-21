import Link from 'next/link';
import { db, geoHubs, topResorts, SEASON } from '../lib/data.mjs';
import { pageMeta } from '../lib/meta.mjs';

export const metadata = pageMeta({
  title: 'Skivio: Compare Ski Resorts and Find the Right Ski Pass',
  description: `Side-by-side ski resort comparisons, ${SEASON()} Epic/Ikon/Indy/Mountain Collective rosters, and a pass finder that tells you which pass covers your resort list.`,
  path: '/',
});

// Homepage links: pass finder, 4 pass hubs, geo hubs, top ~50 resort pages.
// Nothing else (per linking spec).
export default function Home() {
  const { passes } = db();
  const hubs = geoHubs();
  const top = topResorts(50);
  return (
    <>
      <h1>Compare ski resorts. Pick the right pass.</h1>
      <p className="sub">
        Skivio pulls open data on hundreds of ski resorts so you can compare vertical, lifts,
        runs, terrain, and {SEASON()} pass coverage before you commit to a trip or a pass.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Which pass covers your resorts?</h2>
        <p>Pick the mountains you want to ski this season and see which pass covers the most of them, day limits included.</p>
        <p><Link className="btn" href="/ski-pass-finder">Open the ski pass finder</Link></p>
      </div>

      <h2>Pass rosters ({SEASON()})</h2>
      <div className="grid">
        {passes.map((p) => (
          <Link key={p.slug} href={`/pass/${p.slug}`}>
            {p.name} resort list <span className="small">{p.season}</span>
          </Link>
        ))}
      </div>

      <h2>Browse by region</h2>
      <div className="grid">
        {hubs.map((g) => (
          <Link key={g.path} href={g.path}>
            {g.region} <span className="small">{g.resorts.length} resorts · {g.country}</span>
          </Link>
        ))}
      </div>

      <h2>Popular resorts</h2>
      <ul className="linklist">
        {top.map((r) => (
          <li key={r.slug}><Link href={`/resort/${r.slug}`}>{r.name}</Link> <span className="small">{r.region}</span></li>
        ))}
      </ul>
    </>
  );
}
