// An app left open on a phone keeps running the version it was opened with, while the server
// moves on with each deploy; new answers then reach an old screen. When the app comes back into
// view, check whether a new version is out (the page names its script by content hash) and
// reload into it.
const SCRIPT = /\/assets\/index-[\w-]+\.js/;

function running(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? (SCRIPT.exec(s.src)?.[0] ?? null) : null;
}

async function latest(): Promise<string | null> {
  try {
    const res = await fetch(`/?fresh=${Date.now()}`, { cache: 'no-store' }); // ?fresh: past the service worker's cache
    return res.ok ? (SCRIPT.exec(await res.text())?.[0] ?? null) : null;
  } catch {
    return null; // offline: carry on with this version
  }
}

export function reloadWhenUpdated(): void {
  const mine = running();
  if (!mine) return; // the dev server, which has no hashed script
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    const now = await latest();
    checking = false;
    if (now && now !== mine) location.reload();
  };
  document.addEventListener('visibilitychange', check);
  setInterval(check, 30 * 60 * 1000);
}
