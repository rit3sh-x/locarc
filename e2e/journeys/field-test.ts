import { DEMO, scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("field test: true position + frequency → the median Fix error after the next Scan", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const world = await scanningWorld();
  const gate = DEMO.emitters.find((e) => e.name === "Gate radio");
  if (!gate) throw new Error("scenario lacks the Gate radio");
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    await page.goto("/settings/field-tests");
    const form = page.getByRole("region", { name: "New field test" });
    await form.getByLabel("Name").fill("Gate radio at the gate");
    await form.getByLabel("Frequency (MHz)").fill("433.9250");
    await form.getByLabel("True latitude").fill(String(gate.lat));
    await form.getByLabel("True longitude").fill(String(gate.lng));
    await form.getByRole("button", { name: "Start field test" }).click();

    const item = page
      .getByTestId("field-tests")
      .getByRole("listitem")
      .filter({ hasText: "Gate radio at the gate" });
    await expect(item).toContainText("running since");
    await expect(item).toContainText(/Median Fix error \d+ m over 1 Scan/, { timeout: 200_000 });
    await expect(item).toContainText("best-fit n after 5 Scans");
    await item.getByRole("button", { name: "Stop" }).click();
    await expect(item).toContainText("ended");
    noErrors();
  } finally {
    world.stop();
  }
});
