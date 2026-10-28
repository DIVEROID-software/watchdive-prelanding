// Catalog preview. Default is dry-run. --send exits non-zero and does not
// open a network connection or read a credential value.
import { launchSmsCatalog } from "../src/lib/launchSms/plan.ts";
import { inspectSmsTransport } from "../src/lib/launchSms/provider.ts";

const send = process.argv.includes("--send");
const names = Object.keys(process.env);
const provider = inspectSmsTransport(names);
const items = launchSmsCatalog();
const payload = {
  mode: send ? "send" : "dry-run",
  sent: false,
  network: false,
  templates: items.length,
  provider: {
    transport: provider.transport,
    recognizedTransportNames: provider.recognizedTransportNames,
    emailFooterPhoneKeyPresent: provider.emailFooterPhoneKeyPresent,
    adapterImplemented: provider.adapterImplemented,
  },
  items,
};
console.log(JSON.stringify(payload));
if (send) process.exit(2);
