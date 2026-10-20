import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { displayedState, type HealthState, type Reason } from "@/convex/lib/health";

export type FleetRow = {
  receiver: FunctionReturnType<typeof api.receivers.list>[number];
  status: Omit<Doc<"receiverStatus">, "_id" | "_creationTime"> | undefined;
  state: HealthState;
  reasons: Reason[];
};

/** Cold Receiver docs joined with the hot status docs the shell keeps subscribed. */
export function useFleet(now: number): FleetRow[] | undefined {
  const receivers = useQuery(api.receivers.list);
  const statuses = useQuery(api.live.receiverStatuses);
  if (!receivers || !statuses) return undefined;
  const byReceiver = new Map<Id<"receivers">, (typeof statuses)[number]>(
    statuses.map((s) => [s.receiver, s]),
  );
  return receivers
    .filter((r) => r.status !== "removed")
    .map((receiver) => {
      const status = byReceiver.get(receiver._id);
      const state = displayedState(
        {
          status: receiver.status,
          serverState: status?.state ?? "idle",
          lastSeenAt: status?.lastSeenAt ?? null,
        },
        now,
      );
      // Aged to Offline in the browser: the server's reasons are stale, so show none.
      const reasons =
        state === "offline" && status?.state !== "offline" ? [] : (status?.reasons ?? []);
      return { receiver, status, state, reasons };
    })
    .sort((a, b) => a.receiver.name.localeCompare(b.receiver.name));
}

/** Where each Receiver stands against the promoted release. */
export function rolloutState(
  versionCode: number | undefined,
  release: { versionCode: number; minSupported: number | null } | null,
) {
  if (!release || versionCode === undefined) return null;
  if (release.minSupported !== null && versionCode < release.minSupported)
    return "Too old" as const;
  return versionCode < release.versionCode
    ? ("Update available" as const)
    : ("Up to date" as const);
}
