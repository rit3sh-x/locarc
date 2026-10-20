import { readFileSync } from "node:fs";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

// Dev and preview play the Worker's part: /api/auth goes to the Convex site URL, same-origin.
function authProxy(siteUrl: string): Record<string, ProxyOptions> {
  return {
    "/api/auth": {
      target: siteUrl,
      changeOrigin: true,
      configure: (proxy) =>
        proxy.on("proxyReq", (req, incoming) => {
          req.setHeader("x-better-auth-forwarded-host", incoming.headers.host ?? "");
          req.setHeader("x-better-auth-forwarded-proto", "http");
        }),
    },
  };
}

function previewHeaders(convexUrl: string | undefined): Record<string, string> {
  const block = readFileSync("public/_headers", "utf8").split(/\n(?=\S)/)[0] ?? "";
  const headers = Object.fromEntries(
    block
      .split("\n")
      .slice(1)
      .map(
        (line) =>
          line
            .trim()
            .split(/:\s(.*)/s)
            .slice(0, 2) as [string, string],
      )
      .filter(([name]) => name),
  );
  const csp = headers["Content-Security-Policy"];
  if (csp && convexUrl) {
    const origin = new URL(convexUrl);
    const ws = `${origin.protocol === "https:" ? "wss" : "ws"}://${origin.host}`;
    headers["Content-Security-Policy"] = csp.replace(
      "connect-src 'self'",
      `connect-src 'self' ${origin.origin} ${ws}`,
    );
  }
  return headers;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const proxy = authProxy(env.VITE_CONVEX_SITE_URL ?? "http://127.0.0.1:3211");
  return {
    plugins: [react(), tailwind()],
    resolve: { tsconfigPaths: true },
    worker: { format: "es" as const },

    server: {
      port: Number(process.env.PORT ?? 5173),
      strictPort: true,
      proxy,
    },
    preview: {
      port: Number(process.env.PORT ?? 4173),
      strictPort: true,
      proxy,
      headers: previewHeaders(env.VITE_CONVEX_URL),
    },
  };
});
