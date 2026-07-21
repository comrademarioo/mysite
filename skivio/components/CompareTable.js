// Server component: side-by-side stats table with per-row winner highlight.
// Rendered fully at build time — this table must exist in the raw HTML.
import Link from 'next/link';
import { mToFt, fmt, displayName } from '../lib/data.mjs';

const ROWS = [
  { label: 'Vertical drop', get: (r) => r.vertical_m, show: (r) => `${fmt(mToFt(r.vertical_m))} ft (${fmt(r.vertical_m)} m)`, higherWins: true },
  { label: 'Summit elevation', get: (r) => r.summit_elev_m, show: (r) => `${fmt(mToFt(r.summit_elev_m))} ft`, higherWins: true },
  { label: 'Base elevation', get: (r) => r.base_elev_m, show: (r) => `${fmt(mToFt(r.base_elev_m))} ft`, higherWins: true },
  { label: 'Lifts', get: (r) => r.lifts_total, show: (r) => fmt(r.lifts_total), higherWins: true },
  { label: 'Runs', get: (r) => r.runs_total, show: (r) => fmt(r.runs_total), higherWins: true },
  { label: 'Beginner terrain', get: (r) => r.pct_beginner, show: (r) => r.pct_beginner == null ? '-' : `${r.pct_beginner}%`, higherWins: true },
  { label: 'Intermediate terrain', get: (r) => r.pct_intermediate, show: (r) => r.pct_intermediate == null ? '-' : `${r.pct_intermediate}%`, higherWins: true },
  { label: 'Expert terrain', get: (r) => r.pct_expert, show: (r) => r.pct_expert == null ? '-' : `${r.pct_expert}%`, higherWins: true },
  { label: 'Night skiing', get: (r) => (r.night_skiing == null ? null : r.night_skiing ? 1 : 0), show: (r) => (r.night_skiing == null ? '-' : r.night_skiing ? 'Yes' : 'No'), higherWins: true },
];

export default function CompareTable({ a, b, linkNames = false }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Stat</th>
          <th>{linkNames ? <Link href={`/resort/${a.slug}`}>{displayName(a)}</Link> : displayName(a)}</th>
          <th>{linkNames ? <Link href={`/resort/${b.slug}`}>{displayName(b)}</Link> : displayName(b)}</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => {
          const va = row.get(a), vb = row.get(b);
          const aWins = va != null && vb != null && va !== vb && (row.higherWins ? va > vb : va < vb);
          const bWins = va != null && vb != null && va !== vb && (row.higherWins ? vb > va : vb < va);
          return (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className={aWins ? 'win' : undefined}>{row.show(a)}</td>
              <td className={bWins ? 'win' : undefined}>{row.show(b)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
