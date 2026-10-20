import { readFileSync } from "node:fs";
import { api } from "@/convex/_generated/api";
import { scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("scan detail: decoded Readings with cut-short and clipped flags, the board with flags, exports", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const world = await scanningWorld();
  // Library's windows stop after 20 s (past the Fix window); Gate 2 clips at 418.15 MHz.
  world.runner.behaviour[1] = { partialWindowMs: 20_000 };
  world.runner.behaviour[2] = { clipHz: [418.15e6] };
  const faultsFrom = Date.now();
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    await expect
      .poll(async () => (await world.op.query(api.emitters.board, {}))?.at ?? 0, {
        timeout: 180_000,
      })
      .toBeGreaterThan(faultsFrom);
    const board = await world.op.query(api.emitters.board, {});
    const scanDoc = await world.op.query(api.scans.list, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    const latest = scanDoc.page.find((s) => s.startsAt === board?.at);
    const run = latest?.runNumber;
    const k = (latest?.k ?? 0) + 1;

    await page.goto("/scans");
    await page
      .getByRole("link", { name: `Scan ${k}`, exact: true })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: `Run ${run} · Scan ${k}` })).toBeVisible();

    const readings = page.getByTestId("scan-readings").getByRole("listitem");
    await expect(readings).toHaveCount(4);
    await expect(readings.filter({ hasText: "Library" })).toContainText(
      "cut short at 20 s · DETACHED",
    );
    await expect(readings.filter({ hasText: "Gate 2" })).toContainText("clipped 1 slice");
    await readings.filter({ hasText: "Gate 2" }).locator("summary").click();
    await expect(readings.filter({ hasText: "Gate 2" })).toContainText("(clipped)");
    // 418.15 MHz: Gate 2's clipped power is left out, so 3 Receivers locate it.
    await expect(
      page.getByTestId("scan-emitters").getByRole("row").filter({ hasText: "418.1500 MHz" }),
    ).toContainText("3 Receivers");

    const [json] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export JSON" }).click(),
    ]);
    const exported = JSON.parse(readFileSync(await json.path(), "utf8"));
    expect(exported.scan).toMatchObject({ runNumber: run, number: k });
    expect(exported.readings).toHaveLength(4);
    expect(exported.readings.find((r: { partial: boolean }) => r.partial).windowMs).toBe(20_000);
    expect(exported.board.length).toBeGreaterThan(0);

    const [csv] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export Emitters CSV" }).click(),
    ]);
    const lines = readFileSync(await csv.path(), "utf8")
      .trim()
      .split("\n");
    expect(lines[0]).toMatch(/^freq_mhz,span_khz,heard,used,located/);
    expect(lines).toHaveLength(exported.board.length + 1);
    noErrors();
  } finally {
    world.runner.behaviour[1] = {};
    world.runner.behaviour[2] = {};
    world.stop();
  }
});
