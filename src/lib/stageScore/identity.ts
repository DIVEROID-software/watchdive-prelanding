// CRM person key. The address is hashed and dropped. This folding matches
// weighted-scoring/crm_score.py `_canonical_email`, including plus-stripping
// on every domain. Reservation checkout keeps plus-tags on non-Gmail
// domains; the stage score joins those payments back onto the CRM key.
// An empty return means "do not observe".

import { createHash } from "node:crypto";

export function crmCanonical(raw: string): string {
  const value = (raw ?? "").trim().toLowerCase();
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return "";
  if (/\s/.test(value)) return "";
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  if (!local || !domain.includes(".")) return "";
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (!local) return "";
  return `${local}@${domain}`;
}

export function personKey(email: string): string {
  const canonical = crmCanonical(email);
  if (!canonical) return "";
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `crm:${digest}`;
}
