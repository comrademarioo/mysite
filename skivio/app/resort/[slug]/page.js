import Link from 'next/link';
import { db, qualifyingResorts, mToFt, fmt, SEASON, displayName } from '../../../lib/data.mjs';
import { resortMeta, skiResortJsonLd } from '../../../lib/meta.mjs';
import { resortVsLinks, passSiblingsNearby, nearbyResorts, regionHubOf } from '../../../lib/links.mjs';
import TerrainBar from '../../../components/TerrainBar';
import CompareTable from '../../../components/CompareTable';
import PassBadges from '../../../components/PassBadges';
import StayBlock from '../../../components/StayBlock';

export const dynamicParams = false;

export function generateStaticParams() {
  // Floor: resort page exists only if data_score >= 3.
  return qualifyingResorts().map((r) => ({ slug: r.slug }));
}

export function generateMetadata({ params }) {
  return resortMeta(db().bySlug.get(params.slug));
}

export default function ResortPage({ params }) {
  const r = db().bySlug.get(params.slug);
  const hub = regionHubOf(r);
  const vsLinks = resortVsLinks(r);
  const siblings = passSiblingsNearby(r);
  const nearby = nearbyResorts(r);
  // Embedded mini-compare: most prominent comparison partner, rendered inline.
  const mini = vsLinks[0];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(skiResortJsonLd(r)) }}
      />
      <nav className="breadcrumbs">
        <Link href="/">Home</Link>
        {hub && <> › <Link href={hub.path}>{r.region}</Link></>} › {r.name}
      </nav>
      <h1>{r.name}</h1>
      <p className="sub">{r.region}, {r.country}</p>

      <PassBadges r={r} />

      <div className="stat-row">
        <div className="stat"><div className="v">{fmt(mToFt(r.vertical_m))} ft</div><div className="k">Vertical drop</div></div>
        <div className="stat"><div className="v">{fmt(mToFt(r.summit_elev_m))} ft</div><div className="k">Summit</div></div>
        <div className="stat"><div className="v">{fmt(mToFt(r.base_elev_m))} ft</div><div className="k">Base</div></div>
        <div className="stat"><div className="v">{fmt(r.lifts_total)}</div><div className="k">Lifts</div></div>
        <div className="stat"><div className="v">{fmt(r.runs_total)}</div><div className="k">Runs</div></div>
        <div className="stat"><div className="v">{r.night_skiing == null ? '-' : r.night_skiing ? 'Yes' : 'No'}</div><div className="k">Night skiing</div></div>
      </div>

      <h2>Terrain</h2>
      <TerrainBar r={r} />

      {mini && (
        <>
          <h2>{r.name} vs {displayName(mini.other)}</h2>
          <CompareTable a={r} b={mini.other} linkNames />
          <p><Link href={`/vs/${mini.key}`}>Full {r.name} vs {displayName(mini.other)} comparison →</Link></p>
        </>
      )}

      <StayBlock r={r} />

      {siblings.length > 0 && (
        <>
          <h2>Same pass, nearby</h2>
          <div className="grid">
            {siblings.map((s) => (
              <Link key={s.other.slug} href={`/resort/${s.other.slug}`}>
                {s.other.name} <span className="small">{Math.round(s.km)} km · shared pass</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {nearby.length > 0 && (
        <>
          <h2>Nearby resorts</h2>
          <div className="grid">
            {nearby.map((n) => (
              <Link key={n.other.slug} href={`/resort/${n.other.slug}`}>
                {n.other.name} <span className="small">{Math.round(n.km)} km · {n.other.region}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {vsLinks.length > 0 && (
        <>
          <h2>All {r.name} comparisons</h2>
          <ul className="linklist">
            {vsLinks.map((v) => (
              <li key={v.key}>
                <Link href={`/vs/${v.key}`}>{r.name} vs {displayName(v.other)}</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {hub && <p><Link href={hub.path}>← All {r.region} ski resorts</Link></p>}
      <p className="small">Pass coverage shown is for the {SEASON()} season. Stats come from OpenStreetMap data and resort-published figures.</p>
    </>
  );
}
