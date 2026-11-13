/**
 * What an installed Corridra shows when the browser could not reach the network. The service worker holds
 * this one public page and nothing else, so it can say plainly what happened without keeping any copy of
 * the product. It shows no account, no workspace, no saved state and no figure: there is nothing here that
 * could be out of date, and it never claims that work was saved.
 */
export const metadata = {
  title: 'No connection | Corridra',
  robots: { index: false, follow: false },
};

export default function Offline() {
  return (
    <main id="main" lang="en" dir="ltr" tabIndex={-1} className="ux-public ux-offline">
      <section className="guide-page-hero guide-lost">
        <div>
          <p className="label">No connection</p>
          <h1>Corridra cannot connect right now.</h1>
          <p className="guide-lead">
            Reconnect to continue. Any work you had not confirmed as saved may need checking once
            you are back.
          </p>
          <div className="guide-page-actions">
            {/* An empty address is this same address: the page is shown in place of the one the person
                asked for, so trying again asks for that page, not the home page. A plain link, so it
                works with no script, which is the state the page is usually shown in. */}
            <a className="primary-link" href="">
              Try Again
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
