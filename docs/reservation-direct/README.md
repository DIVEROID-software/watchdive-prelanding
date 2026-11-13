# Stripe email entry for public reservations

Anonymous /reservation visitors accept the existing terms and continue directly to hosted Stripe Checkout. No email field or return-link email precedes checkout. Stripe customer_creation=always collects email during payment; existing verified invite checkout remains available.

Payment state is read from Stripe and signed webhooks. A random browser nonce scopes public status lookup and idempotent checkout; no email or existing customer can be supplied to retrieve somebody else's session. New paid addresses create payment-only pending Notion records with reservation-only flags. They are not marked email-verified or subscribed. Existing records retain consent and verification status.

Same-browser retries/cancel reuse a session. Distinct browsers with the same unknown email cannot be deduplicated before Stripe collects the address; existing webhook aggregation detects multiple paid reservations. No automatic refund is added. Notion lacks atomic uniqueness, so concurrent first-payment webhook creation remains a reconciliation risk; deterministic lead identity and read-before-create reduce ordinary replay duplicates.

Validation: 62 focused tests (including guest webhook replay and pending CRM creation), full suite, TypeScript and build. Hosted Stripe sandbox checkout opened from the preview browser and visually checked: $3, email, card inputs. No payment submitted and no customer email sent. Preview uses existing reservation QA branch settings with live charges disabled. Production is not deployed by the preview command.
