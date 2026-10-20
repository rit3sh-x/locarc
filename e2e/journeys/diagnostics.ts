import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { ensureFleet } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("diagnostics: an Android crash report and a website error group, alert and resolve", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const sims = await ensureFleet();
  try {
    // The page error below is the point of this journey.
    const noErrors = watchConsole(page, [/Journey boom/]);
    await signIn(page);
    const [phone] = sims;
    if (!phone) throw new Error("no simulated Receiver");
    await phone.sync({
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
      errors: [
        {
          kind: "IllegalStateException",
          message: "USB device closed after 3 transfers",
          stack: "java.lang.IllegalStateException\n\tat dev.locarc.usb.HackRf.read(HackRf.kt:142)",
          context: "exit reason: CRASH",
        },
      ],
    });
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("Journey boom 42");
      });
    });

    await expect(page.getByTestId("alerts-open")).toContainText(
      "New android error: IllegalStateException",
    );
    await page.goto("/settings/diagnostics");
    const groups = page.getByTestId("error-groups").getByRole("listitem");
    const crash = groups.filter({ hasText: "IllegalStateException" });
    await expect(crash).toContainText("USB device closed after # transfers");
    await expect(crash).toContainText(`${phone.name}: exit reason: CRASH`);
    await expect(groups.filter({ hasText: "Journey boom #" })).toContainText("web");

    await crash.getByRole("button", { name: "Resolve" }).click();
    await expect(crash).toContainText("resolved");
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Alerts", exact: true })).not.toContainText(
      "New android error",
    );
    noErrors();
  } finally {
    for (const s of sims) s.close();
  }
});
