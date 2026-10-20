import { z } from "zod";

export const env = z
  .object({
    VITE_CONVEX_URL: z.url(),

    VITE_WEB_VERSION: z.string().default("dev"),
  })
  .parse(import.meta.env);
