import type { Metadata } from "next";
import { CircleCheck, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";
import { requireUser } from "@/lib/auth";
import { loadOwnKeysStatus } from "@/lib/own-keys";
import { OWN_KEYS_COST_PER_KEYWORD_USD, OWN_KEYS_LIMITS } from "@/lib/plans";
import { removeKeyAction } from "./actions";
import { AnthropicForm, DataForSeoForm } from "./key-forms";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const ownKeysCost = OWN_KEYS_COST_PER_KEYWORD_USD.toLocaleString("en-US", { style: "currency", currency: "USD" });

function SavedLine({ hint, checkedAt, which }: { hint: string | null; checkedAt: string | null; which: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-good-soft px-4 py-3 text-sm text-good">
      <p className="flex items-center gap-2">
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Saved{hint ? <span className="font-semibold"> {hint}</span> : null}
          {checkedAt ? (
            <>
              , checked <LocalTime iso={checkedAt} mode="date" />
            </>
          ) : null}
        </span>
      </p>
      <form action={removeKeyAction}>
        <input type="hidden" name="which" value={which} />
        <Button type="submit" variant="danger" size="xs">
          Remove
        </Button>
      </form>
    </div>
  );
}

/** Settings: the user's own API keys, which run keywords free. */
export default async function SettingsPage() {
  const user = await requireUser("/app/settings");
  const keys = await loadOwnKeysStatus(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Eyebrow>Settings</Eyebrow>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Your own API keys</h1>
        <p className="mt-2 text-ink-muted">
          Save a DataForSEO login and an Anthropic key and any keyword can run on them, free. DataForSEO and Anthropic
          bill you directly: about {ownKeysCost} per keyword at today&apos;s prices. You can run{" "}
          {OWN_KEYS_LIMITS.activeStudies} keywords at once and keep {OWN_KEYS_LIMITS.keepTracking} pages tracked.
        </p>
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden="true" />
          We check each key before saving it, store it encrypted, and never show it again.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-ink">DataForSEO</h2>
          {keys.dataforseo.saved ? <Chip tone="good">Saved</Chip> : <Chip>Not saved</Chip>}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Takes the daily Google samples. Use the API login and API password from{" "}
          <a
            href="https://app.dataforseo.com/api-access"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-strong"
          >
            your DataForSEO API Access page
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          , not your website password.
        </p>
        {keys.dataforseo.saved ? (
          <SavedLine hint={keys.dataforseo.hint} checkedAt={keys.dataforseo.checkedAt} which="dataforseo" />
        ) : null}
        <div className="mt-5">
          <DataForSeoForm saved={keys.dataforseo.saved} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-ink">Anthropic</h2>
          {keys.anthropic.saved ? <Chip tone="good">Saved</Chip> : <Chip>Not saved</Chip>}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Writes your reports and pages with Claude Opus 5.5. Create a key on{" "}
          <a
            href="https://platform.claude.com/settings/keys"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-strong"
          >
            the Claude Console API keys page
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          . The ready-to-publish page searches the web: if your organization turned web search off in the Console,
          that page can&apos;t be written.
        </p>
        {keys.anthropic.saved ? (
          <SavedLine
            hint={keys.anthropic.workspaceId ? `${keys.anthropic.hint} (workspace ${keys.anthropic.workspaceId})` : keys.anthropic.hint}
            checkedAt={keys.anthropic.checkedAt}
            which="anthropic"
          />
        ) : null}
        <div className="mt-5">
          <AnthropicForm saved={keys.anthropic.saved} />
        </div>
      </Card>

      <p className="text-sm text-ink-muted">
        Removing a key stops the keywords that run on it until you add one again. Keywords on a plan&apos;s credits
        don&apos;t use these keys.
      </p>
    </div>
  );
}
