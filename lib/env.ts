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
};
