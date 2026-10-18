// Reservation authorization identity. This is not the waitlist canonicalizer
// in src/lib/api/abuse.ts, and historical waitlist analytics must keep using
// that function. Only the documented Gmail / googlemail.com same-inbox rule
// collapses a plus-tag, dots, and the domain. Every other domain keeps both
// the plus-tag and the dots, so those addresses stay distinct.
//
// The returned value is the authorization and grouping key. It is not proof
// that two non-Gmail addresses share a mailbox, and it is not the delivery
// address. Mail To stays the verified row email.

export function reservationCanonicalEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const plus = local.indexOf("+");
    local = (plus === -1 ? local : local.slice(0, plus)).replace(/\./g, "");
  }
  return `${local}@${domain}`;
}
