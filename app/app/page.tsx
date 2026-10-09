import type { Metadata } from "next";
import { Plus, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { EMPTY_TRACKER_STATS, TrackerCard, type TrackerStats } from "@/components/app/tracker-card";
import { LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OverviewReference, Tracker } from "@/lib/types";

export const metadata: Metadata = { title: "Your keywords" };

/** The snapshot columns the dashboard needs. */
interface SnapshotRow {
  tracker_id: string;
  day_number: number;
  has_overview: boolean;
  references: OverviewReference[] | null;
  captured_at: string;
}

/** Dashboard: every keyword the signed-in user is tracking, newest first. */
export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: trackerRows, error: trackersError } = await supabase
    .from("trackers")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const trackers = (trackerRows ?? []) as Tracker[];

  let stats = new Map<string, TrackerStats>();
  if (trackers.length > 0) {
    const { data: snapshotRows, error: snapshotsError } = await supabase
      .from("snapshots")
      .select("tracker_id, day_number, has_overview, references, captured_at")
      .in(
        "tracker_id",
        trackers.map((t) => t.id),
      );
    if (snapshotsError) console.error("dashboard snapshots query failed", snapshotsError.message);
    stats = summarizeSnapshots((snapshotRows ?? []) as SnapshotRow[]);
  }

  const isEmpty = !trackersError && trackers.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Your keywords</Eyebrow>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Keywords you are tracking</h1>
        </div>
        {isEmpty ? null : (
          <LinkButton href="/app/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add keyword
          </LinkButton>
        )}
      </div>

      <div className="mt-6">
        {trackersError ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-line bg-bad-soft p-5 text-sm text-bad"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>We could not load your keywords. Refresh the page to try again.</p>
          </div>
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <ul className="space-y-4">
            {trackers.map((tracker) => (
              <li key={tracker.id}>
                <TrackerCard tracker={tracker} stats={stats.get(tracker.id) ?? EMPTY_TRACKER_STATS} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Folds every snapshot row into per-tracker numbers: latest day, distinct cited domains, days with an overview. */
function summarizeSnapshots(rows: SnapshotRow[]): Map<string, TrackerStats> {
  const byTracker = new Map<string, { stats: TrackerStats; domains: Set<string> }>();

  for (const row of rows) {
    let entry = byTracker.get(row.tracker_id);
    if (!entry) {
      entry = { stats: { ...EMPTY_TRACKER_STATS }, domains: new Set<string>() };
      byTracker.set(row.tracker_id, entry);
    }
    entry.stats.daysCaptured += 1;
    if (row.has_overview) entry.stats.daysWithOverview += 1;
    for (const ref of row.references ?? []) {
      if (ref?.domain) entry.domains.add(ref.domain.toLowerCase());
    }
    if (!entry.stats.latest || row.day_number > entry.stats.latest.dayNumber) {
      entry.stats.latest = {
        dayNumber: row.day_number,
        hasOverview: row.has_overview,
        capturedAt: row.captured_at,
      };
    }
  }

  const result = new Map<string, TrackerStats>();
  for (const [trackerId, entry] of byTracker) {
    result.set(trackerId, { ...entry.stats, sourcesSeen: entry.domains.size });
  }
  return result;
}
