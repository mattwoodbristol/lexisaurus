// "Add to Home Screen" help for iPhone and iPad. iOS never offers to install a web app itself,
// and Web Push only works once the app has been opened from the Home Screen.
import { useState } from 'preact/hooks';

const DISMISSED = 'install.ios.dismissed';

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** True on an iPhone or iPad when the app is open in the browser rather than from the Home Screen. */
export function iosNeedsInstall(): boolean {
  return isIos() && !isStandalone();
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/** The iOS Share symbol: a box with an arrow out of the top. */
function ShareIcon() {
  return (
    <svg class="share-glyph" viewBox="0 0 20 24" width="14" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 15V2M5.5 6.5 10 2l4.5 4.5M7 10H3v12h14V10h-4" />
    </svg>
  );
}

export function IosInstallCard({ dismissible = true }: { dismissible?: boolean }) {
  const [hidden, setHidden] = useState(() => dismissible && readDismissed());
  if (!iosNeedsInstall() || hidden) return null;
  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* private mode: hide for this visit only */
    }
    setHidden(true);
  }
  return (
    <div class="card install-ios small">
      <strong>Put Lexisaurus on your Home Screen</strong>
      <ol>
        <li>
          Tap <ShareIcon /> Share (in Safari, at the bottom of the screen; in other browsers, in the address bar or menu).
        </li>
        <li>Choose “Add to Home Screen”, then “Add”.</li>
        <li>Open Lexisaurus from the Home Screen icon and sign in there.</li>
      </ol>
      <div class="muted">It then opens full screen like an app, and reminders can be switched on in Settings.</div>
      {dismissible && (
        <div class="row">
          <button class="secondary" onClick={dismiss}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
