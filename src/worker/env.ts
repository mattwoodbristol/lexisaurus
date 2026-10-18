export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  // Secrets (wrangler secret put / .dev.vars). Only PASSPHRASE and ANTHROPIC_API_KEY are needed:
  // the session and VAPID keys are generated and kept in D1 unless set here (see keys.ts).
  PASSPHRASE: string;
  SESSION_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
