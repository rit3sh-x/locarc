// Preloaded by bunfig.toml before any test module, so auth.config and env see these values.
import { generateDeploymentEnv } from "@/scripts/lib/deploymentEnv";

Object.assign(process.env, await generateDeploymentEnv("http://localhost:5173"), {
  CONVEX_SITE_URL: "http://127.0.0.1:3211",
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
  IS_TEST: "1",
});
