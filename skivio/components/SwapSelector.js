'use client';
// Swap-selector: changing WHICH entities are compared = client-side routing to
// a different pre-rendered vs-page (per interactivity spec).
import { useRouter } from 'next/navigation';

export default function SwapSelector({ label, current, options }) {
  const router = useRouter();
  return (
    <label style={{ fontSize: '0.9rem' }}>
      {label}{' '}
      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) router.push(`/vs/${e.target.value}`); }}
        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #dbe4ec', maxWidth: 260 }}
      >
        <option value="" disabled>swap {current}…</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.name} ({o.region})</option>
        ))}
      </select>
    </label>
  );
}
