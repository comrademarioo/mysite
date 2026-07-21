'use client';
// Filter/sort of the SAME data = pure client state (per interactivity spec).
// This component is prerendered at build time, so the full roster table is
// present in the raw HTML; hydration only adds the controls' behavior.
import { useMemo, useState } from 'react';

export default function RosterTable({ rows }) {
  // rows: {slug, name, region, country, access, days_limit, verticalFt, lifts, runs}
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('all');
  const [sort, setSort] = useState('name');

  const shown = useMemo(() => {
    let out = rows.filter((r) =>
      (tier === 'all' || r.access === tier) &&
      (!q || `${r.name} ${r.region}`.toLowerCase().includes(q.toLowerCase())),
    );
    const cmp = {
      name: (x, y) => x.name.localeCompare(y.name),
      vertical: (x, y) => (y.verticalFt || 0) - (x.verticalFt || 0),
      lifts: (x, y) => (y.lifts || 0) - (x.lifts || 0),
      runs: (x, y) => (y.runs || 0) - (x.runs || 0),
    }[sort];
    return [...out].sort(cmp);
  }, [rows, q, tier, sort]);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
        <input
          placeholder="Filter by name or region…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #dbe4ec', borderRadius: 6, minWidth: 220 }}
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ padding: '7px 8px', border: '1px solid #dbe4ec', borderRadius: 6 }}>
          <option value="all">All access tiers</option>
          <option value="unlimited">Unlimited only</option>
          <option value="limited">Limited days only</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ padding: '7px 8px', border: '1px solid #dbe4ec', borderRadius: 6 }}>
          <option value="name">Sort: A–Z</option>
          <option value="vertical">Sort: vertical</option>
          <option value="lifts">Sort: lifts</option>
          <option value="runs">Sort: runs</option>
        </select>
      </div>
      <table>
        <thead>
          <tr><th>Resort</th><th>Region</th><th>Access</th><th className="num">Vertical</th><th className="num">Lifts</th><th className="num">Runs</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.slug}>
              <td><a href={`/resort/${r.slug}`}>{r.name}</a></td>
              <td>{r.region}, {r.country === 'United States' ? 'US' : 'CA'}</td>
              <td>
                <span className={`badge ${r.access}`}>
                  {r.access === 'unlimited' ? 'Unlimited' : `${r.days_limit} days`}
                </span>
              </td>
              <td className="num">{r.verticalFt ? `${r.verticalFt.toLocaleString()} ft` : '—'}</td>
              <td className="num">{r.lifts ?? '—'}</td>
              <td className="num">{r.runs ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">{shown.length} of {rows.length} resorts shown</p>
    </>
  );
}
