// Event contract for the retargeting phase. Historical rows are not relabeled.

import { RETARGETING_PHASE } from "./constants.ts";

export type EventContractRow = {
  event: string;
  surface: "GA4" | "Meta" | "Google Ads" | "audience";
  phase: string;
  definition: string;
  dedup: string;
  firesFrom: string;
  doesNotFireFrom: string;
  wired: boolean;
};

export const EVENT_CONTRACT_MATRIX: EventContractRow[] = [
  {
    event: "form_start",
    surface: "GA4",
    phase: "historical",
    definition: "First email-field focus in a signup form.",
    dedup: "Once per form mount via the existing formStartSent ref.",
    firesFrom: "trackGoogleFormStart",
    doesNotFireFrom: "Retargeting planners.",
    wired: true,
  },
  {
    event: "signup_pending",
    surface: "GA4",
    phase: "consented-conversions-20261027",
    definition: "Server accepted a pending submit. The browser cannot tell a new row from a resend.",
    dedup: "Client event_id. This is not the retargeting Lead id.",
    firesFrom: "trackGoogleSubmit",
    doesNotFireFrom: "planDurableLead. Do not retarget this event as a unique person.",
    wired: true,
  },
  {
    event: "sign_up",
    surface: "GA4",
    phase: "consented-conversions-20261027",
    definition:
      "Authoritative server sign_up after email or social verification when measurement is permitted and a stored GA client id is still valid. Both rollout flags default off and must be enabled together. While the public flag is off, the landing poll sends one browser sign_up beside generate_lead.",
    dedup: "Atomic durable HMAC claim per GA4 stream and CRM page id; ambiguous delivery is held, not blindly resent. The browser fallback claims the verification event id once per browser.",
    firesFrom:
      "dispatchGoogleVerified after authoritative verification or permitted late grant; trackGoogleLead only while the public server flag is off",
    doesNotFireFrom: "Raw form submission, the /verify page, browser URL flags, or an unverified record.",
    wired: true,
  },
  {
    event: "generate_lead",
    surface: "GA4",
    phase: "historical",
    definition: "Confirmed email browser fallback, only while VITE_GA4_SERVER_CONVERSIONS_ENABLED is not true.",
    dedup: "Verification event id already returned as browserLead.eventId.",
    firesFrom: "trackGoogleLead",
    doesNotFireFrom: "Pending submit or an enabled server GA4 completion rollout.",
    wired: true,
  },
  {
    event: "Lead",
    surface: "Meta",
    phase: "historical",
    definition:
      "2026-09-26 optimisation Lead. trackMetaLead and deliverMetaLead remain in the source. No production callsite invokes them. dispatchSubmitLead is installed as a stub that returns false.",
    dedup: "The old browser submitEventId. It is not the durable Lead id.",
    firesFrom: "No active callsite. The retained functions are trackMetaLead and deliverMetaLead.",
    doesNotFireFrom:
      "The submit form, planDurableLead, and every grant. The active signup Lead is the retargeting Lead row.",
    wired: false,
  },
  {
    event: "EmailVerified",
    surface: "Meta",
    phase: "historical",
    definition: "Custom event for a true confirmation. Not a standard CompleteRegistration.",
    dedup: "deterministicMetaEventId, including a retry of the same confirmation.",
    firesFrom: "trackMetaEmailVerified and sendMetaEmailVerified",
    doesNotFireFrom: "URL flags.",
    wired: true,
  },
  {
    event: "Lead",
    surface: "Meta",
    phase: RETARGETING_PHASE,
    definition: "One durable canonical signup row. Not a resend, repeat, duplicate, honeypot, or suspect row. Server Meta only. Google Ads does not receive this Lead.",
    dedup: "HMAC of the CRM page id. Same id on the pixel eventID and the CAPI event_id. event_time is the signup occurrence.",
    firesFrom: "planDurableLead then deliverRetargetingLead. Social may also carry it in the short receipt.",
    doesNotFireFrom: "Resend, abuse, a client-generated id, or trackGoogleDurableSignup.",
    wired: true,
  },
  {
    event: "CompleteRegistration",
    surface: "Meta",
    phase: RETARGETING_PHASE,
    definition:
      "First email-link verification, first authoritative social verification, or an authenticated late Allow while the stored Verified at time is still inside 48 hours. The late grant uses that stored time and the same page-id event id. A later login and an already-verified link click do not mint another id or a new time.",
    dedup:
      "HMAC of the CRM page id, distinct from the Lead id. event_time is the original verification. A late grant is a deduped_retry: it requires the stored time and refuses a missing time, a time older than 48 hours, or a time more than five minutes ahead. It does not stamp the Allow clock.",
    firesFrom:
      "planCompleteRegistration on the first true verification, and on a confirmation-token grant or a verified attempt grant when the stored Verified at time is still fresh",
    doesNotFireFrom:
      "Success screen, URL query, Notion verified/paid checkbox, a non-authoritative social email, a later login, a mere form submit, a poll of an unverified row, or an Allow with no stored verification time.",
    wired: true,
  },
  {
    event: "Purchase",
    surface: "Meta",
    phase: RETARGETING_PHASE,
    definition: "Stripe inspection of one clean USD 3 reservation fee on a verified lead. Browser/legacy proof uses the 48-hour freshness rule. The separately enabled durable server sender requires a current checkout grant and Charge.created no older than seven days, never in the future. While that sender is enabled the browser does not call the Meta pixel.",
    dedup: "HMAC of the canonical Checkout Session id. Browser and CAPI share that id and the original Charge.created time. A webhook replay does not stamp now. Meta only deduplicates that shared id for about 48 hours after the first receipt, so the durable path does not rely on it: the browser pixel stays off.",
    firesFrom: "Fresh planPurchase browser proof plus one server path: durable createMetaPurchases when enabled, otherwise legacy deliverPaidSnapshot. Both share the same event id. The enabled durable path still runs the browser Google and GA guards.",
    doesNotFireFrom: "Success URL, Notion paid checkbox, refund, dispute, partial refund, pending refund, or a completed session revisited after 48 hours.",
    wired: true,
  },
  {
    event: "conversion confirmed email",
    surface: "Google Ads",
    phase: "historical",
    definition: "trackGoogleLead send_to uses VITE_GOOGLE_ADS_ID and VITE_GOOGLE_ADS_CONVERSION_LABEL only.",
    dedup: "transaction_id is the existing verification event id.",
    firesFrom: "trackGoogleLead",
    doesNotFireFrom: "The signup or purchase labels.",
    wired: true,
  },
  {
    event: "conversion verified signup",
    surface: "Google Ads",
    phase: RETARGETING_PHASE,
    definition:
      "Optional VITE_GOOGLE_ADS_SIGNUP_LABEL on CompleteRegistration. New account 139-796-0411 action names, labels and primary/secondary goals require readback. Raw email submission is GA4 signup_pending; authoritative verification is server sign_up when enabled. No platform configuration is implied by this contract.",
    dedup: "transaction_id is the CompleteRegistration event id. Count is one. A Lead in the same social receipt does not send this label. A late Allow reuses the original event id.",
    firesFrom:
      "trackGoogleDurableSignup from trackRetargetingBrowser when the event is CompleteRegistration",
    doesNotFireFrom:
      "The raw email Lead, the confirmed-email label, a resend, a mere form submit, an already-verified link click, or an Allow with no fresh stored verification time.",
    wired: true,
  },
  {
    event: "conversion reservation purchase",
    surface: "Google Ads",
    phase: RETARGETING_PHASE,
    definition: "Optional direct Ads Purchase label uses browser proof within 48 hours. Browser GA4 purchase is fallback only while its server flag is off; enabled server GA4 purchase uses the Stripe session as transaction_id. Direct Ads versus GA4-import primary selection is a platform task.",
    dedup: "transaction_id is the retargeting Purchase event id. The action counts every, so a replay must not mint a new id or a new time.",
    firesFrom: "trackGoogleReservationPurchase",
    doesNotFireFrom: "The confirmed-email label, a success URL, a Notion checkbox, a refund, or a stale paid session.",
    wired: true,
  },
  {
    event: "audience B/C/D",
    surface: "audience",
    phase: RETARGETING_PHASE,
    definition: "C is every canonical signup. B is clear-unpaid, including unverified; payment ads also require upload permission. D is a clean Stripe USD 3. Refund, dispute, historical or unknown payment snapshots are payment_hold and suppress payment ads and drip without proving a purchase. Withdrawal, denial and unsubscribe block platform uploads. Reservation mail separately requires verification.",
    dedup: "Latest Stripe snapshot. A repeat visit does not create another row.",
    firesFrom: "classifyAudience and paidDripSuppressed",
    doesNotFireFrom: "A Notion paid checkbox or the success URL. Those are payment_hold, not D and not B.",
    wired: false,
  },
];
