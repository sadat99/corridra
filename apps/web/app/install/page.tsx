import Link from 'next/link';
import { PublicShell } from '../../components/public-shell';
import { InstallApp } from '../../components/ux/install-app';
import '../../components/page-compact.css';
import '../../components/public-page.css';
import './install.css';

/**
 * How to install Corridra, for the people who want it. Corridra is a website first: everything works in a
 * browser and installing is never required. This page is the quiet place the Help sheet points to, instead
 * of a banner or a dialog on pages people came to for something else.
 *
 * The steps are written out for each platform because browsers differ: Chrome and Edge can offer a real
 * install button, which the component above shows only when the browser has offered it; Safari on iPhone
 * and iPad has no such event at all and is done by hand through Add to Home Screen.
 */
export const metadata = {
  title: 'Install Corridra | Corridra',
  description:
    'Install Corridra as an app on Android, iPhone, iPad or a computer. The website keeps working either way.',
};

const steps = [
  {
    title: 'Android (Chrome)',
    lines: [
      'Open Corridra in Chrome.',
      'Open the browser menu, then choose Install app or Add to Home screen.',
      'Confirm. Corridra appears with your other apps.',
    ],
  },
  {
    title: 'iPhone and iPad (Safari)',
    lines: [
      'Open Corridra in Safari. Other browsers on iPhone and iPad cannot add it.',
      'Tap the Share button, then Add to Home Screen.',
      'Tap Add. Corridra appears on your Home Screen.',
    ],
  },
  {
    title: 'Computer (Chrome or Edge)',
    lines: [
      'Open Corridra in Chrome or Edge.',
      'Use the install icon at the end of the address bar, or the browser menu.',
      'Confirm. Corridra opens in its own window.',
    ],
  },
];

export default function Page() {
  return (
    <PublicShell>
      <section className="guide-page-hero guide-page-hero--compact">
        <div>
          <p className="label">Install</p>
          <h1>Install Corridra as an app.</h1>
          <p className="guide-lead">
            It opens in its own window with the Corridra icon. The website keeps working just as it
            does now. You never need to install it.
          </p>
          <InstallApp />
        </div>
      </section>
      <section aria-label="How to install">
        <div className="ux-install-steps">
          {steps.map((step) => (
            <details key={step.title} className="ux-install-step">
              <summary>{step.title}</summary>
              <h3 className="ux-install-title">{step.title}</h3>
              <ol>
                {step.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      </section>
      <section className="guide-page-hero guide-page-hero--compact">
        <div>
          <p>
            The installed app works the same as the website. Signing in and your work do not change.
            With no connection it says so and waits. It keeps no copy of your work on the device.
          </p>
          <div className="guide-page-actions">
            <Link prefetch={false} className="button-secondary" href="/how-it-works">
              See How It Works
            </Link>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
