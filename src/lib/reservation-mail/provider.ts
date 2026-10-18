// Sends through the existing Resend helper. Credentials stay in that helper's
// env read. This file does not read or print them.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { deliver, readResendConfig } from "../verification/resend.ts";
import type { ReservationMessage } from "./run.ts";

export async function deliverReservationMessage(
  env: NodeJS.ProcessEnv,
  message: ReservationMessage,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const config = readResendConfig(env);
  await deliver(config, fetchImpl, sleep, message.idempotencyKey, "reservation_mail", {
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    tags: message.tags,
  });
}
