import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="site-shell" style={{ paddingTop: '20vh', paddingBottom: '20vh' }}>
      <p className="label">CORRIDRA</p>
      <h1>This page isn’t here.</h1>
      <p className="hero-description">
        The first corridor is taking shape. You can see what we’re building on the homepage.
      </p>
      <Link className="primary-link" href="/">
        Back to Corridra
      </Link>
    </main>
  );
}
