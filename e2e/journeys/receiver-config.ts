import { scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("receiver config: inline edit → Review & push → Pending → Applied; a rejection shows", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const world = await scanningWorld();
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    await page.goto("/receivers");
    const row = (name: string) =>
      page.getByTestId("receiver-matrix").getByRole("row").filter({ hasText: name });
    const pushLna = async (name: string, from: number, to: number) => {
      await page.getByRole("button", { name: `LNA for ${name}: ${from}` }).click();
      await page.getByLabel(`LNA for ${name}`).selectOption(String(to));
      const bar = page.getByRole("region", { name: "Staged changes" });
      await expect(bar).toContainText(`1 staged change on ${name}`);
      await bar.getByRole("button", { name: "Review & push" }).click();
      const confirm = page.getByRole("dialog", { name: "Push config?" });
      await expect(confirm).toContainText(`${name}: LNA: ${from} → ${to} dB`);
      await confirm.getByRole("button", { name: "Push to 1 Receiver" }).click();
    };

    // New Receivers start at LNA 32, VGA 30, amp off.
    await expect(page.getByRole("button", { name: "LNA for Rooftop A: 32" })).toBeVisible();
    await expect(page.getByRole("button", { name: "RF amp for Rooftop A: off" })).toBeVisible();
    await pushLna("Rooftop A", 32, 24);
    await expect(row("Rooftop A")).toContainText(/Pending v\d+|Applied ✓ v\d+/);
    await expect(row("Rooftop A")).toContainText(/Applied ✓ v\d+/);

    // The RF amp is a one-click staged switch.
    await page.getByRole("button", { name: "RF amp for Rooftop A: off" }).click();
    const bar = page.getByRole("region", { name: "Staged changes" });
    await bar.getByRole("button", { name: "Review & push" }).click();
    const ampConfirm = page.getByRole("dialog", { name: "Push config?" });
    await expect(ampConfirm).toContainText("Rooftop A: RF amp: off → on");
    await ampConfirm.getByRole("button", { name: "Push to 1 Receiver" }).click();
    await expect(page.getByRole("button", { name: "RF amp for Rooftop A: on" })).toBeVisible();
    await expect(row("Rooftop A")).toContainText(/Applied ✓ v\d+/);

    world.runner.behaviour[1] = { rejectConfig: "LNA 40 dB saturates this phone" };
    await pushLna("Library", 32, 40);
    await expect(row("Library")).toContainText("LNA 40 dB saturates this phone");
    await expect(row("Library")).toContainText("runs 32");
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByTestId("alerts-open")).toContainText("Library: config v");
    await expect(page.getByTestId("alerts-open")).toContainText("rejected");

    // Leave both as they were: the phone takes the fix, and the alert resolves itself.
    world.runner.behaviour[1] = {};
    await page.goto("/receivers");
    await pushLna("Library", 40, 32);
    await expect(row("Library")).toContainText(/Applied ✓ v\d+/);
    await pushLna("Rooftop A", 24, 32);
    await expect(row("Rooftop A")).toContainText(/Applied ✓ v\d+/);
    await page.getByRole("button", { name: "RF amp for Rooftop A: on" }).click();
    await page
      .getByRole("region", { name: "Staged changes" })
      .getByRole("button", { name: "Review & push" })
      .click();
    await page
      .getByRole("dialog", { name: "Push config?" })
      .getByRole("button", { name: "Push to 1 Receiver" })
      .click();
    await expect(row("Rooftop A")).toContainText(/Applied ✓ v\d+/);
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Alerts", exact: true })).not.toContainText(
      "rejected",
    );
    noErrors();
  } finally {
    world.runner.behaviour[1] = {};
    world.stop();
  }
});
