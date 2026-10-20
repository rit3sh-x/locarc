import { api } from "@/convex/_generated/api";
import { scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("calibration: co-located Receivers measure, review median − own, apply; Recalibrate clears", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const world = await scanningWorld();
  try {
    const config = await world.op.query(api.orgConfig.current, {});
    if (config.values.referenceHz === null) {
      await world.op.mutation(api.orgConfig.save, {
        expectedV: config.v,
        values: { ...config.values, referenceHz: 433.92e6 },
      });
    }
    const noErrors = watchConsole(page);
    await signIn(page);
    await page.goto("/receivers");
    const row = (name: string) =>
      page.getByTestId("receiver-matrix").getByRole("row").filter({ hasText: name });
    await expect(row("Rooftop A")).toContainText("Recalibrate");

    await page.getByLabel("Select Rooftop A").check();
    await page.getByLabel("Select Library").check();
    await page.getByRole("button", { name: "Calibration session (2)" }).click();
    const confirm = page.getByRole("dialog", { name: "Start a calibration session?" });
    await expect(confirm).toContainText("Reference: 433.9200 MHz.");
    await confirm.getByRole("button", { name: "Start measuring" }).click();

    const panel = page.getByRole("region", { name: "Calibration session" });
    await expect(panel.getByTestId("calibration-progress")).toContainText("Rooftop A: measuring…");
    // Scenario: Rooftop A reads the carrier at −45 dBm and +1.2 ppm; Library 2.5 dB hot at −0.6 ppm.
    const review = panel.getByTestId("calibration-review");
    await expect(review).toBeVisible({ timeout: 90_000 });
    await expect(review.getByRole("row").filter({ hasText: "Rooftop A" })).toContainText("+1.3 dB");
    await expect(review.getByRole("row").filter({ hasText: "Rooftop A" })).toContainText(
      "+1.20 ppm",
    );
    await expect(review.getByRole("row").filter({ hasText: "Library" })).toContainText("-1.2 dB");
    await expect(review.getByRole("row").filter({ hasText: "Library" })).toContainText("-0.60 ppm");

    await panel.getByRole("button", { name: "Apply to ticked" }).click();
    await expect(panel).toHaveCount(0);
    await expect(row("Rooftop A")).not.toContainText("Recalibrate");
    await expect(row("Library")).not.toContainText("Recalibrate");
    await expect(row("Library").getByRole("button", { name: /^Offset for Library/ })).toHaveText(
      "-1.2",
    );
    noErrors();
  } finally {
    world.stop();
  }
});
