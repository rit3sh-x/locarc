import { createAuthClient } from "better-auth/react";
import {
    adminClient,
    usernameClient,
    inferAdditionalFields,
    customSessionClient,
} from "better-auth/client/plugins";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import type { Auth } from "@backend/types";

export const authClient = createAuthClient({
    plugins: [
        customSessionClient<Auth>(),
        inferAdditionalFields<Auth>(),
        usernameClient(),
        adminClient(),
        convexClient(),
    ],
});
