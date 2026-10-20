// bun run build:android [release]
// The Android build, run the same way here and in CI (.github/workflows/android.yml).
// Default: ktlint, the :core JVM tests and a debug APK. `release`: the signed release APK, from
// LOCARC_KEYSTORE_FILE (or LOCARC_KEYSTORE_BASE64), LOCARC_KEYSTORE_PASSWORD, LOCARC_KEY_ALIAS and
// LOCARC_KEY_PASSWORD, with VERSION_CODE, VERSION_NAME and CONVEX_URL when set.
// Needs JDK 17 and the Android SDK; without them, push and take the `app-debug` artifact from CI.
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!process.env.JAVA_HOME && !Bun.which("java")) {
  fail("No JDK found: install JDK 17, or push and take the `app-debug` artifact from CI.");
}
const gradle = (args: string[], env: Record<string, string> = {}) =>
  $`./gradlew ${args}`.cwd(join(import.meta.dir, "../android")).env({ ...process.env, ...env });

if (!process.argv.includes("release")) {
  await gradle(["ktlintCheck", ":core:test", "assembleDebug"]);
  console.log("APK: android/app/build/outputs/apk/debug/app-debug.apk");
  process.exit(0);
}

// CI holds the keystore as base64; it only touches disk for the length of the build.
let keystore = process.env.LOCARC_KEYSTORE_FILE;
let temporary: string | undefined;
if (!keystore && process.env.LOCARC_KEYSTORE_BASE64) {
  temporary = keystore = join(tmpdir(), `locarc-upload-${process.pid}.jks`);
  writeFileSync(keystore, Buffer.from(process.env.LOCARC_KEYSTORE_BASE64, "base64"), {
    mode: 0o600,
  });
}
if (!keystore) fail("A release build needs LOCARC_KEYSTORE_FILE or LOCARC_KEYSTORE_BASE64.");
try {
  await gradle(
    [
      "assembleRelease",
      `-PversionCode=${process.env.VERSION_CODE ?? "1"}`,
      `-PversionName=${process.env.VERSION_NAME ?? "dev"}`,
      `-PdeploymentUrl=${process.env.CONVEX_URL ?? ""}`,
    ],
    { LOCARC_KEYSTORE_FILE: keystore },
  );
} finally {
  if (temporary) rmSync(temporary, { force: true });
}
console.log("APK: android/app/build/outputs/apk/release/app-release.apk");
