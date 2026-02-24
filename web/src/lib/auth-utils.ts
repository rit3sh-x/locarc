import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { api } from "@backend/api";
import type { UserRole } from "@/types";
import { getToken } from "./auth-server";

export const getSession = async () => {
    const authToken = await getToken();

    if (!authToken) return null;

    const session = await fetchQuery(
        api.auth.user.getSession,
        {},
        { token: authToken }
    );

    if (!session) return null;

    return {
        ...session,
        authToken,
    };
};

export const requireAuth = async () => {
    const session = await getSession();

    if (!session) {
        redirect("/login");
    }

    return session;
};

export const requireNoAuth = async () => {
    const session = await getSession();

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
