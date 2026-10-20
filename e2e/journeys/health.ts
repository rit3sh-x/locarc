import { api } from "@/convex/_generated/api";
import { scanningWorld } from "../fleet";
import { signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("health: a replug fault alerts and resolves; clipping shows Degraded", async ({ page }) => {
  test.setTimeout(180_000);
  const world = await scanningWorld();
  try {
    const noErrors = watchConsole(page);
    await signIn(page);
    const fleet = page.getByTestId("fleet-table");
    const row = (name: string) => fleet.getByRole("row").filter({ hasText: name });

    world.runner.behaviour[2] = {
      heartbeat: {
        hackrf: {
          state: "needs_attention",
          serial: null,
          boardId: 2,
          firmware: "2023.01.1",
          ladder: 0,
          faults: { RESET_FAILED: 1 },
          detachedSince: null,
        },
      },
    };
    await world.runner.ping(2);
    await expect(row("Gate 2")).toContainText("Needs attention");
    await expect(row("Gate 2")).toContainText("replug the HackRF");
    await expect(page.getByTestId("alerts-open")).toContainText("Gate 2: replug the HackRF");
    await expect(page.getByTestId("alerts-open")).toContainText("Critical");
    await expect(page.getByTestId("bell-count")).not.toHaveText("0");

    world.runner.behaviour[2] = {};
    await world.runner.ping(2);
    await expect(row("Gate 2")).not.toContainText("Needs attention");

    // A HackRF without sweep mode says how to fix it.
    world.runner.behaviour[2] = {
      heartbeat: {
        hackrf: {
          state: "needs_attention",
          serial: null,
          boardId: 2,
          firmware: "2017.02.1",
          ladder: 0,
          faults: { FIRMWARE_UNSUPPORTED: 1 },
          detachedSince: null,
        },
      },
    };
    await world.runner.ping(2);
    await expect(row("Gate 2")).toContainText("update the HackRF firmware");
    world.runner.behaviour[2] = {};
    await world.runner.ping(2);
    await expect(row("Gate 2")).not.toContainText("update the HackRF firmware");

    // Missing phone settings are a badge, never a Health state; a warm phone listens short.
    world.runner.behaviour[0] = {
      heartbeat: { setupGaps: ["autostart"], window: { mode: "short", reason: "warm" } },
    };
    await world.runner.ping(0);
    await expect(row("Rooftop A")).toContainText("Setup incomplete: Xiaomi Autostart off");
    await expect(row("Rooftop A")).toContainText("Short · warm");
    await expect(row("Rooftop A")).not.toContainText("Degraded");
    world.runner.behaviour[0] = {};
    await world.runner.ping(0);
    await expect(row("Rooftop A")).not.toContainText("Setup incomplete");
    await expect(page.getByRole("region", { name: "Alerts", exact: true })).not.toContainText(
      "replug the HackRF",
    );

    // Clipping clears after 3 clean Readings: Continuous gets there in seconds, not minutes.
    await world.op.mutation(api.runs.setCadence, {
      cadence: { kind: "continuous", minutes: 15, revertMinutes: 5 },
    });
    world.runner.behaviour[3] = { clipHz: [433.925e6] };
    await expect(row("Hostel 5")).toContainText("Degraded", { timeout: 120_000 });
    await expect(row("Hostel 5")).toContainText("gain too high at 433.9250 MHz");

    // Lowering the gain (here: no more clipping) clears it after 3 clean Readings.
    world.runner.behaviour[3] = {};
    await expect(row("Hostel 5")).toContainText("Scanning", { timeout: 120_000 });
    noErrors();
  } finally {
    world.runner.behaviour[0] = {};
    world.runner.behaviour[2] = {};
    world.runner.behaviour[3] = {};
    await world.op.mutation(api.runs.setCadence, {
      cadence: { kind: "oneMinute", hours: 4, revertMinutes: 5 },
    });
    world.stop();
  }
});
