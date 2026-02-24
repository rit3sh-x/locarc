"use client";

import {
    type AuthClient,
    ConvexBetterAuthProvider,
} from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "@/lib/auth-client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({
    children,
    initialToken,
}: {
    children: React.ReactNode;
    initialToken?: string | null;
}): React.JSX.Element {
    return (
        <ConvexBetterAuthProvider
            client={convex}
            authClient={authClient as unknown as AuthClient}
            initialToken={initialToken}
        >
            {children}
        </ConvexBetterAuthProvider>
    );
}
