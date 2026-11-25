/**
 * Second daily capture pass (vercel.json, 14:00 UTC). It runs the same code as
 * /api/cron/capture: a keyword captured at 06:00 is not due again until the
 * next UTC day, so this only picks up keywords whose morning capture failed.
 */
export { GET } from "../capture/route";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
