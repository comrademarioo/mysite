import Link from 'next/link';
import { db, vsPairs, vsByKey, mToFt, fmt, SEASON } from '../../../lib/data.mjs';
import { vsMeta } from '../../../lib/meta.mjs';
import { relatedVsLinks, swapOptions, regionHubOf } from '../../../lib/links.mjs';
import CompareTable from '../../../components/CompareTable';
import SwapSelector from '../../../components/SwapSelector';
import StayBlock from '../../../components/StayBlock';

export const dynamicParams = false;

export function generateStaticParams() {
  // Floor: both resorts data_score >= 4; same region OR same pass; slugs
  // alphabetical in the canonical URL (reverse order is never generated).
  return vsPairs().map((p) => ({ pair: p.key }));
}

export function generateMetadata({ params }) {
  const p = vsByKey(params.pair);
  const { bySlug } = db();
  return vsMeta(bySlug.get(p.a), bySlug.get(p.b), p.key);
}

function passCoverageLines(slug) {
  const { passesOf, passBySlug } = db();
  return (passesOf.get(slug) || []).map((m) => ({
    pass: passBySlug.get(m.pass),
    text: m.access === 'unlimited' ? 'unlimited days' : `${m.days_limit} days`,
    access: m.access,
  }));
}

export default function VsPage({ params }) {
  const { bySlug } = db();
  const p = vsByKey(params.pair);
  const a = bySlug.get(p.a);
  const b = bySlug.get(p.b);
  const related = relatedVsLinks(a, b);
  const covA = passCoverageLines(a.slug);
  const covB = passCoverageLines(b.slug);
  const shared = covA.filter((x) => covB.some((y) => y.pass.slug === x.pass.slug));
  const hubA = regionHubOf(a);

  // Computed verdict sentence — template strings from data only.
  const verdictBits = [];
  if (a.vertical_m && b.vertical_m && a.vertical_m !== b.vertical_m) {
    const [hi, lo] = a.vertical_m > b.vertical_m ? [a, b] : [b, a];
    verdictBits.push(`${hi.name} has the bigger vertical (${fmt(mToFt(hi.vertical_m))} ft vs ${fmt(mToFt(lo.vertical_m))} ft)`);
  }
  if (a.runs_total && b.runs_total && a.runs_total !== b.runs_total) {
    const [hi, lo] = a.runs_total > b.runs_total ? [a, b] : [b, a];
    verdictBits.push(`${hi.name} has more runs (${hi.runs_total} vs ${lo.runs_total})`);
  }
  if (a.pct_expert != null && b.pct_expert != null && a.pct_expert !== b.pct_expert) {
    const hi = a.pct_expert > b.pct_expert ? a : b;
    verdictBits.push(`${hi.name} skews more expert (${hi.pct_expert}% expert terrain)`);
  }

  return (
    <>
      <nav className="breadcrumbs">
        <Link href="/">Home</Link>
        {hubA && <> › <Link href={hubA.path}>{a.region}</Link></>} › {a.name} vs {b.name}
      </nav>
      <h1>{a.name} vs {b.name}</h1>
      <p className="sub">
        {a.name} ({a.region}) and {b.name} ({b.region}) head-to-head: stats, terrain, and {SEASON()} pass coverage.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        <SwapSelector label="Compare" current={a.name} options={swapOptions(b, a)} />
        <SwapSelector label="against" current={b.name} options={swapOptions(a, b)} />
      </div>

      <CompareTable a={a} b={b} linkNames />

      {verdictBits.length > 0 && <p>{verdictBits.join('; ')}.</p>}

      <h2>Which pass covers them?</h2>
      <table>
        <thead><tr><th>Resort</th><th>Pass coverage ({SEASON()})</th></tr></thead>
        <tbody>
          <tr>
            <td><Link href={`/resort/${a.slug}`}>{a.name}</Link></td>
            <td>{covA.length ? covA.map((c) => (
              <span key={c.pass.slug} className={`badge ${c.access}`}>
                <Link href={`/pass/${c.pass.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>{c.pass.name}: {c.text}</Link>
              </span>
            )) : 'No major pass — independent tickets'}</td>
          </tr>
          <tr>
            <td><Link href={`/resort/${b.slug}`}>{b.name}</Link></td>
            <td>{covB.length ? covB.map((c) => (
              <span key={c.pass.slug} className={`badge ${c.access}`}>
                <Link href={`/pass/${c.pass.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>{c.pass.name}: {c.text}</Link>
              </span>
            )) : 'No major pass — independent tickets'}</td>
          </tr>
        </tbody>
      </table>
      <p>
        {shared.length
          ? `One pass covers both: ${shared.map((s) => s.pass.name).join(' and ')}.`
          : 'No single pass covers both — skiing both means separate passes or lift tickets.'}{' '}
        <Link href="/ski-pass-finder">Check your full resort list in the pass finder →</Link>
      </p>

      <StayBlock r={a} />

      {related.length > 0 && (
        <>
          <h2>Related comparisons</h2>
          <div className="grid">
            {related.map((v) => (
              <Link key={v.key} href={`/vs/${v.key}`}>{v.ra.name} vs {v.rb.name}</Link>
            ))}
          </div>
        </>
      )}

      <p>
        Deep dives: <Link href={`/resort/${a.slug}`}>{a.name} stats</Link> ·{' '}
        <Link href={`/resort/${b.slug}`}>{b.name} stats</Link>
      </p>
    </>
  );
}
