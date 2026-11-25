"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { saveAnthropicAction, saveDataForSeoAction, type KeyFormState } from "./actions";

const fieldClass =
  "mt-1.5 h-11 w-full rounded-xl border border-line bg-white px-4 text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft";
const labelClass = "block text-sm font-semibold text-ink";

function Result({ state }: { state: KeyFormState | null }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="flex items-start gap-2 text-sm text-good">
      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {state.message}
    </p>
  ) : (
    <p role="alert" className="flex items-start gap-2 text-sm text-bad">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {state.message}
    </p>
  );
}

function SaveButton({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? "Checking…" : saved ? "Replace and check" : "Save and check"}
    </Button>
  );
}

/** DataForSEO API login and password. The server checks them with DataForSEO before saving. */
export function DataForSeoForm({ saved }: { saved: boolean }) {
  const [state, action, pending] = useActionState(saveDataForSeoAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dfs-login" className={labelClass}>
            API login
          </label>
          <input
            id="dfs-login"
            name="login"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="you@example.com"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="dfs-password" className={labelClass}>
            API password
          </label>
          <input
            id="dfs-password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            spellCheck={false}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} saved={saved} />
        <Result state={state} />
      </div>
    </form>
  );
}

/** Anthropic API key, plus the workspace id a personal (sk-ant-usr-) key needs. Checked with Anthropic before saving. */
export function AnthropicForm({ saved }: { saved: boolean }) {
  const [state, action, pending] = useActionState(saveAnthropicAction, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="anthropic-key" className={labelClass}>
          API key
        </label>
        <input
          id="anthropic-key"
          name="api_key"
          type="password"
          required
          autoComplete="new-password"
          spellCheck={false}
          placeholder="sk-ant-..."
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="anthropic-workspace" className={labelClass}>
          Workspace id (only for personal keys)
        </label>
        <input
          id="anthropic-workspace"
          name="workspace_id"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="wrkspc_..."
          className={fieldClass}
        />
        <p className="mt-1.5 text-sm text-ink-muted">
          Leave it blank for a normal workspace key. A personal key (sk-ant-usr-...) needs the id of the workspace that
          pays.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} saved={saved} />
        <Result state={state} />
      </div>
    </form>
  );
}
