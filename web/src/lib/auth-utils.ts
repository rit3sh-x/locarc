import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { api } from "@backend/api";
import type { UserRole } from "@/types";
import { getToken } from "./auth-server";

export const getUser = async () => {
    const authToken = await getToken();

    if (!authToken) return null;

    const user = await fetchQuery(
        api.auth.user.getUser,
        {},
        { token: authToken }
    );

    if (!user) return null;

    return {
        user,
        authToken,
    };
};

export const requireAuth = async () => {
    const session = await getUser();

    if (!session) {
        redirect("/login");
    }

    return session;
};

export const requireNoAuth = async () => {
    const session = await getUser();

    if (session) {
        redirect("/");
    }
};

const requireRole =
    <R extends UserRole>(allowedRole: R) =>
        async () => {
            const session = await requireAuth();

            if (session.user.role !== allowedRole) {
                if (session.user.role === "ADMIN") {
                    redirect("/map");
                } else {
                    redirect("/");
                }
            }

            return session as typeof session & {
                user: { role: R };
            };
        };

export const requireAdmin = requireRole("ADMIN");
export const requireUser = requireRole("USER");
