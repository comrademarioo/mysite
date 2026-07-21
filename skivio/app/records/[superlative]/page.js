import Link from 'next/link';
import { recordsPages, recordsPage, fmt } from '../../../lib/data.mjs';
import { pageMeta } from '../../../lib/meta.mjs';

export const dynamicParams = false;

export function generateStaticParams() {
  return recordsPages().map((p) => ({ superlative: p.slug }));
}

export function generateMetadata({ params }) {
  const p = recordsPage(params.superlative);
  const leader = p.resorts[0];
  return pageMeta({
    title: `${p.metricDef.label} in ${p.scope.label}: ${leader.name} Leads`,
    description: `${leader.name} tops ${p.scope.label} for ${p.metricDef.label.toLowerCase()} at ${fmt(p.metricDef.value(leader))} ${p.metricDef.unit}. See the full top ${p.resorts.length}.`,
    path: p.path,
  });
}

export default function RecordsPageView({ params }) {
  const p = recordsPage(params.superlative);
  // Records are natural hubs: they link downward to resort pages and sideways
  // to sibling records in the same scope.
  const siblings = recordsPages().filter((x) => x.scope.slug === p.scope.slug && x.slug !== p.slug);
  const otherScopes = recordsPages().filter((x) => x.metricDef.slug === p.metricDef.slug && x.slug !== p.slug).slice(0, 6);

  return (
    <>
      <nav className="breadcrumbs">
        <Link href="/">Home</Link>
        {p.scope.hub && <> › <Link href={p.scope.hub.path}>{p.scope.label}</Link></>} › {p.metricDef.label}
      </nav>
      <h1>{p.metricDef.label} in {p.scope.label}</h1>
      <p className="sub">
        Top {p.resorts.length} ranked by {p.metricDef.label.toLowerCase()}. {p.resorts[0].name} leads
        with {fmt(p.metricDef.value(p.resorts[0]))} {p.metricDef.unit}.
      </p>
      <table>
        <thead>
          <tr><th>#</th><th>Resort</th><th>Region</th><th className="num">{p.metricDef.label} ({p.metricDef.unit})</th></tr>
        </thead>
        <tbody>
          {p.resorts.map((r, i) => (
            <tr key={r.slug}>
              <td>{i + 1}</td>
              <td><Link href={`/resort/${r.slug}`}>{r.name}</Link></td>
              <td>{r.region}, {r.country === 'United States' ? 'US' : 'CA'}</td>
              <td className="num">{fmt(p.metricDef.value(r))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>More {p.scope.label} records</h2>
      <div className="grid">
        {siblings.map((s) => (
          <Link key={s.path} href={s.path}>{s.metricDef.label} in {s.scope.label}</Link>
        ))}
      </div>
      {otherScopes.length > 0 && (
        <>
          <h2>{p.metricDef.label} elsewhere</h2>
          <div className="grid">
            {otherScopes.map((s) => (
              <Link key={s.path} href={s.path}>{s.metricDef.label} in {s.scope.label}</Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
