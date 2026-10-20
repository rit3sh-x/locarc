import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { ensureFleet } from "../fleet";
import { backendEnv, signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

const publish = (apk: string, versionCode: number) =>
  spawnSync(
    "bun",
    [
      "scripts/publish-release.ts",
      "--apk",
      apk,
      "--version-code",
      String(versionCode),
      "--version-name",
      `1.${versionCode}`,
      "--commit",
      "journey15",
    ],
    { cwd: join(import.meta.dirname, "../.."), env: backendEnv(), encoding: "utf8" },
  );

test("releases: the publish script records a candidate; the checklist gates Promote; Receivers are told", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const sims = await ensureFleet();
  try {
    for (const s of sims) await s.sync({ sentAt: Date.now(), heartbeat: healthyHeartbeat() });
    const apk = info.outputPath("app-release.apk");
    const bytes = `not really an APK ${Date.now()}`;
    writeFileSync(apk, bytes);
    const published = publish(apk, 101);
    expect(published.status, published.stderr).toBe(0);
    expect(published.stdout).toContain("Candidate 1.101 (101) recorded");

    const noErrors = watchConsole(page);
    await signIn(page);
    await page.goto("/settings/releases");
    const candidate = page.getByRole("region", { name: "Candidate" });
    await expect(candidate).toContainText("1.101 (101)");
    await expect(candidate).toContainText("journey15");
    const promote = candidate.getByRole("button", { name: "Promote" });
    await expect(promote).toBeDisabled();
    for (const box of await candidate.getByRole("checkbox").all()) await box.check();
    await promote.click();

    await expect(page.getByRole("region", { name: "Candidate" })).toContainText("No candidate");
    const promoted = page.getByRole("region", { name: "Promoted" });
    await expect(promoted).toContainText("Current1.101 (101)");
    await expect(promoted).toContainText("by First Operator");
    const download = await promoted
      .getByRole("link", { name: "Download APK" })
      .getAttribute("href");
    expect(await (await page.request.get(download ?? "")).text()).toBe(bytes);

    const [phone] = sims;
    if (!phone) throw new Error("no simulated Receiver");
    await expect.poll(() => phone.control?.release?.versionCode).toBe(101);
    const rollout = page.getByTestId("rollout").getByRole("listitem");
    await expect(rollout.filter({ hasText: phone.name })).toContainText("Update available");
    await phone.sync({
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat({ appVersion: "1.101", appVersionCode: 101 }),
    });
    await expect(rollout.filter({ hasText: phone.name })).toContainText("Up to date");

    const refused = publish(apk, 101);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("isn't newer than the promoted 101");

    writeFileSync(apk, `${bytes} again`);
    expect(publish(apk, 102).status).toBe(0);
    await expect(candidate).toContainText("1.102 (102)");
    await candidate.getByRole("button", { name: "Discard candidate" }).click();
    await expect(candidate).toContainText("No candidate");

    await page.getByRole("link", { name: "Receivers" }).click();
    const matrix = page.getByTestId("receiver-matrix").getByRole("row");
    await expect(matrix.filter({ hasText: sims[1]?.name ?? "" })).toContainText("Update available");
    await expect(matrix.filter({ hasText: phone.name })).not.toContainText("Update available");
    noErrors();
  } finally {
    for (const s of sims) s.close();
  }
});
