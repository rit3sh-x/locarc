// Usage: bun run setup [--prod] [--reset-password]
//
// Configure a Convex deployment using LOCARC_* values from .env.local, filling in
// any missing deployment environment variables (a dev deployment keeps its secrets in
// .env.local too). Deploy the functions and create the Organization and initial
// Operator, or reset the Operator's password with --reset-password.
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { generateDeploymentEnv, toDotenv } from "./lib/deploymentEnv";

const prod = process.argv.includes("--prod");
const resetPassword = process.argv.includes("--reset-password");
const target = prod ? ["--prod"] : [];

function need(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Set ${key} in .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

// Turns on the tracked pre-push hook (the fast checks); a no-op outside a git checkout.
await $`git config core.hooksPath .githooks`.nothrow().quiet();

const email = need("LOCARC_OPERATOR_EMAIL");

const password = need("LOCARC_OPERATOR_PASSWORD");

if (resetPassword) {
  await $`bunx convex run ${target} setup:resetPassword ${JSON.stringify({ email, password })}`;
  console.log(`Password reset for ${email}.`);
  process.exit(0);
}

// A fresh clone has no deployment yet: `convex dev` configures one (interactively) and writes
// .env.local. Its first push may fail on the env vars set below; the push after them retries.
if (!prod && !process.env.CONVEX_SELF_HOSTED_URL && !process.env.CONVEX_DEPLOYMENT) {
  await Bun.spawn(["bunx", "convex", "dev", "--once", "--typecheck", "disable"], {
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;
}

// Production's SITE_URL must be the real website origin; localhost there breaks sign-in.
const siteUrl = prod
  ? need("LOCARC_SITE_URL")
  : (process.env.LOCARC_SITE_URL ?? "http://localhost:5173");

const deployed: Record<string, string> = Object.fromEntries(
  (await $`bunx convex env list --include-values ${target}`.text())
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/s, "$2")];
    }),
);
const fresh = await generateDeploymentEnv(siteUrl);
// SITE_URL and VAPID_SUBJECT follow the site; the rest are secrets. A dev deployment's secrets
// live in .env.local, the one env file: its value wins, then the deployment's, then a fresh one.
// Production's and the journeys' stay on their deployment only.
const keepLocal = !prod && !process.env.CONVEX_SELF_HOSTED_URL;
const secrets = Object.keys(fresh).filter((k) => k !== "SITE_URL" && k !== "VAPID_SUBJECT");
const wanted = Object.fromEntries(
  Object.entries(fresh).map(([k, v]) => [
    k,
    (keepLocal && secrets.includes(k) && process.env[k]) || deployed[k] || v,
  ]),
);
const changed = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => deployed[k] !== v));
if (Object.keys(changed).length > 0) {
  const file = join(tmpdir(), `locarc-env-${process.pid}`);
  writeFileSync(file, toDotenv(changed), { mode: 0o600 });
  try {
    await $`bunx convex env set ${target} --force --from-file ${file}`.quiet();
  } finally {
    rmSync(file);
  }
  console.log(`Set ${Object.keys(changed).join(", ")}.`);
}
const unsaved = keepLocal ? secrets.filter((k) => !process.env[k]) : [];
if (unsaved.length > 0) {
  const lines = toDotenv(Object.fromEntries(unsaved.map((k) => [k, wanted[k] ?? ""])));
  appendFileSync(
    join(import.meta.dir, "../.env.local"),
    `\n# The dev deployment's secrets; \`bun run setup\` keeps the deployment in step with them.\n${lines}\n`,
  );
  console.log(`Saved ${unsaved.join(", ")} to .env.local.`);
}

// Self-hosted backends (the journeys' throwaway one) get `deploy`, which leaves .env.local alone.
if (process.env.CONVEX_SELF_HOSTED_URL) {
  await $`bunx convex deploy --yes --typecheck disable --codegen disable`.quiet();
} else if (prod) {
  // A fresh production has no functions yet, and CI can't deploy them before the env vars exist.
  await $`bunx convex deploy --yes`;
} else {
  await $`bunx convex dev --once`;
}

const args = {
  orgName: need("LOCARC_ORG_NAME"),
  name: need("LOCARC_OPERATOR_NAME"),
  email,
  password,
};
await $`bunx convex run ${target} setup:init ${JSON.stringify(args)}`;
console.log(`Organization "${args.orgName}" is ready. Sign in as ${email}.`);
