"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { captureSnapshot } from "@/lib/capture";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_DAYS_TARGET, LANGUAGES, LOCATIONS, type Tracker } from "@/lib/types";
import { normalizeDomain } from "@/lib/utils";

/** What the form gets back when the keyword could not be created. On success the action redirects instead. */
export interface CreateTrackerState {
  error: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const formSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(2, "Type the search you want to win. At least 2 characters.")
    .max(200, "Keep the search under 200 characters."),
  location_code: z.coerce
    .number()
    .int()
    .refine((code) => LOCATIONS.some((l) => l.code === code), "Pick a country from the list."),
  language_code: z
    .string()
    .refine((code) => LANGUAGES.some((l) => l.code === code), "Pick a language from the list."),
  target_domain: z
    .string()
    .trim()
    .max(253, "That website address is too long.")
    .transform((value) => normalizeDomain(value))
    .refine(
      (domain) => domain === null || DOMAIN_PATTERN.test(domain),
      "Enter your website like example.com, or leave it blank.",
    ),
  user_edge: z
    .string()
    .trim()
    .max(2000, "Keep your edge under 2,000 characters.")
    .transform((value) => (value.length > 0 ? value : null)),
});

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Server action for useActionState: validates the form, inserts the tracker as the
 * signed-in user, captures day 1 right away, then redirects to the keyword page.
 */
export async function createTrackerAction(
  _prev: CreateTrackerState | null,
  formData: FormData,
): Promise<CreateTrackerState> {
  const user = await requireUser("/app/new");

  const parsed = formSchema.safeParse({
    keyword: field(formData, "keyword"),
    location_code: field(formData, "location_code"),
    language_code: field(formData, "language_code"),
    target_domain: field(formData, "target_domain"),
    user_edge: field(formData, "user_edge"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const input = parsed.data;
  const location = LOCATIONS.find((l) => l.code === input.location_code);
  if (!location) return { error: "Pick a country from the list." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trackers")
    .insert({
      user_id: user.id,
      keyword: input.keyword,
      location_code: location.code,
      location_name: location.name,
      language_code: input.language_code,
      device: "desktop",
      target_domain: input.target_domain,
      user_edge: input.user_edge,
      status: "tracking",
      days_target: DEFAULT_DAYS_TARGET,
      day_count: 0,
      next_capture_at: new Date(Date.now() + DAY_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("tracker insert failed", error?.message);
    return { error: "We could not save your keyword. Please try again." };
  }
  const trackerId = (data as Pick<Tracker, "id">).id;

  try {
    await captureSnapshot(trackerId, { dayNumber: 1 });
  } catch (err) {
    // captureSnapshot already set status "error" and last_error on the tracker;
    // the keyword page shows the problem and offers a retry.
    console.error("day-1 capture failed", trackerId, err instanceof Error ? err.message : err);
  }

  revalidatePath("/app");
  redirect(`/app/${trackerId}`);
}

/** Contract form for a plain `<form action={createTracker}>`: same behavior as createTrackerAction. */
export async function createTracker(formData: FormData): Promise<CreateTrackerState> {
  return createTrackerAction(null, formData);
}
