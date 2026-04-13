import { createClient, type AuthFunctions } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import schema from "./schema";
import {
    admin,
    username,
    customSession,
} from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { expo } from "@better-auth/expo";
import { ROLES, ROLE_VALUES, ac, ROLE_MAP } from "../lib/roles";
import { APIError } from "better-auth/api";
import { customOptions } from "./options";
import { CONTROLLER_EMAIL_SUFFIX } from "../lib/constants";

const siteUrl = process.env.SITE_URL!;
const mobileScheme = process.env.MOBILE_SCHEME!;

const authFunctions: AuthFunctions = internal.triggers;

export const authComponent = createClient<DataModel, typeof schema>(
    components.betterAuth,
    {
        authFunctions,
        local: { schema },
        verbose: false,
        triggers: {
            user: {
                onCreate: async (ctx, doc) => {
                    if (doc.organizationSlug && doc.role === "ADMIN") {
                        await ctx.runMutation(
                            internal.private.settings.createForOrg,
                            { orgSlug: doc.organizationSlug }
                        );
                    }
                },
            },
        },
    },
);

export const { onCreate, onDelete, onUpdate } = authComponent.triggersApi();

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
    return {
        appName: "LocArc",
        baseURL: siteUrl,
        trustedOrigins: [siteUrl, mobileScheme],
        database: authComponent.adapter(ctx),
        emailAndPassword: {
            enabled: true,
            autoSignIn: true,
            requireEmailVerification: false,
        },
        advanced: {
            cookiePrefix: "locarc",
        },
        user: {
            additionalFields: {
                organizationSlug: {
                    type: "string",
                    input: true,
                    required: true,
                },
                started: {
                    type: "boolean",
                    input: false,
                    required: true,
                    defaultValue: false,
                },
                role: {
                    type: ROLE_VALUES,
                    defaultValue: ROLES.USER,
                    input: false,
                    required: true,
                },
            },
        },
        plugins: [
            expo(),
            convex({
                authConfig,
                jwksRotateOnTokenGenerationError: true,
            }),
            crossDomain({ siteUrl }),
            username({
                maxUsernameLength: 20,
                minUsernameLength: 3,
                usernameNormalization: false,
            }),
            admin({
                ac,
                adminRoles: ROLES.ADMIN,
                defaultRole: ROLES.USER,
                roles: ROLE_MAP,
            }),
            customSession(async ({ user, session }) => {
                const username = user.username;
                if (!username) {
                    throw new APIError("BAD_REQUEST", {
                        message: "No such user exists",
                    });
                }

                return {
                    user: {
                        ...user,
                        role: user.role as keyof typeof ROLES,
                        banned: user.banned ?? false,
                        username,
                    },
                    session,
                };
            }, customOptions),
        ],
        hooks: {
            before: createAuthMiddleware(async ({ path, context, body }) => {
                if (path === "/sign-up/email") {
                    if (!body.username || typeof body.username !== "string" || body.username.trim() === "") {
                        throw new APIError("BAD_REQUEST", {
                            message: "Username is required for signup.",
                        });
                    }
                }

                if (path === "/sign-in/email") {
                    const identifier = body.email as string;
                    const isEmail = identifier.endsWith(CONTROLLER_EMAIL_SUFFIX);

                    if (isEmail) {
                        throw new APIError("FORBIDDEN", {
                            message:
                                "Email login is restricted to administrators. Please use username login.",
                        });
                    }
                }
            }),
        },
        databaseHooks: {
            user: {
                create: {
                    before: async (user) => {
                        return {
                            data: {
                                ...user,
                                role: ROLES.ADMIN,
                                emailVerified: true,
                                banned: false,
                                started: false,
                            },
                        };
                    },
                },
            },
        },
    } satisfies BetterAuthOptions;
};

export const options = createAuthOptions({} as GenericCtx<DataModel>);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
    return betterAuth(createAuthOptions(ctx));
};

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
