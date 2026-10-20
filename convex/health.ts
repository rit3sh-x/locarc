import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { type AlertType, raiseAlert, resolveAlert } from "./alerts";
import {
  type Book,
  evaluate,
  HEALTH_LABEL,
  OFFLINE_AFTER_MS,
  type Reason,
  THRESHOLDS,
} from "./lib/health";

/** Which health alerts a result implies, by type: the Receiver health states decision's list. */
function healthAlerts(
  name: string,
  state: Doc<"receiverStatus">["state"],
  reasons: Reason[],
  book: Book,
  now: number,
) {
  const want = new Map<AlertType, { severity: "critical" | "warning"; text: string }>();
  const find = (...codes: Reason["code"][]) => reasons.find((r) => codes.includes(r.code));
  if (state === "offline")
    want.set("offline", { severity: "critical", text: reasons[0]?.text ?? "offline" });
  const critical = find("needs_attention", "permission_denied", "detached");
  if (critical) want.set("needs_attention", { severity: "critical", text: critical.text });
  const pause = find("paused_battery", "paused_thermal");
  if (pause) want.set("self_pause", { severity: "warning", text: pause.text });
  const flapping = find("power_flapping");
  if (flapping) want.set("power_flapping", { severity: "warning", text: flapping.text });
  const moved = find("moved");
  if (moved) want.set("pin_drift", { severity: "warning", text: "Moved? GPS is far from the pin" });
  const rejected = find("config_rejected");
  if (rejected)
    want.set("config_rejected", {
      severity: "warning",
      text: `${rejected.text}: ${rejected.detail}`,
    });
  if (
    state === "degraded" &&
    book.degradedSince !== null &&
    now - book.degradedSince > THRESHOLDS.degradedAlertAfterMs
  ) {
    want.set("degraded", {
      severity: "warning",
      text: `Degraded for 15+ min: ${reasons[0]?.text ?? ""}`,
    });
  }
  return new Map([...want].map(([type, w]) => [type, { ...w, title: `${name}: ${w.text}` }]));
}

/**
 * Re-evaluates a Receiver's health after `patch` and writes the status doc once. Alerts and
 * events change only on transitions, so a steady state costs nothing extra.
 */
export async function applyHealth(
  ctx: MutationCtx,
  receiver: Doc<"receivers">,
  status: Doc<"receiverStatus">,
  now: number,
  patch: Partial<
    Pick<Doc<"receiverStatus">, "lastSeenAt" | "appVersion" | "position" | "snapshot" | "book">
  > = {},
) {
  const next = { ...status, ...patch };
  const org = await ctx.db.query("organization").first();
  const { state, reasons } = evaluate({
    status: receiver.status,
    now,
    lastSeenAt: next.lastSeenAt,
    runActive: org?.run != null,
    pausedByOperator: receiver.pausedByOperator,
    pinned: receiver.config.position.mode === "pinned",
    snapshot: next.snapshot,
    book: next.book,
    configPendingSince: receiver.appliedV === receiver.configV ? null : receiver.configAt,
    configRejected: receiver.rejected,
  });
  const book: Book = {
    ...next.book,
    degradedSince: state === "degraded" ? (next.book.degradedSince ?? now) : null,
  };

  const subjectKey = `rx:${receiver._id}`;
  const want = healthAlerts(receiver.name, state, reasons, book, now);
  const had = new Set(status.book.openAlerts as AlertType[]);
  for (const [type, w] of want) {
    if (had.has(type)) continue;
    await raiseAlert(
      ctx,
      { subjectKey, type, kind: "condition", severity: w.severity, title: w.title, detail: w.text },
      now,
    );
    await logEvent(ctx, receiver._id, now, "alert", `Alert opened: ${w.text}`);
  }
  for (const type of had) {
    if (want.has(type)) continue;
    await resolveAlert(ctx, subjectKey, type, now);
    await logEvent(ctx, receiver._id, now, "alert", `Alert resolved: ${type.replace("_", " ")}`);
  }
  if (state !== status.state) {
    await logEvent(
      ctx,
      receiver._id,
      now,
      "state",
      `${HEALTH_LABEL[status.state]} → ${HEALTH_LABEL[state]}${reasons[0] ? ` (${reasons[0].text})` : ""}`,
    );
  }
  await ctx.db.patch("receiverStatus", status._id, {
    ...patch,
    state,
    reasons,
    book: { ...book, openAlerts: [...want.keys()] },
  });
  return state;
}

export async function logEvent(
  ctx: MutationCtx,
  receiver: Id<"receivers">,
  at: number,
  kind: Doc<"receiverEvents">["kind"],
  text: string,
  faults?: Record<string, number>,
) {
  await ctx.db.insert("receiverEvents", {
    receiver,
    at,
    kind,
    text,
    ...(faults ? { faults } : {}),
  });
}

/** Re-arms the dead-man timer: it fires only if the Receiver then stays silent 12 minutes. */
export async function rearmDeadMan(
  ctx: MutationCtx,
  receiver: Id<"receivers">,
  book: Book,
): Promise<Book> {
  if (book.deadMan) await ctx.scheduler.cancel(book.deadMan);
  const deadMan = await ctx.scheduler.runAfter(OFFLINE_AFTER_MS, internal.health.deadMan, {
    receiver,
  });
  return { ...book, deadMan };
}

/** Fires 12 minutes after the last contact, so Offline is known with no browser open. */
export const deadMan = internalMutation({
  args: { receiver: v.id("receivers") },
  returns: v.null(),
  handler: async (ctx, { receiver: id }) => {
    const receiver = await ctx.db.get("receivers", id);
    const status = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", id))
      .unique();
    if (receiver?.status !== "active" || !status) return null;
    await applyHealth(ctx, receiver, status, Date.now(), {
      book: { ...status.book, deadMan: null },
    });
    return null;
  },
});
