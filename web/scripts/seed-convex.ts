import "dotenv/config";
import { execSync } from "node:child_process";

const KEYS = [
    "BETTER_AUTH_SECRET",
    "SITE_URL",
    "MOBILE_SCHEME",
    "WEBHOOK_SECRET",
    "COMPUTE_SERVICE_URL",
];

for (const key of KEYS) {
    const value = process.env[key];
    if (!value) throw new Error(`Missing ${key} in .env`);

    execSync(`pnpm dlx convex env set ${key} "${value.replace(/"/g, '\\"')}"`, {
        stdio: "inherit",
    });
}
