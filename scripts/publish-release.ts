// Usage: bun run publish:release -- --apk app-release.apk --version-code 102 --version-name 1.2.0
//   [--commit <sha>] [--notes "..."] [--min-supported 100]
//
// Upload a CI-built APK to Convex file storage and register it as a release
// candidate. The target deployment is determined by the Convex CLI credentials:
// CONVEX_DEPLOY_KEY in CI, or the self-hosted backend's admin key in E2E tests.
// Promote candidates to production through Settings → Releases.
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { $ } from "bun";

const { values } = parseArgs({
  options: {
    apk: { type: "string" },
    "version-code": { type: "string" },
    "version-name": { type: "string" },
    commit: { type: "string", default: process.env.GITHUB_SHA ?? "local" },
    notes: { type: "string", default: "" },
    "min-supported": { type: "string" },
  },
});
const apk = values.apk;
const versionCode = Number(values["version-code"]);
const versionName = values["version-name"];
if (!apk || !Number.isInteger(versionCode) || !versionName) {
  console.error(
    "usage: --apk <file> --version-code <int> --version-name <name> [--commit] [--notes] [--min-supported]",
  );
  process.exit(1);
}

const bytes = readFileSync(apk);
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const size = statSync(apk).size;
const run = async (fn: string, args: object) =>
  JSON.parse((await $`bunx convex run ${fn} ${JSON.stringify(args)}`.quiet().text()).trim());

const uploadUrl: string = await run("releases:generateUploadUrl", {});
const upload = await fetch(uploadUrl, {
  method: "POST",
  headers: { "Content-Type": "application/vnd.android.package-archive" },
  body: bytes,
});
if (!upload.ok) throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
const { storageId } = (await upload.json()) as { storageId: string };

const recorded = await run("releases:recordCandidate", {
  versionCode,
  versionName,
  commit: values.commit,
  sha256,
  size,
  storageId,
  notes: values.notes,
  minSupported: values["min-supported"] ? Number(values["min-supported"]) : null,
});
if (!recorded.ok) {
  console.error(`Refused: ${recorded.reason}`);
  process.exit(1);
}
console.log(
  `Candidate ${versionName} (${versionCode}) recorded: ${recorded.id}, ${size} bytes, sha256 ${sha256}`,
);
