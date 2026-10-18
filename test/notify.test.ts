import { describe, it, expect } from 'vitest';
import { localParts, startOfLocalDay, tzOffsetMinutes, parseHHMM, isValidTz } from '../src/core/time';
import { dueSlot, inQuietHours, composeReminder, sessionDone, type SessionState } from '../src/core/notify/schedule';
import { importVapidPrivateKey, vapidJwt, vapidAuthorization, b64urlDecode, b64urlEncode, generateVapidKeys } from '../src/core/push/vapid';

const LON = 'Europe/London';

describe('local time', () => {
  it('uses BST in summer and GMT in winter', () => {
    expect(localParts(new Date('2026-07-01T06:30:00Z'), LON)).toEqual({ date: '2026-07-01', minutes: 7 * 60 + 30, hhmm: '07:30' });
    expect(localParts(new Date('2026-12-01T07:30:00Z'), LON).hhmm).toBe('07:30');
    expect(tzOffsetMinutes(new Date('2026-07-01T12:00:00Z'), LON)).toBe(60);
    expect(tzOffsetMinutes(new Date('2026-12-01T12:00:00Z'), LON)).toBe(0);
  });

  it('finds local midnight in UTC, including just after midnight in summer', () => {
    expect(startOfLocalDay(new Date('2026-10-04T18:00:00Z'), LON).toISOString()).toBe('2026-10-03T23:00:00.000Z');
    // 23:30 UTC on 4 Oct is 00:30 BST on 5 Oct: the local day is the 5th.
    expect(startOfLocalDay(new Date('2026-10-04T23:30:00Z'), LON).toISOString()).toBe('2026-10-04T23:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-12-01T10:00:00Z'), LON).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('parses HH:MM and validates zones', () => {
    expect(parseHHMM('07:30')).toBe(450);
    expect(parseHHMM('7:05')).toBe(425);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM(730)).toBeNull();
    expect(isValidTz(LON)).toBe(true);
    expect(isValidTz('Mars/Olympus')).toBe(false);
  });
});

describe('reminder schedule', () => {
  const quiet = { start: '22:00', end: '07:00' };
  const base = { times: ['07:30', '19:30'], quiet, sentToday: [] as string[], sessionDone: false };
  const at = (hhmm: string) => parseHHMM(hhmm)!;

  it('quiet hours wrap past midnight', () => {
    expect(inQuietHours(at('23:00'), quiet)).toBe(true);
    expect(inQuietHours(at('06:59'), quiet)).toBe(true);
    expect(inQuietHours(at('07:00'), quiet)).toBe(false);
    expect(inQuietHours(at('12:00'), { start: '12:00', end: '14:00' })).toBe(true);
    expect(inQuietHours(at('12:00'), null)).toBe(false);
  });

  it('sends a slot once it is reached, and not before', () => {
    expect(dueSlot({ ...base, nowMinutes: at('07:15') })).toBeNull();
    expect(dueSlot({ ...base, nowMinutes: at('07:30') })).toBe('07:30');
    expect(dueSlot({ ...base, nowMinutes: at('07:44') })).toBe('07:30');
  });

  it('never sends the same slot twice in a day', () => {
    expect(dueSlot({ ...base, nowMinutes: at('07:45'), sentToday: ['07:30'] })).toBeNull();
  });

  it('catches up after a missed tick, but gives up after two hours', () => {
    expect(dueSlot({ ...base, nowMinutes: at('09:29') })).toBe('07:30');
    expect(dueSlot({ ...base, nowMinutes: at('09:30') })).toBeNull();
  });

  it('respects quiet hours and a finished session', () => {
    expect(dueSlot({ ...base, times: ['22:30'], nowMinutes: at('22:30') })).toBeNull();
    expect(dueSlot({ ...base, nowMinutes: at('19:30'), sessionDone: true })).toBeNull();
  });

  it('ignores malformed times', () => {
    expect(dueSlot({ ...base, times: ['soon', 99, '19:30'], nowMinutes: at('19:31') })).toBe('19:30');
    expect(dueSlot({ ...base, times: 'not-an-array', nowMinutes: at('19:31') })).toBeNull();
  });

  it('a 15-minute cron over a whole day sends exactly the configured slots', () => {
    const sent: string[] = [];
    for (let m = 0; m < 24 * 60; m += 15) {
      const s = dueSlot({ ...base, nowMinutes: m, sentToday: sent });
      if (s) sent.push(s);
    }
    expect(sent).toEqual(['07:30', '19:30']);
  });

  const state: SessionState = {
    langName: '中文',
    reviews: { remaining: 12, done: false },
    grammar: { title: '比', done: false },
    conversation: { topic: '音乐', done: false },
  };
  it('composes a reminder listing only what is left', () => {
    expect(composeReminder(state, '07:30')).toEqual({ title: "中文 · today's practice", body: '12 reviews · grammar: 比 · chat: 音乐' });
    const evening = composeReminder({ ...state, reviews: { remaining: 0, done: true }, grammar: { title: '比', done: true } }, '19:30');
    expect(evening).toEqual({ title: '中文 · still to do today', body: 'chat: 音乐' });
  });
  it('session is done only when all three parts are done', () => {
    expect(sessionDone(state)).toBe(false);
    expect(sessionDone({ ...state, reviews: { remaining: 0, done: true }, grammar: null, conversation: { topic: null, done: true } })).toBe(true);
  });
  it('counts the lesson and listening steps in order, when there are any', () => {
    const rest = { ...state, reviews: { remaining: 0, done: true }, grammar: null, conversation: { topic: null, done: true } };
    const todo = { ...rest, lesson: { title: 'Il periodo ipotetico', done: false }, listening: { done: false } };
    expect(sessionDone(todo)).toBe(false);
    expect(composeReminder(todo, '07:30').body).toBe('lesson: Il periodo ipotetico · listening');
    expect(sessionDone({ ...todo, lesson: null, listening: { done: true } })).toBe(true);
  });
});

describe('VAPID', () => {
  it('produces a JWT the public key verifies, with the right claims', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = b64urlEncode((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    const d = ((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey).d!;
    const key = await importVapidPrivateKey(pub, d);
    const now = Date.UTC(2026, 9, 4, 12);
    const jwt = await vapidJwt('https://fcm.googleapis.com/fcm/send/abc:123', key, 'https://example.workers.dev', now);
    const [h, b, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(b)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://example.workers.dev' });
    expect(b64urlDecode(s).length).toBe(64); // raw r||s
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${b}`));
    expect(ok).toBe(true);
    expect(vapidAuthorization(jwt, pub)).toBe(`vapid t=${jwt}, k=${pub}`);
  });

  it('generates a key pair that signs JWTs', async () => {
    const { publicKey, privateKey } = await generateVapidKeys();
    expect(b64urlDecode(publicKey).length).toBe(65);
    const key = await importVapidPrivateKey(publicKey, privateKey);
    expect((await vapidJwt('https://web.push.apple.com/abc', key, 'https://example.workers.dev')).split('.')).toHaveLength(3);
  });

  it('rejects a malformed public key', async () => {
    await expect(importVapidPrivateKey(b64urlEncode(new Uint8Array(33)), 'x')).rejects.toThrow(/65-byte/);
  });
});
