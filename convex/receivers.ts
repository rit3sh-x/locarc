import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { type AlertType, resolveAlert } from "./alerts";
import { updateFleet } from "./emitters";
import { applyHealth, logEvent } from "./health";
import {
  type ReceiverConfig,
  receiverConfigDefaults,
  receiverConfigDiff,
  receiverConfigValidator,
  sameValue,
  validateReceiverConfig,
} from "./lib/config";
import { sha256Hex } from "./lib/crypto";
import { fail } from "./lib/errors";
import { requireOperator } from "./lib/guards";
import { emptyBook } from "./lib/health";
import { newPairingCode, PAIRING_TTL_MS } from "./lib/pairing";
import { currentRelease } from "./releases";
import { controlRunSection } from "./runs";

const pairingResult = v.object({ code: v.string(), expiresAt: v.number() });

/** One live code per Receiver: issuing a new one voids the previous unused one. */
async function issueCode(ctx: MutationCtx, receiver: Id<"receivers">) {
  for (const old of await ctx.db
    .query("pairingCodes")
    .withIndex("by_receiver", (q) => q.eq("receiver", receiver))
    .take(20)) {
    if (old.usedAt === null) await ctx.db.delete("pairingCodes", old._id);
  }
  const code = newPairingCode();
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  await ctx.db.insert("pairingCodes", {
    codeHash: await sha256Hex(code),
    receiver,
    expiresAt,
    usedAt: null,
  });
  return { code, expiresAt };
}

async function getReceiver(ctx: MutationCtx, id: Id<"receivers">) {
  const receiver = await ctx.db.get("receivers", id);
  if (!receiver) fail("NOT_FOUND");
  return receiver;
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("receivers"),
      _creationTime: v.number(),
      name: v.string(),
      status: v.union(v.literal("pending"), v.literal("active"), v.literal("removed")),
      pairedAt: v.union(v.number(), v.null()),
      removedAt: v.union(v.number(), v.null()),
      hackrfSerial: v.union(v.string(), v.null()),
      configV: v.number(),
      configAt: v.number(),
      config: receiverConfigValidator,

      appliedV: v.union(v.number(), v.null()),
      rejected: v.union(v.null(), v.object({ v: v.number(), reason: v.string() })),
      pausedByOperator: v.boolean(),
      calibration: v.union(v.null(), v.object({ at: v.number(), serial: v.string() })),
      /** What the phone still runs while a newer version is pending or was rejected. */
      running: v.union(v.null(), v.object({ v: v.number(), values: receiverConfigValidator })),
    }),
  ),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const receivers = await ctx.db.query("receivers").take(200);
    return await Promise.all(
      receivers.map(async (doc) => {
        const { secretHash: _, ...r } = doc;
        return { ...r, running: await runningConfig(ctx, doc) };
      }),
    );
  },
});

export const createPending = mutation({
  args: { name: v.string() },
  returns: v.object({ receiverId: v.id("receivers"), ...pairingResult.fields }),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 40) fail("VALUE_OUT_OF_RANGE", "Use 1–40 characters.");
    const taken = await ctx.db
      .query("receivers")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (taken) fail("NAME_TAKEN");
    const config = receiverConfigDefaults(name);
    const receiver = await ctx.db.insert("receivers", {
      name,
      status: "pending",
      secretHash: null,
      pairedAt: null,
      removedAt: null,
      hackrfSerial: null,
      configV: 1,
      configAt: Date.now(),
      config,
      appliedV: null,
      rejected: null,
      pausedByOperator: false,
      calibration: null,
    });
    await ctx.db.insert("receiverConfigVersions", {
      receiver,
      v: 1,
      author: operator.name,
      at: Date.now(),
      values: config,
      diff: [],
    });
    await ctx.db.insert("receiverStatus", {
      receiver,
      state: "awaiting_pairing",
      lastSeenAt: null,
      appVersion: null,
      position: null,
      snapshot: null,
      reasons: [],
      book: emptyBook(),
    });
    const org = await ctx.db.query("organization").first();
    const run = org?.run ? await ctx.db.get("runs", org.run) : null;
    await ctx.db.insert("receiverControl", {
      receiver,
      run: run && controlRunSection(run),
      paused: false,
      config: { v: 1, values: config },
      commands: [],
      lastSeq: 0,

      release: await currentRelease(ctx),
    });
    return { receiverId: receiver, ...(await issueCode(ctx, receiver)) };
  },
});

/** A new code for an existing (or removed) Receiver; redeeming it cuts the old phone off. */
export const repair = mutation({
  args: { receiverId: v.id("receivers") },
  returns: pairingResult,
  handler: async (ctx, { receiverId }) => {
    await requireOperator(ctx);
    await getReceiver(ctx, receiverId);
    return await issueCode(ctx, receiverId);
  },
});

