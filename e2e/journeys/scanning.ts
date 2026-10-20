import { distanceM } from "@/convex/lib/geo";
import { FleetRunner } from "@/scripts/sim/runner";
import { worldMeasure } from "@/scripts/sim/world";
import { DEMO, ensureFleet, FLEET_POSITIONS } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("scanning end to end: a burst starts, Scans close into Emitters near the transmitters", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const sims = await ensureFleet();
  const runner = new FleetRunner(sims, FLEET_POSITIONS, (b) =>
    worldMeasure(DEMO, FLEET_POSITIONS, b),
  );
  await runner.start();
  try {
    const noErrors = watchConsole(page);
    await signIn(page);

    const idleUsage = await page.getByTestId("usage-meter").getAttribute("aria-label");
    await page.getByRole("button", { name: "Scan control" }).click();
    await page.getByLabel("Cadence").selectOption("oneMinute:4");
    await page.getByRole("button", { name: "Start…" }).click();
    const confirm = page.getByRole("dialog", { name: "Start scanning?" });
    await expect(confirm).toContainText(/Run \d+ starts at \d\d:\d\d\./);
    await expect(confirm).toContainText("1-min burst for 4 h, then every 15 min");
    await confirm.getByRole("button", { name: "Start" }).click();

    // Receivers listen through the whole minute and upload just before the next boundary.
    const active = DEMO.emitters.filter((e) => e.active !== false);
    await expect(page.getByLabel("Summary")).toContainText(
      `${active.length} heard · ${active.length} located`,
      { timeout: 180_000 },
    );
    await expect(page.getByLabel("Summary")).toContainText("4 of 4 (Scan 1)");
    const now = page.getByTestId("emitters-now");
    await expect(now).toContainText("433.9250 MHz");
    // Wi-Fi's 20 MHz is one Emitter, and the burst bug shows as intermittent.
    await expect(now.getByRole("row").filter({ hasText: "2437.0000 MHz" })).toContainText("20 MHz");
    await expect(now.getByRole("row").filter({ hasText: "151.0125 MHz" })).toContainText(
      "intermittent · 20%",
    );
    await expect(page.getByTestId("fleet-table")).not.toContainText("Idle");
    await expect(page.getByTestId("usage-meter")).not.toHaveAttribute(
      "aria-label",
      idleUsage ?? "",
    );

    await page.getByRole("link", { name: "Map" }).click();
    const fixes = page.getByTestId("map-emitters").getByRole("listitem");
    await expect(fixes).toHaveCount(active.length);
    for (const e of active) {
      const mhz = `${(e.freqHz / 1e6).toFixed(4)} MHz`;
      const text =
        (await fixes.filter({ hasText: mhz }).getByTestId("fix-position").textContent()) ?? "";
      const [lat, lng] = text.split(" · ")[0]?.split(", ").map(Number) ?? [];
      expect(distanceM({ lat: lat ?? 0, lng: lng ?? 0 }, e), `${e.name} Fix error`).toBeLessThan(
        600,
      );
    }
    noErrors();
  } finally {
    runner.stop();
    for (const s of sims) s.close();
  }
});
