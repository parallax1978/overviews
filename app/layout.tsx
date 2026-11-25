import type { Metadata } from "next";
import Script from "next/script";
import { CLICKY_NOSCRIPT_PATH, CLICKY_SCRIPT_PATH, CLICKY_SITE_ID } from "@/lib/clicky";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Legiit Overviews: track one AI Overview, then write the page that wins it",
    template: "%s · Legiit Overviews",
  },
  description:
    "Track a Google AI Overview for 7 days, see what Google keeps citing, and get a page written to beat it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-surface text-ink">
        {children}
        {/* Clicky analytics, loaded from our own domain (lib/clicky.ts). */}
        <Script async data-id={CLICKY_SITE_ID} src={CLICKY_SCRIPT_PATH} strategy="afterInteractive" />
        <noscript>
          <p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" width="1" height="1" src={CLICKY_NOSCRIPT_PATH} />
          </p>
        </noscript>
      </body>
    </html>
  );
}