/** Soft remove: the secret is cleared, so the next token mint and every guard refuse it. */
export const remove = mutation({
  args: { receiverId: v.id("receivers") },
  returns: v.null(),
  handler: async (ctx, { receiverId }) => {
    await requireOperator(ctx);
    const receiver = await getReceiver(ctx, receiverId);
    if (receiver.status === "removed") return null;
    const now = Date.now();
    await ctx.db.patch("receivers", receiverId, {
      status: "removed",
      secretHash: null,
      removedAt: now,
    });
    // A removed Receiver raises nothing more: stop its timer and close its alerts.
    const status = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiverId))
      .unique();
    if (status) {
      if (status.book.deadMan) await ctx.scheduler.cancel(status.book.deadMan);
      for (const type of status.book.openAlerts) {
        await resolveAlert(ctx, `rx:${receiverId}`, type as AlertType, now);
      }
      await ctx.db.patch("receiverStatus", status._id, {
        book: { ...status.book, deadMan: null, openAlerts: [] },
      });
    }
    for (const code of await ctx.db
      .query("pairingCodes")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiverId))
      .take(20)) {
      if (code.usedAt === null) await ctx.db.delete("pairingCodes", code._id);
    }
    await updateFleet(ctx, receiver, null, now);
    return null;
  },
});

const changeValidator = v.object({
  receiverId: v.id("receivers"),
  expectedV: v.number(),
  values: receiverConfigValidator,
});

/** One version per Receiver; the control doc carries it to the phone, which acks through sync. */
export async function pushReceiverConfig(
  ctx: MutationCtx,
  author: string,
  change: { receiverId: Id<"receivers">; expectedV: number; values: ReceiverConfig },
  prefix: string[] = [],
) {
  const r = await getReceiver(ctx, change.receiverId);
  if (r.status === "removed") fail("NOT_FOUND");
  if (change.expectedV !== r.configV)
    fail("CONFIG_CONFLICT", `${r.name} changed since you opened it.`);
  const values = {
    ...change.values,
    name: change.values.name.trim(),
    notes: change.values.notes.trim(),
  };
  const problem = validateReceiverConfig(values);
  if (problem) fail(problem.code, `${r.name}: ${problem.message}`);
  if (values.name !== r.name) {
    const taken = await ctx.db
      .query("receivers")
      .withIndex("by_name", (q) => q.eq("name", values.name))
      .first();
    if (taken) fail("NAME_TAKEN");
  }
  const diff = receiverConfigDiff(r.config, values);
  if (diff.length === 0) return r.configV;
  const v = r.configV + 1;
  const now = Date.now();
  await ctx.db.insert("receiverConfigVersions", {
    receiver: r._id,
    v,
    author,
    at: now,
    values,
    diff: [...prefix, ...diff],
  });
  await ctx.db.patch("receivers", r._id, {
    configV: v,
    configAt: now,
    config: values,
    name: values.name,
  });
  const control = await ctx.db
    .query("receiverControl")
    .withIndex("by_receiver", (q) => q.eq("receiver", r._id))
    .unique();
  if (control) await ctx.db.patch("receiverControl", control._id, { config: { v, values } });
  // The phones' fleet map follows pins and renames at once.
  if (values.name !== r.name || !sameValue(values.position, r.config.position)) {
    const pin = values.position;
    const live =
      pin.mode === "pinned"
        ? null
        : (
            await ctx.db
              .query("receiverStatus")
              .withIndex("by_receiver", (q) => q.eq("receiver", r._id))
              .unique()
          )?.position;
    await updateFleet(
      ctx,
      { _id: r._id, name: values.name },
      pin.mode === "pinned"
        ? { lat: pin.lat, lng: pin.lng, accuracyM: 0, pinned: true }
        : live
          ? { lat: live.lat, lng: live.lng, accuracyM: live.accuracyM, pinned: false }
          : null,
      now,
    );
  }
  await logEvent(
    ctx,
    r._id,
    now,
    "config",
    `Config v${v} by ${author}: ${[...prefix, ...diff].join("; ")}`,
  );
  return v;
}

/** A batch from the matrix's "Review & push": all-or-nothing, one version each. */
export const pushConfig = mutation({
  args: { changes: v.array(changeValidator) },
  returns: v.array(v.object({ receiverId: v.id("receivers"), v: v.number() })),
  handler: async (ctx, { changes }) => {
    const operator = await requireOperator(ctx);
    const out = [];
    for (const c of changes)
      out.push({ receiverId: c.receiverId, v: await pushReceiverConfig(ctx, operator.name, c) });
    return out;
  },
});

export const restoreVersion = mutation({
  args: { receiverId: v.id("receivers"), v: v.number(), expectedV: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const old = await ctx.db
      .query("receiverConfigVersions")
      .withIndex("by_receiver_and_v", (q) => q.eq("receiver", args.receiverId).eq("v", args.v))
      .unique();
    if (!old) fail("NOT_FOUND");
    return await pushReceiverConfig(
      ctx,
      operator.name,
      { receiverId: args.receiverId, expectedV: args.expectedV, values: old.values },
      [`Restored v${args.v}`],
    );
  },
});

