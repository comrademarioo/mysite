import Link from 'next/link';
import { db, passRegions, mToFt, fmt } from '../../../../lib/data.mjs';
import { pageMeta } from '../../../../lib/meta.mjs';

export const dynamicParams = false;

export function generateStaticParams() {
  // Floor: subset pages exist only with >= 3 qualifying resorts.
  const out = [];
  for (const p of db().passes) {
    for (const g of passRegions(p.slug)) {
      out.push({ pass: p.slug, region: g.regionSlug });
    }
  }
  return out;
}

function load(params) {
  const p = db().passBySlug.get(params.pass);
  const g = passRegions(p.slug).find((x) => x.regionSlug === params.region);
  return { p, g };
}

export function generateMetadata({ params }) {
  const { p, g } = load(params);
  return pageMeta({
    title: `${p.name} Resorts in ${g.region} (${p.season}): ${g.members.length} Mountains`,
    description: `Which ${g.region} resorts are on the ${p.name} for ${p.season}? ${g.members.map((m) => m.r.name).slice(0, 5).join(', ')}, with access tiers and stats.`,
    path: `/pass/${p.slug}/${g.regionSlug}`,
  });
}

export default function PassRegionPage({ params }) {
  const { p, g } = load(params);
  return (
    <>
      <nav className="breadcrumbs">
        <Link href="/">Home</Link> › <Link href={`/pass/${p.slug}`}>{p.name}</Link> › {g.region}
      </nav>
      <h1>{p.name} in {g.region} ({p.season})</h1>
      <p className="sub">{g.members.length} {g.region} resorts are on the {p.name} this season.</p>
      <table>
        <thead>
          <tr><th>Resort</th><th>Access</th><th className="num">Vertical</th><th className="num">Lifts</th><th className="num">Runs</th></tr>
        </thead>
        <tbody>
          {g.members.map((m) => (
            <tr key={m.r.slug}>
              <td><Link href={`/resort/${m.r.slug}`}>{m.r.name}</Link></td>
              <td><span className={`badge ${m.access}`}>{m.access === 'unlimited' ? 'Unlimited' : `${m.days_limit} days`}</span></td>
              <td className="num">{fmt(mToFt(m.r.vertical_m))} ft</td>
              <td className="num">{fmt(m.r.lifts_total)}</td>
              <td className="num">{fmt(m.r.runs_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><Link href={`/pass/${p.slug}`}>← Full {p.name} roster</Link> · <Link href="/ski-pass-finder">Pass finder</Link></p>
    </>
  );
}
