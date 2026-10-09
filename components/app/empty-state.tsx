import { Plus, Sparkles } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumberBadge } from "@/components/ui/number-badge";

const STEPS = [
  "Pick a Google search that already shows an AI Overview.",
  "We capture that AI Overview three times a day for 7 days and show you what Google keeps citing.",
  "Then we write you a page built to get cited, and watch for your site to show up.",
];

/** Dashboard card shown before the user has added any keyword. */
export function EmptyState() {
  return (
    <Card className="mx-auto max-w-2xl text-center">
      <div className="py-4 sm:py-6">
        <span
          aria-hidden="true"
          className="brand-gradient mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-glow"
        >
          <Sparkles className="h-6 w-6" />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">
          Add the search you want to win
        </h2>
        <p className="mt-2 text-ink-muted">It takes about 20 seconds. Nothing to set up.</p>

        <ol className="mx-auto mt-6 max-w-md space-y-3 text-left text-sm text-ink-muted">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <NumberBadge>{index + 1}</NumberBadge>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>

        <LinkButton href="/app/new" size="lg" className="mt-8">
          <Plus className="h-5 w-5" aria-hidden="true" />
          Add your first keyword
        </LinkButton>
      </div>
    </Card>
  );
}
