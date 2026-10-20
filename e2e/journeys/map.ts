import { api } from "@/convex/_generated/api";
import { scanningWorld } from "../fleet";

import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("map: the scrubber shows where Emitters were, snaps back to live, and filters", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const world = await scanningWorld();
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    await page.goto("/map");
    const fixes = page.getByTestId("map-emitters").getByRole("listitem");
    // Two boards, so there is an older moment to go back to.
    await expect(fixes.first()).toBeVisible({ timeout: 200_000 });
    const first = Number(await fixes.first().getAttribute("data-at"));
    await expect
      .poll(async () => Number(await fixes.first().getAttribute("data-at")), { timeout: 200_000 })
      .toBeGreaterThan(first);
    const latest = Number(await fixes.first().getAttribute("data-at"));
    // One scrubber step is a minute; land mid-way between the two Scans.
    await page.waitForTimeout(Math.max(0, latest + 15_000 - Date.now()));

    const scrubber = page.getByRole("slider", { name: "Time scrubber" });
    await scrubber.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("map-time")).not.toHaveText("Live");
    await expect(page).toHaveURL(/[?&]at=\d+/);
    await expect(fixes.first()).toBeVisible();
    for (const at of await fixes.evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute("data-at"))),
    )) {
      expect(at).toBeLessThan(latest);
    }

    await page.getByRole("button", { name: "Live" }).click();
    await expect(page.getByTestId("map-time")).toHaveText("Live");
    await expect
      .poll(async () => Number(await fixes.first().getAttribute("data-at")))
      .toBeGreaterThanOrEqual(latest);

    await world.op.mutation(api.watchlist.upsert, {
      freqHz: 433.925e6,
      name: "Gate radio",
      notes: "",
      rules: { heard: false, moved: false, silent: false },
      critical: false,
      home: null,
    });
    await expect(fixes.filter({ hasText: "unnamed" }).first()).toBeVisible();
    await page.getByLabel("Emitters").selectOption("watched");
    await expect(fixes.filter({ hasText: "Gate radio" })).toHaveCount(1);
    await expect(fixes.filter({ hasText: "unnamed" })).toHaveCount(0);
    // Only the 20%-duty burst bug is intermittent.
    await page.getByLabel("Emitters").selectOption("intermittent");
    await expect(fixes).toHaveCount(1);
    await expect(fixes.first()).toContainText("151.0125 MHz");
    noErrors();
  } finally {
    world.stop();
  }
});
