import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { base64urlDecode } from "./lib/crypto";
import { fail } from "./lib/errors";
import { requireOperator, requireReceiver } from "./lib/guards";

/** The hardware checklist an Operator ticks on a real phone + HackRF before promoting. */
export const CHECKLIST = [
  "pair",
  "three-scans",
  "replug",
  "airplane-drain",
  "kill-exit-reason",
] as const;

const releaseView = (r: Doc<"releases">) => ({
  versionCode: r.versionCode,
  versionName: r.versionName,
  sha256: r.sha256,
  size: r.size,
  minSupported: r.minSupported,
});

async function latestPromoted(ctx: QueryCtx) {
  return await ctx.db
    .query("releases")
    .withIndex("by_status_and_versionCode", (q) => q.eq("status", "promoted"))
    .order("desc")
    .first();
}

/** Called by the publish script (deploy key or local admin key): where to upload the APK. */
export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Convex stores SHA-256 base64-encoded; the script sends hex. */
const hexOfBase64 = (b64: string) =>
  Array.from(base64urlDecode(b64.replaceAll("+", "-").replaceAll("/", "_")), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/** Records the uploaded APK as the candidate after checking it is exactly the file that was built. */
export const recordCandidate = internalMutation({
  args: {
    versionCode: v.number(),
    versionName: v.string(),
    commit: v.string(),
    sha256: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    notes: v.string(),
    minSupported: v.union(v.number(), v.null()),
  },
  // A refusal is returned, not thrown: throwing would roll back the delete of the bad upload.
  returns: v.union(
    v.object({ ok: v.literal(true), id: v.id("releases") }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const meta = await ctx.db.system.get("_storage", args.storageId);
    const sha256 = args.sha256.toLowerCase();
    if (!meta || meta.size !== args.size || hexOfBase64(meta.sha256) !== sha256) {
      if (meta) await ctx.storage.delete(args.storageId);
      return { ok: false as const, reason: "The uploaded file doesn't match its size or SHA-256." };
    }
    const promoted = await latestPromoted(ctx);
    if (promoted && args.versionCode <= promoted.versionCode) {
      await ctx.storage.delete(args.storageId);
      return {
        ok: false as const,
        reason: `versionCode ${args.versionCode} isn't newer than the promoted ${promoted.versionCode}.`,
      };
    }
    for (const old of await ctx.db
      .query("releases")
      .withIndex("by_status_and_versionCode", (q) => q.eq("status", "candidate"))
      .take(5)) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.delete("releases", old._id);
    }
    const id = await ctx.db.insert("releases", {
      ...args,
      sha256,
      status: "candidate",
      builtAt: Date.now(),
      promotedBy: null,
      promotedAt: null,
      checklist: null,
    });
    return { ok: true as const, id };
  },
});

/** Rare subscription: the promoted releases (current, previous) and the candidate. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const pick = (status: Doc<"releases">["status"], n: number) =>
      ctx.db
        .query("releases")
        .withIndex("by_status_and_versionCode", (q) => q.eq("status", status))
        .order("desc")
        .take(n);
    const withUrl = async (r: Doc<"releases">) => ({
      ...r,
      url: await ctx.storage.getUrl(r.storageId),
    });
    return {
      promoted: await Promise.all((await pick("promoted", 2)).map(withUrl)),
      candidate: (await Promise.all((await pick("candidate", 1)).map(withUrl)))[0] ?? null,
    };
  },
});

async function advertise(ctx: MutationCtx, r: Doc<"releases"> | null) {
  const release = r && releaseView(r);
  for (const control of await ctx.db.query("receiverControl").take(200)) {
    await ctx.db.patch("receiverControl", control._id, { release });
  }
}

/** Only with the whole checklist ticked; keeps two promoted releases and prunes the rest. */
export const promote = mutation({
  args: { releaseId: v.id("releases"), checklist: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { releaseId, checklist }) => {
    const operator = await requireOperator(ctx);
    const r = await ctx.db.get("releases", releaseId);
    if (r?.status !== "candidate") fail("NOT_FOUND", "That candidate is gone.");
    if (!CHECKLIST.every((item) => checklist.includes(item))) fail("CHECKLIST_INCOMPLETE");
    await ctx.db.patch("releases", releaseId, {
      status: "promoted",
      promotedBy: operator.name,
      promotedAt: Date.now(),
      checklist: [...CHECKLIST],
    });
    const promoted = await ctx.db
      .query("releases")
      .withIndex("by_status_and_versionCode", (q) => q.eq("status", "promoted"))
      .order("desc")
      .take(10);
    for (const old of promoted.slice(2)) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.patch("releases", old._id, { status: "retired" });
    }
    await advertise(ctx, await ctx.db.get("releases", releaseId));
    return null;
  },
});

export const discard = mutation({
  args: { releaseId: v.id("releases") },
  returns: v.null(),
  handler: async (ctx, { releaseId }) => {
    await requireOperator(ctx);
    const r = await ctx.db.get("releases", releaseId);
    if (r?.status !== "candidate") return null;
    await ctx.storage.delete(r.storageId);
    await ctx.db.delete("releases", releaseId);
    return null;
  },
});

/** For phones: a fresh URL for the promoted APK (they verify its SHA-256 before installing). */
export const downloadUrl = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ url: v.string(), versionCode: v.number(), sha256: v.string(), size: v.number() }),
  ),
  handler: async (ctx) => {
    await requireReceiver(ctx);
    const r = await latestPromoted(ctx);
    const url = r && (await ctx.storage.getUrl(r.storageId));
    return r && url ? { url, versionCode: r.versionCode, sha256: r.sha256, size: r.size } : null;
  },
});

/** What a newly paired Receiver's control doc advertises. */
export async function currentRelease(ctx: QueryCtx) {
  const r = await latestPromoted(ctx);
  return r && releaseView(r);
}
