import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript script helper
import { keepLocal } from '../scripts/lib/keep-local.mjs';

const published = `{
  "name": "language-tutor",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "language-tutor",
      "migrations_dir": "migrations"
    }
  ],
  "vars": { "APP_NAME": "Lexisaurus", "NEW": "1" }
}`;
const mine = `{
  "name": "my-tutor",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-tutor-db",
      "database_id": "abc-123",
      "migrations_dir": "migrations"
    }
  ],
  "vars": { "APP_NAME": "Lexisaurus" }
}`;

describe('keepLocal', () => {
  it("keeps the copy's Worker name and database, takes everything else from the release", () => {
    const out = keepLocal(mine, published) as string;
    expect(out).toContain('"name": "my-tutor"');
    expect(out).toContain('"database_name": "my-tutor-db"');
    expect(out).toContain('"database_id": "abc-123"');
    expect(out).toContain('"NEW": "1"');
    expect(JSON.parse(out).d1_databases[0]).toEqual({ binding: 'DB', database_name: 'my-tutor-db', database_id: 'abc-123', migrations_dir: 'migrations' });
  });
  it('replaces an id the release carries', () => {
    expect(keepLocal(mine, published.replace('"migrations_dir"', '"database_id": "zzz",\n      "migrations_dir"'))).toContain('"database_id": "abc-123"');
  });
});
