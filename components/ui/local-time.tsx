"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";

export type LocalTimeMode = "date" | "datetime" | "relative";

export interface LocalTimeProps {
  /** ISO 8601 timestamp, as Postgres timestamptz columns come back. */
  iso: string;
  /** "date": Oct 9, 2026 · "datetime": Oct 9, 6:00 AM · "relative": in 3 hours / 2 days ago (absolute time in the title). */
  mode?: LocalTimeMode;
  className?: string;
}

export interface LocalTimeText {
  text: string;
  /** The absolute date and time, set in relative mode so a hover shows it. */
  title?: string;
}

/** Same en-US shapes as lib/utils formatDate / formatDateTime. */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

/** How often a relative time re-renders so "in 3 minutes" stays true while the page is open. */
const TICK_MS = MINUTE;

/**
 * Formats `iso` the way <LocalTime> shows it. `timeZone` undefined means the
 * runtime's own zone (the browser's); `now` defaults to the current time.
 * Returns an empty text for a timestamp that does not parse.
 */
export function formatLocalTime(
  iso: string,
  mode: LocalTimeMode,
  options: { timeZone?: string; now?: number } = {},
): LocalTimeText {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "" };
  const { timeZone } = options;
  if (mode === "date") return { text: date.toLocaleDateString("en-US", { ...DATE_OPTIONS, timeZone }) };
  const absolute = date.toLocaleString("en-US", { ...DATETIME_OPTIONS, timeZone });
  if (mode === "datetime") return { text: absolute };
  return { text: formatRelative(date.getTime() - (options.now ?? Date.now())), title: absolute };
}

/** "in 3 hours", "2 days ago", "tomorrow", "just now". */
function formatRelative(diffMs: number): string {
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= ms) return formatter.format(Math.round(diffMs / ms), unit);
  }
  return diffMs >= 0 ? "in a moment" : "just now";
}

// The one thing that differs between the server and the browser: on the server
// (and during hydration) the time is shown in UTC, afterwards in the viewer's zone.
function subscribeNever() {
  return () => {};
}
function getLocalSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}

function nextNow() {
  return Date.now();
}

/**
 * A timestamp in the viewer's timezone, in the same en-US formats as
 * lib/utils formatDate / formatDateTime. The server renders the UTC version
 * and the browser switches to local time right after hydration, so the two
 * never disagree. Relative mode ("in 3 hours", "2 days ago") keeps the
 * absolute time in the title attribute and refreshes itself every minute.
 */
export function LocalTime({ iso, mode = "datetime", className }: LocalTimeProps) {
  const local = useSyncExternalStore(subscribeNever, getLocalSnapshot, getServerSnapshot);
  // 0 until the first tick: formatLocalTime then reads the clock itself.
  const [now, tick] = useReducer(nextNow, 0);

  useEffect(() => {
    if (mode !== "relative") return;
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [mode]);

  const { text, title } = formatLocalTime(iso, mode, {
    timeZone: local ? undefined : "UTC",
    now: now || undefined,
  });

  return (
    <time dateTime={iso} title={title} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
