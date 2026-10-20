import { SimReceiver } from "@/scripts/sim/receiver";
import { saveFleet, scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("receiver lifecycle: pin, pause/resume, remove cuts the phone off, re-pair keeps history", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const world = await scanningWorld();
  const i = world.sims.findIndex((s) => s.name === "Gate 2");
  const gate = world.sims[i];
  if (!gate?.id) throw new Error("Gate 2 missing from the fleet");
  try {
    const noErrors = watchConsole(page, [/status of 401/]);
    await signIn(page);
    await page.goto(`/receivers/${gate.id}`);
    await expect(page.getByRole("heading", { name: "Gate 2" })).toBeVisible();

    const position = page.getByRole("region", { name: "Position", exact: true });
    await position.getByRole("button", { name: "Edit" }).click();
    await position.getByLabel("Pinned").check();
    await position.getByRole("button", { name: "Use current GPS" }).click();
    await position.getByRole("button", { name: "Save…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Push" }).click();
    await expect(position).toContainText("Pinned at 12.96530, 77.60370");
    await page.getByRole("link", { name: "Map" }).click();
    await expect(
      page.getByLabel("Map contents").getByRole("listitem").filter({ hasText: "Gate 2" }),
    ).toContainText("pinned");

    await page.goto(`/receivers/${gate.id}`);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("paused by an Operator").first()).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("paused by an Operator")).toHaveCount(0);

    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page).toHaveURL(/\/receivers$/);
    await expect.poll(() => gate.stopped).toBeTruthy();
    await page.getByText(/Removed \(1\)|Removed \(2\)/).click();
    const removed = page
      .getByTestId("removed-receivers")
      .getByRole("listitem")
      .filter({ hasText: "Gate 2" });
    await removed.getByRole("button", { name: "Re-pair" }).click();
    await page.getByRole("button", { name: "Show pairing code" }).click();
    const code = (await page.getByTestId("pairing-code").textContent()) ?? "";
    const phone = new SimReceiver(gate.url);
    const paired = await phone.pair(code);
    expect(paired.receiverId).toBe(gate.id);
    await expect(page.getByRole("status").filter({ hasText: "Gate 2 is paired" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    world.sims[i] = phone;
    saveFleet(world.sims);

    await page.goto(`/receivers/${gate.id}`);
    await expect(page.getByTestId("receiver-versions")).toContainText(
      "Position: live GPS → pinned",
    );
    await page.getByRole("button", { name: "Show event timeline" }).click();
    await expect(page.getByTestId("receiver-events")).toContainText("Re-paired with a new phone");
    noErrors();
  } finally {
    world.stop();
  }
});
