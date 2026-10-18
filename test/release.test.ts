import { describe, expect, it } from 'vitest';
import { isNewer, nextRelease } from '../src/core/release';

describe('releases', () => {
  it('compares dated releases', () => {
    expect(isNewer('2026.10.18', '2026.10.19')).toBe(true);
    expect(isNewer('2026.10.18', '2026.10.18.2')).toBe(true);
    expect(isNewer('2026.10.18.2', '2026.10.18')).toBe(false);
    expect(isNewer('2026.10.18', '2026.10.18')).toBe(false);
    expect(isNewer('2026.09.30', '2026.10.01')).toBe(true);
    expect(isNewer('dev', '2026.10.18')).toBe(false);
  });
  it('names the next release', () => {
    expect(nextRelease('dev', '2026-10-18')).toBe('2026.10.18');
    expect(nextRelease('2026.10.17', '2026-10-18')).toBe('2026.10.18');
    expect(nextRelease('2026.10.18', '2026-10-18')).toBe('2026.10.18.2');
    expect(nextRelease('2026.10.18.2', '2026-10-18')).toBe('2026.10.18.3');
  });
});
