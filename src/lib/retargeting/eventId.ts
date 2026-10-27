// Stable ids for browser/CAPI dedup. The cleartext key never leaves the server.
import { createHmac } from "node:crypto";

import { isRetargetingEventId } from "./privacy.ts";

export type RetargetingIdPurpose = "lead" | "registration" | "purchase";

const MINIMUM_SECRET_LENGTH = 16;

export function retargetingEventId(
  purpose: RetargetingIdPurpose,
  key: string,
  secret: string,
): string | null {
  if (secret.length < MINIMUM_SECRET_LENGTH) return null;
  if (!key || key.length > 200 || key.includes("@") || key.includes("?") || key.includes("#")) {
    return null;
  }
  const digest = createHmac("sha256", secret)
    .update(`retargeting-${purpose}:v1:${key}`)
    .digest("hex");
  return isRetargetingEventId(digest) ? digest : null;
}
