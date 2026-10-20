import { writeFileSync } from "node:fs";
import { generateDeploymentEnv, toDotenv } from "@/scripts/lib/deploymentEnv";
import { convexCli, pushFunctions, startBackend } from "./backend";
import { BACKEND_PORT, WEB_PORT } from "./ports";

export default async function globalSetup() {
  const backend = await startBackend(BACKEND_PORT);
  const vars = { ...(await generateDeploymentEnv(`http://localhost:${WEB_PORT}`)), IS_TEST: "1" };
  const file = `${backend.envFile}.vars`;
  writeFileSync(file, toDotenv(vars));
  convexCli(backend, ["env", "set", "--from-file", file]);
  pushFunctions(backend);
  // Workers inherit these; tests reach the backend through e2e/helpers.
  process.env.E2E_CONVEX_URL = backend.url;
  process.env.E2E_CONVEX_SITE_URL = backend.siteUrl;
  process.env.E2E_ADMIN_KEY = String(backend.cliEnv.CONVEX_SELF_HOSTED_ADMIN_KEY);
  return () => backend.stop();
}
