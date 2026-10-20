import { SimReceiver } from "@/scripts/sim/receiver";
import { FLEET, saveFleet } from "../fleet";
import { ensureSetUp, run, signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

const url = () => process.env.E2E_CONVEX_URL ?? "";

test("pairing: QR + typed code, the simulator redeems, bad codes refused", async ({ page }) => {
  ensureSetUp();
  const noErrors = watchConsole(page);
  await signIn(page);
  await page.goto("/receivers");
  const row = (name: string) => page.getByRole("row").filter({ hasText: name });

  const codeFor = async (name: string) => {
    await page.getByRole("button", { name: "Pair Receiver" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create pairing code" }).click();
    await expect(page.getByRole("img", { name: "Pairing QR code" })).toBeVisible();
    await expect(page.getByText("Waiting for the phone…")).toBeVisible();
    return (await page.getByTestId("pairing-code").textContent()) ?? "";
  };

  const sims: SimReceiver[] = [];
  const [first, ...rest] = FLEET;
  const firstCode = await codeFor(first);
  expect(firstCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(row(first)).toContainText("Awaiting pairing");
  const sim = new SimReceiver(url());
  await sim.pair(firstCode);
  sims.push(sim);
  await expect(row(first)).toContainText("Idle");

  for (const name of rest) {
    const code = await codeFor(name);
    const s = new SimReceiver(url());
    await s.pair(code);
    sims.push(s);
    await expect(page.getByRole("status").filter({ hasText: `${name} is paired` })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(row(name)).toContainText("Idle");
  }
  saveFleet(sims);

  await expect(new SimReceiver(url()).pair(firstCode)).rejects.toThrow(/CODE_INVALID/);

  const spareCode = await codeFor("Spare");
  await page.getByRole("button", { name: "Close" }).click();
  run("tests/seed:expirePairingCodes");
  await expect(new SimReceiver(url()).pair(spareCode)).rejects.toThrow(/CODE_INVALID/);
  await row("Spare").getByRole("link", { name: "Spare" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page).toHaveURL(/\/receivers$/);
  await expect(row("Spare")).toHaveCount(0);

  await expect(page.getByText("Removed (1)")).toBeVisible();

  for (const s of sims) s.close();
  noErrors();
});
