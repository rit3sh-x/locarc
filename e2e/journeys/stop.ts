import { api } from "@/convex/_generated/api";
import { FleetRunner } from "@/scripts/sim/runner";
import { ensureFleet, ensureMinuteRun, FLEET_POSITIONS, operatorClient } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("stop: the confirm names the Run and the discarded Scan; Receivers go Idle", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const sims = await ensureFleet();
  const runner = new FleetRunner(sims, FLEET_POSITIONS);
  // One phone goes quiet (after checking in, so it's still expected): a Scan is then still
  // collecting when Stop is pressed.
  const quiet = sims.length - 1;
  await runner.start();
  runner.behaviour[quiet] = { offline: true };

  try {
    const op = await operatorClient();
    await ensureMinuteRun(op);

    const noErrors = watchConsole(page);
    await signIn(page);
    await expect(page.getByTestId("scan-summary")).toContainText(
      `${sims.length - 1} of ${sims.length} reported`,
      { timeout: 180_000 },
    );
    const run = (await op.query(api.live.run, {})).run?.number;

    await page.getByRole("button", { name: "Scan control" }).click();
    await page.getByRole("button", { name: "Stop…" }).click();
    const confirm = page.getByRole("dialog", { name: `Stop Run ${run}?` });
    await expect(confirm).toContainText(`Ends Run ${run} now.`);
    await expect(confirm).toContainText(/Scan \d+ is still collecting and is discarded\./);
    runner.behaviour[quiet] = {};
    await confirm.getByRole("button", { name: "Stop scanning" }).click();

    await expect(page.getByTestId("scan-summary")).toHaveText("Not scanning");
    for (const row of await page.getByTestId("fleet-table").getByRole("row").all()) {
      if (await row.getByRole("cell").count()) await expect(row).toContainText("Idle");
    }
    await expect(page.getByTestId("scan-strip")).toContainText(`Run ${run} ended`);
    noErrors();
  } finally {
    runner.stop();
    for (const s of sims) s.close();
  }
});
