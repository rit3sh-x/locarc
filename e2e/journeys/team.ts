import type { Browser } from "@playwright/test";
import { blockTiles, expect, test } from "../test";

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  await blockTiles(context);
  return await context.newPage();
}

import { ensureSetUp, OPERATOR, signIn, signOut, watchConsole } from "../helpers";

test("team: invite, reused link, reset link, removal, last Operator", async ({ page, browser }) => {
  ensureSetUp();
  const noErrors = watchConsole(page);
  await signIn(page);
  await page.goto("/settings/team");

  await page.getByLabel("Email").fill("second@example.com");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const invite = await page.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(invite).toMatch(/\/invite\/[\w-]+$/);
  await expect(page.getByRole("listitem").filter({ hasText: "second@example.com" })).toBeVisible();

  const second = await newPage(browser);
  // A removed Operator's tab makes a few calls that fail with 401 on its way out.
  const secondErrors = watchConsole(second, [/status of 401/]);
  await second.goto(invite);
  await expect(second.getByLabel("Email")).toHaveValue("second@example.com");
  await second.getByLabel("Your name").fill("Second Operator");
  await second.getByLabel("Password").fill("second-password-1");
  await second.getByRole("button", { name: "Create account" }).click();
  await expect(second.getByTestId("org-name")).toHaveText(OPERATOR.org);

  const third = await newPage(browser);
  const thirdErrors = watchConsole(third);
  await third.goto(invite);
  await expect(third.getByRole("heading", { name: "Invite not valid" })).toBeVisible();

  const secondRow = page.getByRole("listitem").filter({ hasText: "second@example.com" });
  await secondRow.getByRole("button", { name: "Reset link" }).click();
  const reset = await page.getByRole("textbox", { name: "Reset link" }).inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await third.goto(reset);
  await third.getByLabel("New password").fill("second-password-2");
  await third.getByLabel("Repeat it").fill("second-password-2");
  await third.getByRole("button", { name: "Set password" }).click();
  await expect(third.getByRole("heading", { name: "Password changed" })).toBeVisible();
  await signIn(third, "second@example.com", "second-password-2");
  await signOut(third);

  await secondRow.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(second).toHaveURL(/\/sign-in/);

  await expect(page.getByText("The last Operator can't be removed.")).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: OPERATOR.email })
      .getByRole("button", { name: "Remove" }),
  ).toBeDisabled();

  noErrors();
  secondErrors();
  thirdErrors();
});
