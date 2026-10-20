import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LEARNING_MS } from "@/convex/lib/alertRules";
import { dateTime, useNow } from "../lib/time";

/** New alerts are quiet while Locarc learns what's usual. */
export function LearningBanner() {
  const config = useQuery(api.orgConfig.current);
  const now = useNow(60_000);
  if (!config) return null;
  const first = config.firstRunAt;
  const change = config.planChange;
  const text =
    first !== null && now < first + LEARNING_MS
      ? `Learning until ${dateTime(first + LEARNING_MS)}: New alerts stay quiet while Locarc learns which emitters are usual.`
      : change && now < change.at + LEARNING_MS
        ? `Learning the new Sweep plan until ${dateTime(change.at + LEARNING_MS)}: newly covered frequencies don't raise New yet.`
        : null;
  if (!text) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm"
    >
      {text}
    </p>
  );
}
