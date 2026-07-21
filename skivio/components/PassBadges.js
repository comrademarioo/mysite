import Link from 'next/link';
import { db } from '../lib/data.mjs';

// Pass coverage line for a resort: badges linking to pass hubs.
export default function PassBadges({ r }) {
  const { passesOf, passBySlug } = db();
  const memberships = passesOf.get(r.slug) || [];
  if (!memberships.length) {
    return <p className="small">Not on Epic, Ikon, Indy, or Mountain Collective. You'll need regular lift tickets here.</p>;
  }
  return (
    <p>
      {memberships.map((m) => (
        <Link key={m.pass} href={`/pass/${m.pass}`} style={{ textDecoration: 'none' }}>
          <span className={`badge ${m.access}`}>
            {passBySlug.get(m.pass).name}: {m.access === 'unlimited' ? 'unlimited' : `${m.days_limit} days`}
          </span>
        </Link>
      ))}
    </p>
  );
}
