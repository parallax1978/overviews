# Supabase auth setup (email code, no password)

Legiit Overviews signs people in with a 6-digit code emailed by Supabase, with a clickable link
in the same email as a fallback. There are no passwords. This page lists the exact dashboard
settings the app needs. Budget 10 minutes.

The app code involved:

- `app/login/login-form.tsx` calls `signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } })`
  and then `verifyOtp({ email, token, type: "email" })` for the code.
- `app/auth/confirm/route.ts` handles the link: `GET /auth/confirm?token_hash=...&type=email&next=/app`
  calls `verifyOtp({ token_hash, type })` on the server and sets the session cookie.
- `proxy.ts` refreshes the session on every request and sends signed-out visitors from `/app/*` to `/login`.

## 1. Enable the Email provider

Dashboard: **Authentication -> Sign In / Providers -> Email**.

1. Turn **Enable Email provider** on.
2. Turn **Confirm email** off.
3. Leave **Secure email change** on (default) and **Secure password change** off (we have no passwords).
4. Save.

Why "Confirm email" is off: that setting is a double opt-in for password sign-ups. It sends a
"Confirm signup" email first and only creates a usable account after the user clicks it. With a
one-time code the user already proves they own the inbox by typing the code, so a second
confirmation step adds nothing. Turning it off also means **every** email the app sends uses the
single "Magic Link" template below, for new and returning users alike. (If you leave it on, a
brand-new user gets the "Confirm signup" template instead, so you would have to edit both
templates the same way.)

## 2. Set the Site URL and Redirect URLs

Dashboard: **Authentication -> URL Configuration**.

1. **Site URL**: your production URL, for example `https://overviews.legiit.com`. No trailing slash.
   This is what `{{ .SiteURL }}` expands to in the email template.
2. **Redirect URLs**: add both of these, one per line:

   ```
   http://localhost:3000/auth/confirm
   https://<your-production-domain>/auth/confirm
   ```

   If you use Vercel preview deployments, also add a wildcard such as
   `https://*-<team>.vercel.app/auth/confirm`.

The login form passes `emailRedirectTo = <current origin>/auth/confirm?next=...`. Supabase refuses
any `emailRedirectTo` that is not on this list, so a missing entry shows up as a sign-in error.

## 3. Edit the "Magic Link" email template

Dashboard: **Authentication -> Emails -> Templates -> Magic Link**.

Replace the body with something like this (keep the two template tags exactly as written):

```html
<h2>Your sign-in code</h2>

<p>Enter this code on the sign-in page:</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">{{ .Token }}</p>

<p>Or click this link to sign in on this device:</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app">
    Sign in to Legiit Overviews
  </a>
</p>

<p>This code and link expire in one hour. If you did not request them, you can ignore this email.</p>
```

What the tags do:

- `{{ .Token }}` is the 6-digit code. The login page verifies it with `verifyOtp({ email, token, type: "email" })`.
- `{{ .TokenHash }}` is a hashed one-time token for the link. Our route calls
  `verifyOtp({ token_hash, type: "email" })` on the server. Using `type=email` works for both new
  and returning users, so one template covers both.
- `next=/app` is where the user lands after the link signs them in. It must be a path on this site.

Optional: to keep the keyword a visitor typed on the landing page when they click the link (not
just when they type the code), use the redirect URL the app sends instead of the Site URL:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in to Legiit Overviews</a>
```

`{{ .RedirectTo }}` is the `emailRedirectTo` value from the login form, which already contains
`?next=...`, so the extra parameters are joined with `&`. This also makes local links point at
`localhost` instead of production. Only use this variant if every URL you sign in from is on the
Redirect URLs list.

### Why not the default `{{ .ConfirmationURL }}`

The default template links to Supabase's own `/auth/v1/verify` endpoint. That endpoint verifies
the token and then redirects to your site with the session in the URL **hash fragment**
(`#access_token=...`). Only browser JavaScript can read a hash fragment; the server never sees it.
With `@supabase/ssr`, the session lives in cookies that the server reads, so a hash-fragment session
leaves every server-rendered page (and `proxy.ts`) thinking the visitor is signed out. Putting
`token_hash` in the link and exchanging it in `app/auth/confirm/route.ts` sets the cookie on the
server, which is what the rest of the app expects.

## 4. Expiry and rate limits

Dashboard: **Authentication -> Sign In / Providers -> Email** and **Authentication -> Rate Limits**.

- **Email OTP expiration** defaults to 3600 seconds (1 hour). Keep it at or below one hour; the
  dashboard warns above that. The login page copy says "Codes expire after one hour", so update
  the copy in `app/login/page.tsx` if you change this.
- A user can request a new code at most **once every 60 seconds**. The "Resend code" button shows
  Supabase's own message ("you can only request this after N seconds") when they are too fast.
- Supabase's built-in email service is limited to a few emails per hour per project (currently
  **2 per hour** by default) and is meant for development only. Before launch, set up **custom
  SMTP** (Authentication -> Emails -> SMTP Settings) with a provider such as Resend, Postmark, or
  SES, then raise the email rate limit under Authentication -> Rate Limits.
- Verifying codes is also rate limited (the "token verifications" limit). The defaults are fine.

## 5. Environment variables

In Vercel (and `.env.local` for development):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable or anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only, never exposed to the browser
NEXT_PUBLIC_APP_URL=https://<your-production-domain>
```

## 6. Check it works

1. Run the app and open `/login`.
2. Enter your email and click **Send me a code**. One email arrives with a code and a link.
3. Type the code and click **Sign in**. You land on `/app`.
4. Sign out from the app header. Request a new code, and this time click the **link** instead.
   You should land on `/app` signed in. If you land on `/login` with "That link has expired",
   the template is still using `{{ .ConfirmationURL }}` or the Redirect URL is not on the list.
5. Visit `/app` in a private window. You should be sent to `/login?next=/app`.
