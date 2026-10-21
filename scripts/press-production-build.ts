// Provision only the two press tracking properties in the configured production
// waitlist database. Credentials stay inside Vercel; no rows or addresses are read.
import { execFileSync } from "node:child_process";
import { runPressNotionSchema } from "./press-attribution-notion-schema.ts";

if (process.env.VERCEL_ENV === "production" && process.env.PRESS_ATTRIBUTION_ENABLED === "1") {
  const result = await runPressNotionSchema({ args: ["--apply"], env: process.env });
  console.log("[press-schema] " + JSON.stringify(result.report));
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else {
  console.log("[press-schema] skipped: production tracking is not enabled");
}
execFileSync("npm", ["run", "build"], { stdio: "inherit" });
