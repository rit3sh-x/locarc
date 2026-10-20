import { type BrowserContext, test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/** Journeys never reach the internet or depend on map pixels; assertions use the side lists. */
export async function blockTiles(context: BrowserContext) {
  await context.route("https://tiles.openfreemap.org/**", (route) => route.abort());
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await blockTiles(context);
    await use(context);
  },
});
