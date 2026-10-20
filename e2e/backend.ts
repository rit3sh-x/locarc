// A throwaway open-source Convex backend for the journeys: fresh SQLite + storage under a temp
// dir, its own ports, and the CLI pointed at it as a self-hosted deployment.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const BACKEND_VERSION = "precompiled-2026-10-10-72ce13c";
const ROOT = join(import.meta.dirname, "..");

function ensureBinary(): string {
  const dir = join(homedir(), ".cache", "convex", "binaries", BACKEND_VERSION);
  const bin = join(dir, "convex-local-backend");
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, "backend.zip");
  const asset = "convex-local-backend-x86_64-unknown-linux-gnu.zip";
  execFileSync("curl", [
    "-fsSL",
    "-o",
    zip,
    `https://github.com/get-convex/convex-backend/releases/download/${BACKEND_VERSION}/${asset}`,
  ]);
  execFileSync("unzip", ["-o", zip, "-d", dir]);
  rmSync(zip);
  return bin;
}

export type Backend = {
  url: string;
  siteUrl: string;
  /** Env that points Convex CLI calls at this backend instead of .env.local's deployment. */
  cliEnv: NodeJS.ProcessEnv;
  envFile: string;
  stop: () => void;
};

export async function startBackend(port: number): Promise<Backend> {
  const bin = ensureBinary();
  const dir = mkdtempSync(join(tmpdir(), "locarc-e2e-"));
  const name = "locarc-e2e";
  const secret = randomBytes(32).toString("hex");
  const log = openSync(join(dir, "backend.log"), "a");
  const proc: ChildProcess = spawn(
    bin,
    [
      "--port",
      String(port),
      "--site-proxy-port",
      String(port + 1),
      "--instance-name",
      name,
      "--instance-secret",
      secret,
      "--local-storage",
      join(dir, "storage"),
      "--disable-beacon",
      join(dir, "db.sqlite3"),
    ],
    { stdio: ["ignore", log, log] },
  );
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await (await fetch(`${url}/instance_name`)).text()) === name) break;
    } catch {}
    if (i > 100) throw new Error(`backend did not start; see ${dir}/backend.log`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const adminKey = execFileSync(bin, [
    "keygen",
    "admin-key",
    "--instance-name",
    name,
    "--instance-secret",
    secret,
  ])
    .toString()
    .trim();
  const envFile = join(dir, "convex.env");
  writeFileSync(
    envFile,
    `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`,
  );
  return {
    url,
    siteUrl: `http://127.0.0.1:${port + 1}`,
    cliEnv: {
      ...process.env,
      CONVEX_DEPLOYMENT: "",
      CONVEX_SELF_HOSTED_URL: url,
      CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
    },
    envFile,
    stop: () => {
      proc.kill();
      // E2E_KEEP=1 keeps the backend's data and log for debugging.
      if (process.env.E2E_KEEP) console.log(`Journey backend kept in ${dir}`);
      else rmSync(dir, { recursive: true, force: true });
    },
  };
}

const convexBin = join(ROOT, "node_modules", ".bin", "convex");

/** Runs a Convex CLI command against the throwaway backend. */
export function convexCli(b: Backend, args: string[], input?: string): string {
  return execFileSync(convexBin, args, {
    cwd: ROOT,
    env: b.cliEnv,
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
}

/**
 * Pushes the project's functions with `deploy` (unlike `dev`, it leaves .env.local alone).
 * Codegen and typecheck are off; `bun run verify` owns those.
 */
export function pushFunctions(b: Backend) {
  execFileSync(
    convexBin,
    ["deploy", "--yes", "--env-file", b.envFile, "--typecheck", "disable", "--codegen", "disable"],
    { cwd: ROOT, env: b.cliEnv, stdio: "pipe" },
  );
}
