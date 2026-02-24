import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-utils";
import type { Route } from "next";

const AUTH_ROUTE_PREFIXES: Route[] = ["/login", "/sign-up"];

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const isAuthRoute = AUTH_ROUTE_PREFIXES.some((route) =>
        pathname.startsWith(route)
    );

    const session = await getSession();

    if (session) {
        const url = request.nextUrl.clone();

        if (isAuthRoute) {
            url.pathname = session.user.role === "ADMIN" ? "/map" : "/";
            return NextResponse.redirect(url);
        }
    }

    if (!session && !isAuthRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
    }

    return NextResponse.next({
        request,
    });
}

export const config = {
    matcher: [
        "/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml|json|woff2?|ttf|eot|mp4|webm)).*)",
    ],
};