async function statusOf(ctx: MutationCtx, receiver: Id<"receivers">) {
  const status = await ctx.db
    .query("receiverStatus")
    .withIndex("by_receiver", (q) => q.eq("receiver", receiver))
    .unique();
  if (!status) fail("NOT_FOUND");
  return status;
}

/** An Operator's pause takes the Receiver out of Scans without stopping the Organization. */
export const setPaused = mutation({
  args: { receiverId: v.id("receivers"), paused: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { receiverId, paused }) => {
    const operator = await requireOperator(ctx);
    const r = await getReceiver(ctx, receiverId);
    if (r.pausedByOperator === paused) return null;
    await ctx.db.patch("receivers", receiverId, { pausedByOperator: paused });
    const control = await ctx.db
      .query("receiverControl")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiverId))
      .unique();
    if (control) await ctx.db.patch("receiverControl", control._id, { paused });
    const now = Date.now();
    await logEvent(
      ctx,
      receiverId,
      now,
      "pause",
      `${paused ? "Paused" : "Resumed"} by ${operator.name}`,
    );
    await applyHealth(
      ctx,
      { ...r, pausedByOperator: paused },
      await statusOf(ctx, receiverId),
      now,
    );
    return null;
  },
});

/** "Moved?": move the pin to where GPS says it is, or keep the pin (quiet until GPS returns). */
export const resolveDrift = mutation({
  args: { receiverId: v.id("receivers"), action: v.union(v.literal("move"), v.literal("keep")) },
  returns: v.null(),
  handler: async (ctx, { receiverId, action }) => {
    const operator = await requireOperator(ctx);
    let r = await getReceiver(ctx, receiverId);
    const status = await statusOf(ctx, receiverId);
    if (action === "move" && status.position) {
      const position = {
        mode: "pinned" as const,
        lat: status.position.lat,
        lng: status.position.lng,
      };
      await pushReceiverConfig(
        ctx,
        operator.name,
        { receiverId, expectedV: r.configV, values: { ...r.config, position } },
        ["Moved the pin to GPS"],
      );
      r = await getReceiver(ctx, receiverId);
    }
    const book = { ...status.book, moved: false, driftSince: null, driftMuted: action === "keep" };
    await applyHealth(ctx, r, status, Date.now(), { book });
    return null;
  },
});

/** Receiver detail: the cold doc, its hot status and the running config when one is pending. */
export const get = query({
  args: { receiverId: v.id("receivers") },
  handler: async (ctx, { receiverId }) => {
    await requireOperator(ctx);
    const r = await ctx.db.get("receivers", receiverId);
    if (!r) return null;
    const { secretHash: _, ...receiver } = r;
    const status = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiverId))
      .unique();
    return { receiver, status, running: await runningConfig(ctx, r) };
  },
});

/** The config the phone still runs while a newer version is pending or was rejected. */
async function runningConfig(ctx: QueryCtx, r: Doc<"receivers">) {
  if (r.appliedV === null || r.appliedV === r.configV) return null;
  const applied = r.appliedV;
  const version = await ctx.db
    .query("receiverConfigVersions")
    .withIndex("by_receiver_and_v", (q) => q.eq("receiver", r._id).eq("v", applied))
    .unique();
  return version && { v: version.v, values: version.values };
}

export const versions = query({
  args: { receiverId: v.id("receivers"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { receiverId, paginationOpts }) => {
    await requireOperator(ctx);
    return await ctx.db
      .query("receiverConfigVersions")
      .withIndex("by_receiver_and_v", (q) => q.eq("receiver", receiverId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

/** One-shot pages of the 30-day event timeline. */
export const events = query({
  args: { receiverId: v.id("receivers"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { receiverId, paginationOpts }) => {
    await requireOperator(ctx);
    return await ctx.db
      .query("receiverEvents")
      .withIndex("by_receiver_and_at", (q) => q.eq("receiver", receiverId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

/** Fault counts by code since `since` (the website passes 24 h ago, rounded to the hour). */
export const faultCounts = query({
  args: { receiverId: v.id("receivers"), since: v.number() },
  returns: v.record(v.string(), v.number()),
  handler: async (ctx, { receiverId, since }) => {
    await requireOperator(ctx);
    const counts: Record<string, number> = {};
    for (const e of await ctx.db
      .query("receiverEvents")
      .withIndex("by_receiver_and_at", (q) => q.eq("receiver", receiverId).gte("at", since))
      .take(500)) {
      for (const [code, n] of Object.entries(e.faults ?? {}))
        counts[code] = (counts[code] ?? 0) + n;
    }
    return counts;
  },
});
