# Optional launch SMS capture — 2026-10-12

Owner requested a phone invitation after email submission and email confirmation,
with country search by country name or calling code. The inbox card and verified
page now offer optional launch SMS reminders. The verification email explains
that the visitor can add a number after confirming. The early-bird offer remains
for the first 100 Kickstarter backers; a number does not reserve or guarantee it.

Country selection supports localized/English names, common aliases, ISO codes
and calling-code prefixes. National numbers and pasted international numbers
are normalized to E.164. This is format validation, not phone ownership or
deliverability verification. SMS consent is a separate unchecked checkbox.

The new server path accepts an existing signed signup handle or confirmed email
token. It updates only Phone and SMS consent, reads the result back, and never
creates or verifies a lead, changes attribution, or emits an advertising event.
Repeat-signup decoy handles retain a generic acknowledgement and cannot edit an
existing lead. Unsubscribed/suspect records and expired/invalid credentials do
not write. Consent receipts include version WD-SMS-CONSENT-V2, UTC time, locale
and source surface. No phone value is added to URLs or analytics payloads.

The live Notion schema gained one SMS consent rich-text column at
2026-10-12T00:05:17.539318Z. All existing property IDs/types were reread unchanged;
the migration changed zero customer rows. The original signup phone path retains
its existing explicit-consent behavior; the new path writes the V2 receipt.

Validation: full test suite, TypeScript and production build; isolated browser
QA of signup, consent rejection, name/code search, keyboard selection, empty
results, international paste and saved state. Thirteen layout cases cover all
nine locales at 320px plus English/Korean at 390px and 1440px. No horizontal
overflow or browser errors were observed. Browser save responses were mocked;
no QA customer email/SMS was sent and no dummy CRM customer was created.

This release collects numbers and preferences. It does not add an SMS sender.
The 50:50 form-first allocation, first email field, fixed media, ad ID registry,
Maya reporting, verification reminder schedule and advertising budgets remain.
Both A/E ad teams see the same website change. The deployment is a common
time-phase boundary; pre/post results must not be called a randomized SMS test.
Production deployment/readback receipts live in the operator workspace at
ads/autopilot/landing-updates/phone-optin-20261012/ and on the office Mac mini.
