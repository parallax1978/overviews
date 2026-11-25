/**
 * Central place for environment variables. Server-only values throw at first
 * use when missing so a misconfigured deploy fails loudly instead of silently
 * returning empty data.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Safe to use in client components. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

/** Server only. Never import from a client component. */
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get dataforseoLogin() {
    return required("DATAFORSEO_LOGIN");
  },
  get dataforseoPassword() {
    return required("DATAFORSEO_PASSWORD");
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  /** Optional. Required by user-scoped Anthropic keys (sk-ant-usr-...), ignored by workspace keys. */
  get anthropicWorkspaceId() {
    return process.env.ANTHROPIC_WORKSPACE_ID || null;
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /** Stripe secret key (sk_live_... or sk_test_...). Null until payments are set up. */
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY || null;
  },
  /** Signing secret of the Stripe webhook endpoint (whsec_...). */
  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET || null;
  },
  /** 32-byte key, base64, that encrypts users' own API keys at rest. */
  get ownKeysEncryptionKey() {
    return required("OWN_KEYS_ENCRYPTION_KEY");
  },
  /** GetResponse API key. Null turns adding new users to the mailing list off. */
  get getresponseApiKey() {
    return process.env.GETRESPONSE_API_KEY || null;
  },
  /** The GetResponse list (campaign id) new users join. */
  get getresponseListId() {
    return process.env.GETRESPONSE_LIST_ID || null;
  },
  /** Optional GetResponse tag id marking contacts that came from this app. */
  get getresponseTagId() {
    return process.env.GETRESPONSE_TAG_ID || null;
  },
  /** Safety ceiling on the app's own API spend per UTC day; new reports pause above it. */
  get platformDailyLimitUsd() {
    const value = Number(process.env.PLATFORM_DAILY_LIMIT_USD);
    return Number.isFinite(value) && value > 0 ? value : 75;
  },
};
