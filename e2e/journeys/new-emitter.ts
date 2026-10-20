import { DEMO, scanningWorld } from "../fleet";
import { run, signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("new emitter → triage: New alert, bell, open-tab notification, Name & watch", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.context().grantPermissions(["notifications"]);
  // Records what the page shows as browser notifications (the OS ones aren't observable).
  await page.addInitScript(() => {
    localStorage.setItem("locarc-tab-notify", "on");
    const shown: string[] = [];
    Object.assign(window, { __notified: shown });
    window.Notification = class {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      constructor(title: string) {
        shown.push(title);
      }
    } as unknown as typeof Notification;
  });
  const intruder = DEMO.emitters.find((e) => e.name === "Intruder 427");
  if (!intruder) throw new Error("scenario lacks the intruder");
  const world = await scanningWorld();
  run("tests/seed:backdateLearning");
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    await expect(page.getByRole("region", { name: "Alerts", exact: true })).toBeVisible();
    intruder.active = true;

    const title = "New emitter on 427.5125 MHz";
    const open = page.getByTestId("alerts-open");
    await expect(open).toContainText(title, { timeout: 200_000 });
    await expect(page.getByTestId("bell-count")).not.toHaveText("0");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __notified: string[] }).__notified))
      .toContain(title);

    await open.getByRole("link", { name: title }).click();
    await expect(page.getByRole("heading", { name: "427.5125 MHz" })).toBeVisible();
    await page.getByRole("button", { name: "Name & watch" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Intruder");
    await page.getByRole("dialog").getByRole("button", { name: "Name & watch" }).click();
    await expect(page.getByRole("button", { name: "Name & watch" })).toHaveCount(0);

    await page.getByRole("link", { name: "Watchlist" }).click();
    await expect(page.getByTestId("watchlist")).toContainText("Intruder");
    await page.getByText(/Acknowledged recently/).click();
    await expect(page.getByTestId("alerts-acknowledged")).toContainText(title);
    await expect(page.getByTestId("alerts-acknowledged")).toContainText(
      "acknowledged by First Operator",
    );
    noErrors();
  } finally {
    intruder.active = false;
    world.stop();
  }
});
