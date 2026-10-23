"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Check, Copy, Download, ExternalLink, LoaderCircle, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Panel } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Markdown } from "@/components/ui/markdown";
import { DraftAutoStart, DraftPendingCard } from "@/components/app/draft-auto-start";
import type { Draft, DraftMode, DraftSource } from "@/lib/types";
import { cn, domainFromUrl } from "@/lib/utils";

/** The newest draft of each version for the current report; null when that version was never written. */
export type DraftVersions = Record<DraftMode, Draft | null>;

export interface DraftViewProps {
  trackerId: string;
  /** Used for the download file name. */
  keyword: string;
  drafts: DraftVersions;
  /** True once the report exists, so a version can be written or rewritten. */
  canRegenerate: boolean;
  /**
   * The id of the finished report whose ready-to-publish version is missing: that
   * pane then writes it by itself instead of offering a button. Null when nothing
   * should start on its own.
   */
  autoStart?: string | null;
  /** The server says the ready-to-publish version is being written right now (by the cron or another tab). */
  writing?: boolean;
}

const MODES: DraftMode[] = ["researched", "placeholders"];

const MODE_LABEL: Record<DraftMode, string> = {
  researched: "Ready to publish",
  placeholders: "With my own data",
};

/** One sentence under the switch that explains the selected version. */
const MODE_HELP: Record<DraftMode, string> = {
  researched: "Every number comes from a source we found, cited in the page. Copy it and publish.",
  placeholders:
    "Bold [ADD YOUR DATA: …] notes mark where your own data or experience goes. Fill them in before you publish.",
};

/** How long writing each version takes, shown next to the pending states. */
const MODE_DURATION: Record<DraftMode, string> = {
  researched: "Three to six minutes.",
  placeholders: "A minute or two.",
};

/** Suffix on the downloaded file so the two versions do not overwrite each other. */
const FILE_SUFFIX: Record<DraftMode, string> = {
  researched: "ready",
  placeholders: "with-your-data",
};

const PLACEHOLDER_RE = /\[ADD YOUR DATA:([^\]]*)\]/g;
const NOTES_MAX = 2000;

/**
 * Draft tab: a switch between the two versions of the written page, then the
 * selected one with copy, download and "regenerate with notes", or a card that
 * writes it when that version does not exist yet (by itself for the
 * ready-to-publish version when `autoStart` names the report). Both versions
 * arrive from the server, so switching is instant.
 */
