// The values in wrangler.jsonc that belong to one copy of the app (its Worker name and database),
// put into the published file when the copy is updated (scripts/update-from-upstream.mjs).

/** `theirs` (the published wrangler.jsonc) with the Worker name and database taken from `mine`. */
export function keepLocal(mine, theirs) {
  const first = (text, key) => new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1];
  let out = theirs;
  for (const key of ['name', 'database_name']) {
    const v = first(mine, key);
    if (v !== undefined) out = out.replace(new RegExp(`"${key}"(\\s*:\\s*)"[^"]*"`), `"${key}"$1"${v}"`);
  }
  const id = first(mine, 'database_id');
  if (id !== undefined) {
    if (first(out, 'database_id') !== undefined) out = out.replace(/"database_id"(\s*:\s*)"[^"]*"/, `"database_id"$1"${id}"`);
    else out = out.replace(/^(\s*)("database_name"\s*:\s*"[^"]*",?)/m, `$1$2\n$1"database_id": "${id}",`);
  }
  return out;
}

