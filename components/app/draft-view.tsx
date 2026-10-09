"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Download, LoaderCircle, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Panel } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Markdown } from "@/components/ui/markdown";
import type { Draft } from "@/lib/types";

export interface DraftViewProps {
  trackerId: string;
  /** Used for the download file name. */
  keyword: string;
  draft: Draft | null;
  /** True once the report exists, so a new draft can be written. */
  canRegenerate: boolean;
}

const PLACEHOLDER_RE = /\[ADD YOUR DATA:([^\]]*)\]/g;
const NOTES_MAX = 2000;

/** Draft tab: the written page with copy, download and "regenerate with notes". */
export function DraftView({ trackerId, keyword, draft, canRegenerate }: DraftViewProps) {
  if (!draft) {
    return (
      <Card>
        <Eyebrow>Draft</Eyebrow>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-ink">
          Your page is written together with the report
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          As soon as the report is done, the finished page shows up here, ready to copy.
        </p>
      </Card>
    );
  }

  const content = draft.content_md ?? "";
  const placeholderCount = countPlaceholders(content);
  const fullDocument = buildDocument(draft);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={fullDocument} label="Copy the whole page" size="sm" />
        <Button size="sm" variant="secondary" onClick={() => downloadMarkdown(fullDocument, `${slugify(keyword)}.md`)}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download .md
        </Button>
        {canRegenerate ? <RegenerateForm trackerId={trackerId} /> : null}
      </div>

      <Panel className="divide-y divide-line">
        <MetaRow label="Title" value={draft.title} />
        <MetaRow label="Meta description" value={draft.meta_description} />
        <MetaRow label="H1" value={draft.h1} />
      </Panel>

      {placeholderCount > 0 ? (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <span className="font-semibold">
            {placeholderCount} {placeholderCount === 1 ? "note" : "notes"} to fill in.
          </span>{" "}
          Bold <span className="font-semibold">[ADD YOUR DATA: …]</span> notes mark where your own data or
          experience goes. Replace each one before you publish.
        </p>
      ) : null}

      <Card>
        <Markdown>{highlightPlaceholders(content)}</Markdown>
      </Card>

      {draft.why_better_md ? (
        <section>
          <Eyebrow>Why it should win</Eyebrow>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">Why this beats the current sources</h2>
          <Card className="mt-4">
            <Markdown>{draft.why_better_md}</Markdown>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RegenerateForm({ trackerId }: { trackerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/trackers/${trackerId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setOpen(false);
      setNotes("");
      router.refresh();
    } catch {
      setError("We lost the connection. Refresh the page to see whether a new draft arrived.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={open}>
        <PenLine className="h-4 w-4" aria-hidden="true" />
        Regenerate
      </Button>
      {open ? (
        <Panel className="mt-1 basis-full p-4">
          <label htmlFor="draft-notes" className="block text-sm font-semibold text-ink">
            Tell us what to change
          </label>
          <p className="mt-1 text-xs text-ink-muted">
            For example: &ldquo;shorter intro&rdquo;, &ldquo;add a pricing table&rdquo;, &ldquo;mention our free
            plan&rdquo;. Leave it blank for a fresh take.
          </p>
          <textarea
            id="draft-notes"
            value={notes}
            maxLength={NOTES_MAX}
            rows={3}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-3 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-brand focus:ring-2 focus:ring-brand-soft disabled:opacity-60"
            placeholder="What should be different this time?"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={submit} disabled={pending} aria-busy={pending}>
              {pending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <PenLine className="h-4 w-4" aria-hidden="true" />
              )}
              {pending ? "Writing…" : "Write a new draft"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            {pending ? <span className="text-xs text-ink-muted">This takes a minute or two.</span> : null}
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-bad">
              {error}
            </p>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-soft">{label}</p>
        <p className="mt-0.5 text-sm text-ink">{value || <span className="text-ink-soft">Not set</span>}</p>
      </div>
      {value ? <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} size="xs" iconOnly /> : null}
    </div>
  );
}

function CopyButton({
  text,
  label,
  size,
  iconOnly = false,
}: {
  text: string;
  label: string;
  size: "xs" | "sm";
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (http, permissions): nothing to do but leave the text selectable.
    }
  }

  const icon = copied ? (
    <Check className="h-4 w-4 text-good" aria-hidden="true" />
  ) : (
    <Copy className="h-4 w-4" aria-hidden="true" />
  );

  return (
    <Button size={size} variant={iconOnly ? "ghost" : "secondary"} onClick={copy} aria-label={label} title={label}>
      {icon}
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------

/** Markdown document the user takes away: title line, meta description line, then the page body. */
function buildDocument(draft: Draft): string {
  const lines = [
    `Title: ${draft.title ?? ""}`,
    `Meta description: ${draft.meta_description ?? ""}`,
    "",
    draft.content_md ?? "",
  ];
  return lines.join("\n").trimEnd() + "\n";
}

function countPlaceholders(content: string): number {
  return (content.match(PLACEHOLDER_RE) ?? []).length;
}

/** Wraps every [ADD YOUR DATA: ...] note in bold so it stands out in the rendered page. */
function highlightPlaceholders(content: string): string {
  return content.replace(PLACEHOLDER_RE, (match, _inner: string, offset: number, whole: string) =>
    whole.slice(Math.max(0, offset - 2), offset) === "**" ? match : `**${match}**`,
  );
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "draft";
}

function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON.
  }
  return "Something went wrong writing your draft. Please try again.";
}
