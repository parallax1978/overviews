import Link from "next/link";

/** An error a keyword route answered with, and where the user can fix it. */
export interface ApiError {
  message: string;
  /** A plan or more credits fixes it: link to Billing. */
  upgrade: boolean;
  /** Saving the user's own keys fixes it: link to Settings. */
  settings: boolean;
}

/** Reads `{ error, upgrade?, settings? }` from a failed response; `fallback` when the body isn't that. */
export async function readApiError(response: Response, fallback: string): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: unknown; upgrade?: unknown; settings?: unknown };
    if (typeof body.error === "string" && body.error) {
      return { message: body.error, upgrade: body.upgrade === true, settings: body.settings === true };
    }
  } catch {
    // Not JSON (e.g. a gateway timeout page).
  }
  return { message: fallback, upgrade: false, settings: false };
}

/** The message plus the link that fixes it, if any. Render inside an element with role="alert". */
export function ApiErrorText({ error }: { error: ApiError }) {
  return (
    <>
      {error.message}
      {error.upgrade ? (
        <>
          {" "}
          <Link href="/app/billing" className="font-semibold underline underline-offset-2">
            See plans and credits
          </Link>
        </>
      ) : null}
      {error.settings ? (
        <>
          {" "}
          <Link href="/app/settings" className="font-semibold underline underline-offset-2">
            Open Settings
          </Link>
        </>
      ) : null}
    </>
  );
}
