// Lodging affiliate block. Plain deep links until affiliate IDs are configured
// (set NEXT_PUBLIC_BOOKING_AID / NEXT_PUBLIC_EXPEDIA_AFFCID at build time once
// the programs approve the live site).
const AID = process.env.NEXT_PUBLIC_BOOKING_AID || '';

export default function StayBlock({ r }) {
  const q = encodeURIComponent(`${r.name}, ${r.region}`);
  const url = `https://www.booking.com/searchresults.html?ss=${q}${AID ? `&aid=${AID}` : ''}`;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Stay near {r.name}</h3>
      <p className="small">
        Lodging near the base fills up first during peak weeks.{' '}
        <a href={url} rel="nofollow sponsored noopener" target="_blank">
          Search stays near {r.name}
        </a>
      </p>
    </div>
  );
}
