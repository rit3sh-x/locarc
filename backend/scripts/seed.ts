import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SECRETS: Record<string, string | undefined> = {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    MOBILE_SCHEME: process.env.MOBILE_SCHEME,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    SITE_URL: process.env.SITE_URL,
    COMPUTE_SERVICE_URL: process.env.COMPUTE_SERVICE_URL,
};

const isProd = process.argv.slice(2).includes("--prod");

function convex(...args: string[]) {
    const result = spawnSync("pnpm", ["exec", "convex", ...args], {
        stdio: "inherit",
        shell: false,
    });
    if (result.status !== 0) throw new Error(`convex ${args.join(" ")} failed`);
}

console.log(`Seeding ${isProd ? "PRODUCTION" : "DEVELOPMENT"}...`);

for (const [name, value] of Object.entries(SECRETS)) {
    if (!value) {
        console.warn(`Skipping ${name}: not set`);
        continue;
    }

    const args = ["env", "set", "--force", name, value];
    if (isProd) args.push("--prod");

    try {
        convex(...args);
    } catch {
        console.error(`Failed to set ${name}`);
    }
}
