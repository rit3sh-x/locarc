import { query } from "../_generated/server";
import { authComponent, createAuth } from "../betterAuth/auth";

export const getSession = query({
    args: {},
    handler: async (ctx) => {
        const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
        const session = await auth.api.getSession({
            headers,
        });
        return session;
    },
});
