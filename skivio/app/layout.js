import Link from 'next/link';
import './globals.css';

export const metadata = {
  metadataBase: new URL('https://skivio.org'),
  title: { default: 'Skivio: Compare Ski Resorts and Find Your Pass', template: '%s | Skivio' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <nav className="container nav">
            <Link href="/" className="brand">skivio</Link>
            <div className="nav-links">
              <Link href="/ski-pass-finder">Pass Finder</Link>
              <Link href="/pass/epic">Epic</Link>
              <Link href="/pass/ikon">Ikon</Link>
              <Link href="/pass/indy">Indy</Link>
              <Link href="/pass/mountain-collective">Mtn Collective</Link>
            </div>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container">
            <p>
              Resort geometry and statistics © OpenStreetMap contributors, via{' '}
              <a href="https://openskimap.org" rel="noopener">OpenSkiMap</a>. Entity data from{' '}
              <a href="https://www.wikidata.org" rel="noopener">Wikidata</a> (CC0).
            </p>
            <p>
              Pass rosters are the 2026-27 season as published by each pass. Always confirm
              with the pass seller before buying. Skivio is not affiliated with any pass or resort.
            </p>
            <p>© {new Date().getFullYear()} skivio.org</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
