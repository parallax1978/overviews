import type { Metadata } from "next";
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
      <body className="flex min-h-full flex-col bg-surface text-ink">{children}</body>
    </html>
  );
}
