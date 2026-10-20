import { OPERATOR, runSetup, signOut, watchConsole } from "../helpers";
import { expect, test } from "../test";

test("setup creates the Organization; sign-in, redirects and sign-out", async ({ page }) => {
  // The wrong-password attempt below is an expected 401.
  const noErrors = watchConsole(page, [/status of 401/]);

  expect(runSetup()).toContain(`Organization "${OPERATOR.org}" is ready`);
  expect(() => runSetup()).toThrow(/ALREADY_SET_UP/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2F$/);
  await page.getByLabel("Email").fill(OPERATOR.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");

  await expect(page.getByLabel("Email")).toHaveValue(OPERATOR.email);
  await page.getByLabel("Password").fill(OPERATOR.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(OPERATOR.org);
  await expect(page.getByRole("heading", { name: "No Receivers yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pair Receiver" })).toBeVisible();

  await signOut(page);
  await page.goto("/scans?run=3");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel("Email").fill(OPERATOR.email);
  await page.getByLabel("Password").fill(OPERATOR.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/scans\?run=3$/);

  await signOut(page);
  noErrors();
});
