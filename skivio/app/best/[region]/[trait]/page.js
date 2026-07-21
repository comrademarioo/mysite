import Link from 'next/link';
import { bestPages, bestPage, mToFt, fmt, SEASON } from '../../../../lib/data.mjs';
import { pageMeta } from '../../../../lib/meta.mjs';
import PassBadges from '../../../../components/PassBadges';

export const dynamicParams = false;

export function generateStaticParams() {
  return bestPages().map((b) => ({ region: b.hub.regionSlug, trait: b.trait.slug }));
}

export function generateMetadata({ params }) {
  const b = bestPage(params.region, params.trait);
  const top3 = b.resorts.slice(0, 3).map((r) => r.name);
  return pageMeta({
    title: `Best ${b.hub.region} Ski Resorts for ${b.trait.label} (${SEASON()})`,
    description: `${b.hub.region} ranked by ${b.trait.noun}: ${top3.join(', ')} lead ${b.resorts.length} qualifying resorts. Computed from terrain and stats data, not opinions.`,
    path: b.path,
  });
}

export default function BestPage({ params }) {
  const b = bestPage(params.region, params.trait);
  return (
    <>
      <nav className="breadcrumbs">
        <Link href="/">Home</Link> › <Link href={b.hub.path}>{b.hub.region}</Link> › Best for {b.trait.label}
      </nav>
      <h1>Best {b.hub.region} Ski Resorts for {b.trait.label}</h1>
      <p className="sub">
        {b.resorts.length} {b.hub.region} resorts qualify, ranked by {b.trait.noun} — computed
        from the terrain and stats data, re-generated when the data changes.
      </p>

      {b.resorts.map((r, i) => (
        <div className="card" key={r.slug}>
          <h3 style={{ marginTop: 0 }}>
            {i + 1}. <Link href={`/resort/${r.slug}`}>{r.name}</Link>
          </h3>
          <p>{b.trait.line(r)}. Summit {fmt(mToFt(r.summit_elev_m))} ft, {fmt(r.lifts_total)} lifts.</p>
          <PassBadges r={r} />
        </div>
      ))}

      <p><Link href={b.hub.path}>← All {b.hub.region} ski resorts</Link></p>
    </>
  );
}
