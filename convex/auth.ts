import { type AuthFunctions, createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";
import authConfig from "./auth.config";
import { sha256Hex } from "./lib/crypto";
import { fail } from "./lib/errors";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      // Sign-up only gets here after the invite hook passed; consuming the invite in the
      // same transaction as the user insert makes each invite good for exactly one account.
      onCreate: async (ctx, user) => {
        const now = Date.now();
        const invites = await ctx.db
          .query("invites")
          .withIndex("by_email", (q) => q.eq("email", user.email))
          .order("desc")
          .take(20);
        const invite = invites.find((i) => i.usedAt === null && i.expiresAt > now);
        if (!invite) fail("INVITE_INVALID");
        await ctx.db.patch("invites", invite._id, { usedAt: now });
        await ctx.db.insert("operators", { userId: user._id, name: user.name, email: user.email });
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  opts: { onResetToken?: (token: string) => void } = {},
) =>
  betterAuth({
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.SITE_URL],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 3600,
      // Nothing is emailed: the token goes back to whoever asked for the link.
      sendResetPassword: async ({ token }) => opts.onResetToken?.(token),
    },
    hooks: {
      before: createAuthMiddleware(async (c) => {
        if (c.path !== "/sign-up/email") return;
        const token = c.headers?.get("x-invite-token") ?? "";
        const email = String(c.body?.email ?? "")
          .trim()
          .toLowerCase();
        const valid =
          token !== "" &&
          "runQuery" in ctx &&
          (await ctx.runQuery(internal.team.inviteIsValid, {
            tokenHash: await sha256Hex(token),
            email,
            now: Date.now(),
          }));
        if (!valid) {
          throw new APIError("FORBIDDEN", {
            message: "This invite link is invalid or has expired.",
          });
        }
      }),
    },
    plugins: [convex({ authConfig })],
  });
