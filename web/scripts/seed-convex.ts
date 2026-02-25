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

const isProd = process.argv.slice(2).includes("--prod");
const envFlag = isProd ? "--prod" : "";

console.log(`🚀 Importing secrets to ${isProd ? "PRODUCTION" : "DEVELOPMENT"}...`);

for (const key of KEYS) {
    const value = process.env[key];
    if (!value) {
        console.warn(`⚠️ Skipping ${key}: Not found in .env files`);
        continue;
    }

    try {
        execSync(
            `pnpm dlx convex env set ${key} "${value.replace(/"/g, '\\"')}" ${envFlag}`,
            { stdio: "inherit" }
        );
    } catch {
        console.error(`❌ Failed to set ${key}`);
    }
}