export function DraftView({
  trackerId,
  keyword,
  drafts,
  canRegenerate,
  autoStart = null,
  writing = false,
}: DraftViewProps) {
  const [mode, setMode] = useState<DraftMode>(() => defaultMode(drafts));
  const writer = useDraftWriter(trackerId);
  const draft = drafts[mode];

  if (!drafts.researched && !drafts.placeholders && !canRegenerate) {
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

  return (
    <div className="space-y-5">
      <div>
        <ModeSwitch mode={mode} onChange={setMode} writing={writer.writing} />
        <p className="mt-3 text-sm text-ink-muted">{MODE_HELP[mode]}</p>
      </div>

      {draft ? (
        <DraftBody draft={draft} mode={mode} keyword={keyword} writer={writer} canRegenerate={canRegenerate} />
      ) : mode === "researched" && writing ? (
        <DraftPendingCard />
      ) : mode === "researched" && autoStart ? (
        <DraftAutoStart trackerId={trackerId} analysisId={autoStart} />
      ) : (
        <MissingVersion mode={mode} writer={writer} canRegenerate={canRegenerate} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Writing a version

interface DraftWriter {
  /** The version being written right now, or null. */
  writing: DraftMode | null;
  error: { mode: DraftMode; message: string } | null;
  clearError: () => void;
  /** Asks the server for a new draft of `mode`; resolves true once it was written and the page refreshed. */
  write: (mode: DraftMode, notes?: string) => Promise<boolean>;
}

/**
 * One in-flight request for the whole tab, so a version that is being written
 * keeps its pending state while the user looks at the other one, and the page
 * still refreshes when it lands.
 */
function useDraftWriter(trackerId: string): DraftWriter {
  const router = useRouter();
  const inFlight = useRef(false);
  const [writing, setWriting] = useState<DraftMode | null>(null);
  const [error, setError] = useState<DraftWriter["error"]>(null);

  const write = useCallback(
    async (mode: DraftMode, notes = ""): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setWriting(mode);
      setError(null);
      try {
        const response = await fetch(`/api/trackers/${trackerId}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notes ? { mode, notes } : { mode }),
        });
        if (!response.ok) {
          setError({ mode, message: await readError(response) });
          return false;
        }
        router.refresh();
        return true;
      } catch {
        setError({
          mode,
          message: "We lost the connection. Refresh the page in a minute to see whether the new version arrived.",
        });
        return false;
      } finally {
        inFlight.current = false;
        setWriting(null);
      }
    },
    [router, trackerId],
  );

  const clearError = useCallback(() => setError(null), []);

  return { writing, error, clearError, write };
}

// ---------------------------------------------------------------------------

function ModeSwitch({
  mode,
  onChange,
  writing,
}: {
  mode: DraftMode;
  onChange: (mode: DraftMode) => void;
  writing: DraftMode | null;
}) {
  return (
    <div role="group" aria-label="Which version of the page to show" className="inline-flex rounded-full bg-surface-sunken p-1">
      {MODES.map((option) => {
        const selected = option === mode;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft",
              selected ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {MODE_LABEL[option]}
            {writing === option ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand" aria-label="Being written" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The selected version: toolbar, meta rows, the page, its sources and why it should win. */
function DraftBody({
  draft,
  mode,
  keyword,
  writer,
  canRegenerate,
}: {
  draft: Draft;
  mode: DraftMode;
  keyword: string;
  writer: DraftWriter;
  canRegenerate: boolean;
}) {
  const content = draft.content_md ?? "";
  const placeholderCount = mode === "placeholders" ? countPlaceholders(content) : 0;
  const fullDocument = buildDocument(draft);
  const sources = mode === "researched" && Array.isArray(draft.sources) ? draft.sources : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={fullDocument} label="Copy the whole page" size="sm" />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => downloadMarkdown(fullDocument, `${slugify(keyword)}-${FILE_SUFFIX[mode]}.md`)}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download .md
        </Button>
        {canRegenerate ? <RegenerateForm mode={mode} writer={writer} /> : null}
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
        <Markdown>{mode === "placeholders" ? highlightPlaceholders(content) : content}</Markdown>
      </Card>

      {sources.length > 0 ? <SourcesPanel sources={sources} /> : null}

      {draft.why_better_md ? (
        <section>
          <Eyebrow>Why it should win</Eyebrow>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">Why this beats the current sources</h2>
          <Card className="mt-4">
            <Markdown>{draft.why_better_md}</Markdown>
          </Card>
        </section>
      ) : null}
    </>
  );
}

/** Shown when the selected version was never written for this report. */
function MissingVersion({
  mode,
  writer,
  canRegenerate,
}: {
  mode: DraftMode;
  writer: DraftWriter;
  canRegenerate: boolean;
}) {
  const pending = writer.writing === mode;
  const busy = writer.writing !== null;
  const error = writer.error?.mode === mode ? writer.error.message : null;

  const title =
    mode === "researched"
      ? "The ready-to-publish version isn't written yet"
      : "The version with your own data isn't written yet";
  const body =
    mode === "researched"
      ? "We look up real numbers and sources on the web and write the full page with every figure cited, so there is nothing left to fill in."
      : "We write the same page, but leave bold notes where your own prices, counts and experience belong.";

  return (
    <Card>
      <Eyebrow>Draft</Eyebrow>
      <h2 className="mt-2 text-xl font-bold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {canRegenerate ? (
          <>
            <Button size="sm" onClick={() => void writer.write(mode)} disabled={busy} aria-busy={pending}>
              {pending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <PenLine className="h-4 w-4" aria-hidden="true" />
              )}
              {pending ? "Writing…" : "Write this version"}
            </Button>
            <span className="text-xs text-ink-muted" aria-live="polite">
              {pending ? `${MODE_DURATION[mode]} The page updates by itself.` : MODE_DURATION[mode]}
            </span>
          </>
        ) : (
          <p className="text-sm text-ink-muted">You can write it as soon as the report is done.</p>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function RegenerateForm({ mode, writer }: { mode: DraftMode; writer: DraftWriter }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const pending = writer.writing === mode;
  const busy = writer.writing !== null;
  const error = writer.error?.mode === mode ? writer.error.message : null;

  async function submit() {
    if (busy) return;
    const written = await writer.write(mode, notes.trim());
    if (written) {
      setOpen(false);
      setNotes("");
    }
  }

  function close() {
    writer.clearError();
    setOpen(false);
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={open || busy}>
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
            plan&rdquo;. Leave it blank for a fresh take. This rewrites the &ldquo;{MODE_LABEL[mode]}&rdquo; version.
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
            <Button size="sm" onClick={submit} disabled={busy} aria-busy={pending}>
              {pending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <PenLine className="h-4 w-4" aria-hidden="true" />
              )}
              {pending ? "Writing…" : "Write a new draft"}
            </Button>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            {pending ? <span className="text-xs text-ink-muted">{MODE_DURATION[mode]}</span> : null}
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

/** The pages a researched draft took its figures from. Each is also linked inside the page itself. */
function SourcesPanel({ sources }: { sources: DraftSource[] }) {
  return (
    <section>
      <Eyebrow>Sources</Eyebrow>
      <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">Where the numbers come from</h2>
      <p className="mt-1 text-sm text-ink-muted">Each source is also linked inside the page.</p>
      <Panel className="mt-4 divide-y divide-line">
        {sources.map((source, index) => {
          const domain = domainFromUrl(source.url);
          const label = source.title?.trim() || domain;
          return (
            <div key={`${source.url}-${index}`} className="px-4 py-3">
              {isHttpUrl(source.url) ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="nofollow noreferrer noopener"
                  className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-brand"
                >
                  {label}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
                </a>
              ) : (
                <span className="font-medium text-ink">{label}</span>
              )}
              <p className="mt-0.5 text-xs text-ink-soft">{domain}</p>
              {source.used_for ? <p className="mt-1 text-sm text-ink-muted">{source.used_for}</p> : null}
            </div>
          );
        })}
      </Panel>
    </section>
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

/** The version to open with: the ready-to-publish one when it exists, else the other, else the ready one's card. */
function defaultMode(drafts: DraftVersions): DraftMode {
  if (drafts.researched) return "researched";
  if (drafts.placeholders) return "placeholders";
  return "researched";
}

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

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
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
