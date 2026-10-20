import type { Browser, Page } from "@playwright/test";
import { scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { blockTiles, expect, test } from "../test";

async function secondPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await blockTiles(context);
  return await context.newPage();
}

test("organization config: sweep plan, diff confirm, timeline, restore, conflict", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const world = await scanningWorld();
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    await page.goto("/settings/organization");

    await page.getByRole("button", { name: /^Sweep plan: / }).click();
    const effects = page.getByTestId("sweep-effects");
    await expect(effects).toContainText("1,090 MHz · 0.15 s per pass");
    await page.getByRole("button", { name: "Full 1 MHz–6 GHz", exact: true }).click();
    await expect(effects).toContainText("5,999 MHz · 0.81 s per pass");
    await page.getByRole("button", { name: "Bug bands", exact: true }).click();
    // Overlapping segments are refused before anything is saved.
    await page.getByLabel("Segment 4 Start (MHz)").fill("100");
    await expect(page.getByRole("alert")).toContainText("must not overlap");
    await page.getByLabel("Segment 4 Start (MHz)").fill("300");
    await page.getByLabel("Segment 4 End (MHz)").fill("520");
    await expect(effects).toContainText("1,110 MHz");
    await page.getByRole("button", { name: "Save…" }).click();
    const confirm = page.getByRole("dialog", { name: "Save sweep plan?" });
    await expect(confirm).toContainText(
      "Sweep plan: Bug bands · 8 segments · 1,090 MHz → 8 segments · 1,110 MHz",
    );
    await expect(confirm).toContainText(
      /Ends Run (\d+) now; the Scan in progress is discarded\. Run \d+ starts at \d\d:\d\d\./,
    );
    await confirm.getByRole("button", { name: "Save" }).click();
    const timeline = page.getByTestId("config-timeline").getByRole("listitem");
    await expect(timeline.first()).toContainText(
      "Sweep plan: Bug bands · 8 segments · 1,090 MHz → 8 segments · 1,110 MHz",
    );
    await expect(timeline.first()).toContainText(/started Run \d+/);

    await timeline
      .filter({ hasText: "Initial configuration" })
      .getByRole("button", { name: "Restore…" })
      .click();
    const restore = page.getByRole("dialog", { name: "Restore v1?" });
    await expect(restore).toContainText(
      "Sweep plan: 8 segments · 1,110 MHz → Bug bands · 8 segments · 1,090 MHz",
    );
    // Restore brings back all of v1, its cadence too; later journeys re-arm their burst.
    await expect(restore).toContainText(/Cadence: .+ → every 15 min/);

    await restore.getByRole("button", { name: "Restore" }).click();
    await expect(timeline.first()).toContainText("Restored v1");

    // A teammate's tab opens the environment editor, then this tab saves first.
    const other = await secondPage(browser);
    await signIn(other);
    await other.goto("/settings/organization");
    await other.getByRole("button", { name: /^Propagation environment: / }).click();
    await other.getByLabel(/^Environment/).selectOption("dense");
    await other.getByRole("button", { name: "Save…" }).click();

    await page.getByRole("button", { name: /^Propagation environment: / }).click();
    await page.getByLabel(/^Environment/).selectOption("open");
    await page.getByRole("button", { name: "Save…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(timeline.first()).toContainText("Urban (n 3.5) → Open (n 2.2)");

    const stale = other.getByRole("dialog");
    await stale.getByRole("button", { name: "Save" }).click();
    await expect(stale.getByRole("alert")).toContainText("A teammate saved");
    await expect(stale).toContainText("Open (n 2.2) → Dense/indoor (n 3.9)");
    await stale.getByRole("button", { name: "Save" }).click();
    await expect(timeline.first()).toContainText("Open (n 2.2) → Dense/indoor (n 3.9)");

    // Leave the defaults for the journeys after this one.
    await page.getByRole("button", { name: /^Propagation environment: / }).click();
    await page.getByRole("button", { name: "Reset to default" }).click();
    await page.getByRole("button", { name: "Save…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(timeline.first()).toContainText("→ Urban (n 3.5)");
    noErrors();
  } finally {
    world.stop();
  }
});
