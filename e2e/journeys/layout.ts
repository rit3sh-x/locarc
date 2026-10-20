import { api } from "@/convex/_generated/api";
import { decodeBoard } from "@/convex/lib/boardCodec";
import { operatorClient } from "../fleet";
import { ensureSetUp, signIn, watchConsole } from "../helpers";
import { expect, test } from "../test";

/** Every main page at phone width, light and dark: no sideways scroll, the theme applied, no errors. */
for (const colorScheme of ["light", "dark"] as const) {
  test(`phone width, ${colorScheme} theme: every page fits and renders`, async ({ page }) => {
    test.setTimeout(180_000);
    ensureSetUp();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme });
    const op = await operatorClient();
    const receivers = await op.query(api.receivers.list, {});
    const board = await op.query(api.emitters.board, {});
    const first = board && decodeBoard(board.items)[0];
    const { scans, runs } = await op.query(api.scans.recent, { since: 0 });
    const scan = scans.at(-1);
    const run = runs.find((r) => r._id === scan?.run);
    const paths = [
      "/",
      "/map",
      "/scans",
      "/receivers",
      "/watchlist",
      "/settings/organization",
      "/settings/team",
      "/settings/notifications",
      "/settings/field-tests",
      "/settings/releases",
      "/settings/diagnostics",
      ...(receivers[0] ? [`/receivers/${receivers[0]._id}`] : []),
      ...(first && board ? [`/emitters/${first.ch * board.rasterHz}`] : []),
      ...(scan && run ? [`/scans/${run.number}/${scan.k + 1}`] : []),
    ];

    const noErrors = watchConsole(page);
    await signIn(page);
    for (const path of paths) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1 }),
        `${path} has a page heading`,
      ).toBeAttached();
      await page.waitForTimeout(300);
      const layout = await page.evaluate(() => {
        const width = window.innerWidth;
        const offenders = [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > width + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
        const [r = 0, g = 0, b = 0] =
          getComputedStyle(document.body)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [];
        return {
          overflow: document.documentElement.scrollWidth - width,
          offenders,
          luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
        };
      });
      expect(
        layout.overflow,
        `${path} scrolls sideways: ${layout.offenders.join(" | ")}`,
      ).toBeLessThanOrEqual(0);
      if (colorScheme === "dark") expect(layout.luminance, `${path} background`).toBeLessThan(0.15);
      else expect(layout.luminance, `${path} background`).toBeGreaterThan(0.85);
    }
    noErrors();
  });
}
