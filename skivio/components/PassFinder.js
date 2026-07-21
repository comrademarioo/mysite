'use client';
// THE interactive tool. Multi-select resorts → passes ranked by coverage of
// the selection, limited-days flagged. Selection persists to localStorage.
// Hydrates on top of server-rendered page content.
import { useEffect, useMemo, useState } from 'react';

const LS_KEY = 'skivio:pass-finder:resorts';

export default function PassFinder({ resorts, passes, memberships }) {
  const [selected, setSelected] = useState([]);
  const [q, setQ] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Restore saved list after mount (SSR-safe).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      setSelected(saved.filter((s) => resorts.some((r) => r.slug === s)));
    } catch { /* ignore corrupt storage */ }
    setLoaded(true);
  }, [resorts]);

  useEffect(() => {
    if (loaded) localStorage.setItem(LS_KEY, JSON.stringify(selected));
  }, [selected, loaded]);

  const bySlug = useMemo(() => new Map(resorts.map((r) => [r.slug, r])), [resorts]);
  const coverage = useMemo(() => {
    // pass -> {covered:[{resort, access, days}], missing:[resort]}
    const memOf = new Map(); // resortSlug -> Map(pass -> m)
    for (const m of memberships) {
      if (!memOf.has(m.resort)) memOf.set(m.resort, new Map());
      memOf.get(m.resort).set(m.pass, m);
    }
    return passes
      .map((p) => {
        const covered = [], missing = [];
        for (const slug of selected) {
          const m = memOf.get(slug)?.get(p.slug);
          if (m) covered.push({ r: bySlug.get(slug), access: m.access, days: m.days_limit });
          else missing.push(bySlug.get(slug));
        }
        return { pass: p, covered, missing, limitedCount: covered.filter((c) => c.access === 'limited').length };
      })
      .sort((a, b) => b.covered.length - a.covered.length || a.limitedCount - b.limitedCount);
  }, [selected, passes, memberships, bySlug]);

  const matches = useMemo(() => {
    if (!q) return [];
    const needle = q.toLowerCase();
    return resorts
      .filter((r) => !selected.includes(r.slug) && `${r.name} ${r.region}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [q, resorts, selected]);

  return (
    <div>
      <div className="card">
        <label htmlFor="pf-search" style={{ fontWeight: 600 }}>Add the resorts you want to ski</label>
        <input
          id="pf-search" placeholder="Type a resort name… (e.g. Jackson Hole)"
          value={q} onChange={(e) => setQ(e.target.value)}
          style={{ display: 'block', width: '100%', padding: '10px 12px', margin: '8px 0', border: '1px solid #dbe4ec', borderRadius: 8 }}
        />
        {matches.length > 0 && (
          <div className="grid" style={{ marginTop: 4 }}>
            {matches.map((r) => (
              <a key={r.slug} href="#" onClick={(e) => { e.preventDefault(); setSelected([...selected, r.slug]); setQ(''); }}>
                + {r.name} <span className="small">{r.region}</span>
              </a>
            ))}
          </div>
        )}
        {selected.length > 0 && (
          <p style={{ marginTop: 8 }}>
            {selected.map((s) => (
              <span key={s} className="badge" style={{ marginBottom: 6 }}>
                {bySlug.get(s)?.name}{' '}
                <a href="#" aria-label={`Remove ${bySlug.get(s)?.name}`}
                  onClick={(e) => { e.preventDefault(); setSelected(selected.filter((x) => x !== s)); }}>✕</a>
              </span>
            ))}
            {' '}<a href="#" className="small" onClick={(e) => { e.preventDefault(); setSelected([]); }}>clear all</a>
          </p>
        )}
      </div>

      {selected.length === 0 ? (
        <p className="small">Your list is saved in your browser, so you can come back to it anytime.</p>
      ) : (
        <>
          <h2>Best pass for your {selected.length}-resort list</h2>
          {coverage.map(({ pass, covered, missing, limitedCount }) => (
            <div className="card" key={pass.slug}>
              <h3 style={{ marginTop: 0 }}>
                <a href={`/pass/${pass.slug}`}>{pass.name}</a>: covers {covered.length} of {selected.length}
                {limitedCount > 0 && <span className="badge limited" style={{ marginLeft: 8 }}>{limitedCount} limited-days</span>}
              </h3>
              {covered.length > 0 && (
                <p className="small">
                  {covered.map((c) => `${c.r.name} (${c.access === 'unlimited' ? 'unlimited' : `${c.days} days`})`).join(' · ')}
                </p>
              )}
              {missing.length > 0 && (
                <p className="small">Not covered: {missing.map((m) => m.name).join(', ')}</p>
              )}
            </div>
          ))}
          <p className="small">
            Tiers shown are the full ({passes[0]?.season}) version of each pass. Day limits and
            blackout rules vary by pass level, so double-check before you buy.
          </p>
        </>
      )}
    </div>
  );
}
