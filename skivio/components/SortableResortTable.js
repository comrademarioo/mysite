'use client';
// Geo hub table — sortable by stat (sort = HOW the same data displays: client state).
// Prerendered at build; full table exists in raw HTML.
import { useMemo, useState } from 'react';

export default function SortableResortTable({ rows }) {
  const [sort, setSort] = useState('verticalFt');
  const [dir, setDir] = useState(-1);

  const cols = [
    { key: 'name', label: 'Resort', num: false },
    { key: 'verticalFt', label: 'Vertical (ft)', num: true },
    { key: 'summitFt', label: 'Summit (ft)', num: true },
    { key: 'lifts', label: 'Lifts', num: true },
    { key: 'runs', label: 'Runs', num: true },
    { key: 'pctExpert', label: 'Expert %', num: true },
    { key: 'night', label: 'Night', num: false },
  ];

  const shown = useMemo(() => [...rows].sort((a, b) => {
    const va = a[sort], vb = b[sort];
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * ((va ?? -1) - (vb ?? -1));
  }), [rows, sort, dir]);

  const clickSort = (key) => {
    if (key === sort) setDir(-dir);
    else { setSort(key); setDir(key === 'name' ? 1 : -1); }
  };

  return (
    <table>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} className={c.num ? 'num' : undefined}
              style={{ cursor: 'pointer' }} onClick={() => clickSort(c.key)}>
              {c.label}{sort === c.key ? (dir === -1 ? ' ↓' : ' ↑') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.slug}>
            <td><a href={`/resort/${r.slug}`}>{r.name}</a></td>
            <td className="num">{r.verticalFt?.toLocaleString() ?? '-'}</td>
            <td className="num">{r.summitFt?.toLocaleString() ?? '-'}</td>
            <td className="num">{r.lifts ?? '-'}</td>
            <td className="num">{r.runs ?? '-'}</td>
            <td className="num">{r.pctExpert != null ? `${r.pctExpert}%` : '-'}</td>
            <td>{r.night}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
