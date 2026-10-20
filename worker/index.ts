// The only Worker code: a same-origin pass-through for better-auth. Everything else is static
// assets with SPA fallback.
interface Env {
  CONVEX_SITE_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/auth/")) return new Response("Not found", { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("x-better-auth-forwarded-host", url.host);
    headers.set("x-better-auth-forwarded-proto", url.protocol.replace(/:$/, ""));
    return fetch(`${env.CONVEX_SITE_URL}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  },
};
