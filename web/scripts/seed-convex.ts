import dotenv from "dotenv";
import { execSync } from "node:child_process";

const KEYS = [
    "BETTER_AUTH_SECRET",
    "SITE_URL",
    "MOBILE_SCHEME",
    "WEBHOOK_SECRET",
    "COMPUTE_SERVICE_URL",
];

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

for (const key of KEYS) {
    const value = process.env[key];
    if (!value) continue;

    execSync(
        `pnpm dlx convex env set ${key} "${value.replace(/"/g, '\\"')}"`,
        { stdio: "inherit" }
    );
}