import { query } from "../_generated/server";
import { authComponent } from "../betterAuth/auth";

export const getUser = query({
    args: {},
    handler: async (ctx) => {
        try {
            const user = await authComponent.getAuthUser(ctx);
            return user;
        } catch {
            return null;
        }
    },
});
