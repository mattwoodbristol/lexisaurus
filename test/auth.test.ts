import { describe, it, expect } from 'vitest';
import { signSession, verifySession, passphraseMatches, constantTimeEqual } from '../src/core/auth';

const SECRET = 'test-secret-please-rotate';

describe('session tokens', () => {
  it('round-trips a freshly signed token', async () => {
    const t = await signSession(SECRET);
    expect(await verifySession(SECRET, t)).toBe(true);
  });

  it('rejects a token signed with another secret', async () => {
    const t = await signSession('other');
    expect(await verifySession(SECRET, t)).toBe(false);
  });

  it('rejects a tampered expiry', async () => {
    const t = await signSession(SECRET);
    const [exp, sig] = t.split('.');
    expect(await verifySession(SECRET, `${Number(exp) + 86400}.${sig}`)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const now = Date.now();
    const t = await signSession(SECRET, now, 60);
    expect(await verifySession(SECRET, t, now + 61_000)).toBe(false);
    expect(await verifySession(SECRET, t, now + 59_000)).toBe(true);
  });

  it('rejects garbage and empties', async () => {
    const bad: (string | undefined)[] = [undefined, '', '.', 'abc', '123.', '.sig', 'x.y', '1e3.sig'];
    for (const b of bad) expect(await verifySession(SECRET, b)).toBe(false);
    expect(await verifySession('', await signSession(SECRET))).toBe(false);
  });
});

describe('passphrase', () => {
  it('matches only the exact passphrase', async () => {
    expect(await passphraseMatches('correct horse', 'correct horse')).toBe(true);
    expect(await passphraseMatches('correct horse ', 'correct horse')).toBe(false);
    expect(await passphraseMatches('', 'correct horse')).toBe(false);
    expect(await passphraseMatches('anything', '')).toBe(false);
  });

  it('constantTimeEqual handles length mismatch', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  });
});
