import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireOperator } from "./lib/guards";
import { encryptPayload, vapidAuthorization } from "./lib/webPush";

/** Where a notification click should land. */
export function alertPath(subjectKey: string): string {
  const [kind, id = ""] = subjectKey.split(":");
  return kind === "rx"
    ? `/receivers/${id}`
    : kind === "ch"
      ? `/emitters/${id}`
      : "/settings/diagnostics";
}

/** The VAPID public key browsers subscribe with; it lives only in the deployment env. */
export const publicKey = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireOperator(ctx);
    return env.VAPID_PUBLIC_KEY;
  },
});

export const mySubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const subs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_operator", (q) => q.eq("operator", operator._id))
      .take(20);
    return subs.map((s) => ({ endpoint: s.endpoint, createdAt: s.createdAt }));
  },
});

/** Per browser: the endpoint identifies it, so re-subscribing replaces rather than duplicates. */
export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (!args.endpoint.startsWith("https://")) return null;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    const doc = { ...args, operator: operator._id, createdAt: Date.now() };
    if (existing) await ctx.db.replace("pushSubscriptions", existing._id, doc);
    else await ctx.db.insert("pushSubscriptions", doc);
    return null;
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    await requireOperator(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) await ctx.db.delete("pushSubscriptions", existing._id);
    return null;
  },
});

export const forAlert = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, { alertId }) => {
    const alert = await ctx.db.get("alerts", alertId);
    if (!alert) return null;
    return { alert, subscriptions: await ctx.db.query("pushSubscriptions").take(200) };
  },
});

export const drop = internalMutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const s = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (s) await ctx.db.delete("pushSubscriptions", s._id);
    return null;
  },
});

/** One action per critical alert: encrypt and post to every subscribed browser. */
export const send = internalAction({
  args: { alertId: v.id("alerts") },
  returns: v.object({ sent: v.number(), dropped: v.number() }),
  handler: async (ctx, { alertId }): Promise<{ sent: number; dropped: number }> => {
    const data: { alert: Doc<"alerts">; subscriptions: Doc<"pushSubscriptions">[] } | null =
      await ctx.runQuery(internal.push.forAlert, { alertId });
    if (!data) return { sent: 0, dropped: 0 };
    const payload = new TextEncoder().encode(
      JSON.stringify({
        title: data.alert.title,
        body: data.alert.detail,
        url: `${env.SITE_URL}${alertPath(data.alert.subjectKey)}`,
        tag: data.alert._id,
      }),
    );
    let sent = 0;
    let dropped = 0;
    for (const s of data.subscriptions) {
      try {
        const res = await fetch(s.endpoint, {
          method: "POST",
          headers: {
            Authorization: await vapidAuthorization(s.endpoint, {
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKey: env.VAPID_PRIVATE_KEY,
              subject: env.VAPID_SUBJECT,
            }),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Urgency: "high",
          },
          body: (await encryptPayload(payload, { p256dh: s.p256dh, auth: s.auth })) as BodyInit,
        });
        if (res.status === 404 || res.status === 410) {
          await ctx.runMutation(internal.push.drop, { endpoint: s.endpoint });
          dropped++;
        } else if (res.ok) sent++;
      } catch {
        // A push service being down loses this one notification, not the others.
      }
    }
    return { sent, dropped };
  },
});
