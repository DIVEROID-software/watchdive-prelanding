// Local-only previews. Every provider call is intercepted; no env or live token.
// Run: node --experimental-strip-types scripts/preview-verification-mail.ts
import { mkdir, writeFile } from "node:fs/promises";
import { createResendMailer } from "../src/lib/verification/resend.ts";
import { createVerificationToken } from "../src/lib/verification/token.ts";

const output = new URL("../qa-mail/", import.meta.url);
await mkdir(output, { recursive: true });
for (const locale of ["ko", "en"] as const) {
  const leadId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
  const token = createVerificationToken(leadId, Date.parse("2030-01-01T00:00:00Z"), false,
    "qa-only-verification-mail-secret-never-use-in-production", locale);
  const mailer = createResendMailer(
    { RESEND_API_KEY: "re_qa_only", WATCHDIVE_EMAIL_FROM: "hello@watchdive.example" },
    (async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      await writeFile(new URL(`${locale}.html`, output), payload.html);
      return new Response('{"id":"qa_only"}', { status: 200 });
    }) as typeof fetch,
    async () => {},
  );
  await mailer.send({ to: "qa@example.com", token, leadId, publicOrigin: "https://watchdive.example", locale });
}
console.log(`Local previews written to ${output.pathname} (no email sent).`);
