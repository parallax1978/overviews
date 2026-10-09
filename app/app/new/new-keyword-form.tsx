"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LANGUAGES, LOCATIONS, SAMPLES_PER_DAY } from "@/lib/types";
import { createTrackerAction } from "./actions";

const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = "en";

const fieldClass =
  "w-full rounded-xl border border-line bg-white px-4 text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft";
const inputClass = `mt-1.5 h-12 ${fieldClass}`;
const textareaClass = `mt-1.5 min-h-28 py-3 ${fieldClass}`;
const labelClass = "block text-sm font-semibold text-ink";
const helpClass = "mt-1.5 text-sm text-ink-muted";

/** The "Add keyword" form. Submits to createTrackerAction, which captures day 1 and redirects to the keyword page. */
export function NewKeywordForm({ initialKeyword = "" }: { initialKeyword?: string }) {
  const [state, formAction, pending] = useActionState(createTrackerAction, null);

  return (
    <form action={formAction} className="space-y-6">
      <Card className="space-y-5">
        <div>
          <label htmlFor="keyword" className={labelClass}>
            The search
          </label>
          <input
            id="keyword"
            name="keyword"
            type="text"
            required
            minLength={2}
            maxLength={200}
            defaultValue={initialKeyword}
            placeholder="best project management software for small teams"
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="location_code" className={labelClass}>
              Country
            </label>
            <select
              id="location_code"
              name="location_code"
              defaultValue={DEFAULT_LOCATION_CODE}
              className={inputClass}
            >
              {LOCATIONS.map((location) => (
                <option key={location.code} value={location.code}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="language_code" className={labelClass}>
              Language
            </label>
            <select
              id="language_code"
              name="language_code"
              defaultValue={DEFAULT_LANGUAGE_CODE}
              className={inputClass}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="target_domain" className={labelClass}>
            Your website (optional)
          </label>
          <input
            id="target_domain"
            name="target_domain"
            type="text"
            inputMode="url"
            autoComplete="url"
            maxLength={253}
            placeholder="example.com"
            className={inputClass}
          />
          <p className={helpClass}>We tell you when your site gets cited.</p>
        </div>

        <div>
          <label htmlFor="user_edge" className={labelClass}>
            Your edge (optional)
          </label>
          <textarea
            id="user_edge"
            name="user_edge"
            maxLength={2000}
            placeholder="We have surveyed 1,200 customers about setup time. We have used every tool on this list."
            className={textareaClass}
          />
          <p className={helpClass}>
            What do you know, have, or can show that others can&apos;t? Original data, experience,
            your product. We use it when writing your page.
          </p>
        </div>

        <fieldset>
          <legend className={labelClass}>Name other brands in your page?</legend>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-faint">
              <input type="radio" name="competitor_policy" value="avoid" defaultChecked className="mt-1 accent-brand" />
              <span>
                <span className="font-medium text-ink">No</span>
                <span className="block text-ink-muted">
                  The page answers the question on its own terms and never recommends a competitor. Best when
                  you are the answer.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-faint">
              <input type="radio" name="competitor_policy" value="compare" className="mt-1 accent-brand" />
              <span>
                <span className="font-medium text-ink">Yes, as a fair comparison</span>
                <span className="block text-ink-muted">
                  The page may name and compare other brands honestly. Best for roundup or review pages.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </Card>

      {state?.error ? (
        <p role="alert" className="text-sm font-medium text-bad">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Taking today&apos;s {SAMPLES_PER_DAY} samples… up to a minute
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              Start tracking
            </>
          )}
        </Button>
        {pending ? null : (
          <p className="text-sm text-ink-muted">
            We capture today&apos;s AI Overview right away, then every day for 7 days. Google gives a
            different answer every time it is asked, so we take {SAMPLES_PER_DAY} samples a day and look
            for what stays the same.
          </p>
        )}
      </div>
    </form>
  );
}
