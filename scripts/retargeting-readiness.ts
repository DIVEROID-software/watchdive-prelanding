// Read-only retargeting measurement check.
// Prints booleans and missing env names. It does not call Meta or Google,
// does not print a secret, and a zero exit only means the script finished.
// readyForLive stays false until advertiser verification and the live hooks exist.

import { buildRetargetingReadiness } from "../src/lib/retargeting/readiness.ts";

const readiness = buildRetargetingReadiness();
const encoded = JSON.stringify(readiness);
if (encoded.includes("META_CAPI_ACCESS_TOKEN=") || /sk_live|whsec_/.test(encoded)) {
  console.error("retargeting readiness refused to print because the payload looked like a secret");
  process.exit(1);
}
process.stdout.write(`${encoded}\n`);
process.exit(0);
