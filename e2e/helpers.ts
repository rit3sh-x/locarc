import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");

export const OPERATOR = {
  org: "Journey Org",
  name: "First Operator",
  email: "first@example.com",
  password: "journey-password-1",
};

/** Env that points the Convex CLI (and our scripts) at the journeys' backend. */
export function backendEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CONVEX_DEPLOYMENT: "",
    CONVEX_SELF_HOSTED_URL: process.env.E2E_CONVEX_URL,
    CONVEX_SELF_HOSTED_ADMIN_KEY: process.env.E2E_ADMIN_KEY,
    ...extra,
  };
}

export function runSetup(): string {
  return execFileSync("bun", ["scripts/setup.ts"], {
    cwd: ROOT,
    env: backendEnv({
      LOCARC_ORG_NAME: OPERATOR.org,
      LOCARC_OPERATOR_NAME: OPERATOR.name,
      LOCARC_OPERATOR_EMAIL: OPERATOR.email,
      LOCARC_OPERATOR_PASSWORD: OPERATOR.password,
    }),
    stdio: "pipe",
  }).toString();
}

/** Admin call through the Convex CLI (internal functions included). */
export function run(fn: string, args: object = {}): unknown {
  const out = execFileSync(
    join(ROOT, "node_modules", ".bin", "convex"),
    ["run", fn, JSON.stringify(args)],
    { cwd: ROOT, env: backendEnv(), stdio: "pipe" },
  ).toString();
  return out.trim() === "" ? null : JSON.parse(out);
}

/** Makes the Organization exist, so any journey can run on its own. */
export function ensureSetUp() {
  try {
    runSetup();
  } catch (e) {
    if (!String((e as { stderr?: Buffer }).stderr).includes("ALREADY_SET_UP")) throw e;
  }
}

export async function signIn(page: Page, email = OPERATOR.email, password = OPERATOR.password) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("org-name")).not.toBeEmpty();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

const NOISE = [/tiles\.openfreemap\.org/, /fonts?\b.*\.woff2/];

/** Collects page errors and console errors; call the returned check at the end of a journey. */
export function watchConsole(page: Page, allow: RegExp[] = []) {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    if (!allow.some((r) => r.test(e.message))) errors.push(`pageerror: ${e.message}`);
  });

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = `${m.text()} ${m.location().url}`;
    if (![...NOISE, ...allow].some((r) => r.test(text))) errors.push(text);
  });
  return () => expect(errors, "console and page errors").toEqual([]);
}
