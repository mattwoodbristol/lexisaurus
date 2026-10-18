import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { Env } from './env';
import { appKeys } from './keys';
import { passphraseMatches, signSession, verifySession, SESSION_TTL_SECONDS } from '../core/auth';

export const SESSION_COOKIE = 'lt_session';

/** False when the passphrase is missing, too short, or still the example from .dev.vars.example. */
export function passphraseIsSet(p: string | undefined): boolean {
  return !!p && p.length >= 12 && !p.startsWith('choose-a-passphrase');
}

function cookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'Lax' as const, path: '/', maxAge: SESSION_TTL_SECONDS };
}

/** Rejects requests without a valid session cookie. */
export const requireSession: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ok = await verifySession((await appKeys(c.env)).sessionSecret, getCookie(c, SESSION_COOKIE));
  if (!ok) return c.json({ error: 'unauthenticated' }, 401);
  await next();
};

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/login', async (c) => {
  let body: { passphrase?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
  if (!passphraseIsSet(c.env.PASSPHRASE)) {
    return c.json({ error: 'No passphrase is set yet. In the Cloudflare dashboard open this Worker, Settings → Variables and Secrets, and set PASSPHRASE (12 or more characters).' }, 503);
  }
  if (!(await passphraseMatches(passphrase, c.env.PASSPHRASE))) {
    // Small fixed delay blunts online guessing on a single-user app.
    await new Promise((r) => setTimeout(r, 500));
    return c.json({ error: 'wrong passphrase' }, 401);
  }
  const token = await signSession((await appKeys(c.env)).sessionSecret);
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, cookieOptions(secure));
  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const ok = await verifySession((await appKeys(c.env)).sessionSecret, getCookie(c, SESSION_COOKIE));
  return c.json({ authenticated: ok });
});
