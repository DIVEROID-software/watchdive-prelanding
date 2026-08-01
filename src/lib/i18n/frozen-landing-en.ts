/**
 * Canonical English copy for the immutable production design.
 *
 * Keep this module free of translated catalogs: it is part of the canonical
 * English client path and must not pull all locale copy into the initial
 * JavaScript bundle.
 */

export const EN_FROZEN_LANDING_MESSAGES = {
  meta: {
    title: "Watch Dive — Turn the watch you already own into a dive computer",
    description:
      "Turn the Apple Watch or Galaxy Watch you already own into a 60 m dive computer. $149 early bird — 50% off at Kickstarter launch.",
    ogTitle: "Watch Dive — Turn the watch you already own into a dive computer",
    ogDescription:
      "Turn your Apple or Galaxy Watch into a 60 m dive computer. $149 early bird — 50% off at Kickstarter launch.",
    twitterTitle: "Watch Dive — Turn the watch you already own into a dive computer",
    twitterDescription:
      "Turn your Apple or Galaxy Watch into a 60 m dive computer. $149 early bird on Kickstarter.",
  },
  banner: {
    kicker: "Launching soon on Kickstarter",
    offer: "Early bird · 50% off",
    joinCta: "Join the waitlist",
  },
  // Shared CTA — the floating launch pill AND both form submit buttons.
  cta: {
    label: "Get the $149 early-bird invite",
  },
  referral: {
    welcome: "A friend invited you — you're on their list. Confirm your email to join them.",
    welcomeHighlight: "you're on their list",
    successTitle: "You're on the list. 🎉",
    successBody: "We'll email you the moment Watch Dive goes live on Kickstarter.",
    buddyTitle: "Bring a buddy",
    buddyBody:
      "Share your link with divers who'd want this. We count everyone who joins through it, and we'll email you the Kickstarter link the moment the campaign opens.",
    joinedOne: "{count} diver joined through your link",
    joinedOther: "{count} divers joined through your link",
    copied: "Copied!",
    shareButton: "Send to your dive buddy",
    shareText:
      "I'm turning my Apple/Galaxy Watch into a dive computer with Watch Dive 🤿 Early bird is $149 on Kickstarter — join the list with my link.",
  },
  inbox: {
    title: "One more step — confirm your email 📬",
    note: "Look for the subject “Confirm your Watch Dive waitlist email” and press Confirm my email. Check spam or promotions if it is not there within a minute. The link lasts 24 hours and this page updates on its own.",
    noteSubject: "“Confirm your Watch Dive waitlist email”",
    noteButton: "Confirm my email",
    resendIdle: "Didn't get it? Resend",
    resendWait: "Resend in a moment",
    resendBusy: "Sending…",
    wrongAddress: "Wrong address?",
    inAppHint: "Open your mail app and search for Watch Dive.",
    inAppHintHighlight: "Watch Dive",
    openGmail: "Open Gmail",
    openOutlook: "Open Outlook",
    openYahoo: "Open Yahoo Mail",
    openNaver: "네이버 메일 열기",
    openDaum: "다음 메일 열기",
  },
  closed: {
    title: "The list is full",
  },
  // Server-produced messages rendered verbatim inside the form UI
  // (src/lib/verification/contracts.ts).
  server: {
    pending:
      "If this address can receive email, a confirmation link is on its way. Open it to confirm.",
    closed:
      "The pre-launch list is full. Watch Dive opens to everyone on Kickstarter on 10 August.",
  },
  toasts: {
    resent: "Sent again — check your inbox.",
    error: "Something went wrong. Please try again.",
  },
  form: {
    emailPlaceholder: "your@email.com",
    phonePlaceholder: "Phone (optional) — for a launch-day text",
    saving: "Saving…",
    smsConsent:
      "Text me about the Watch Dive Kickstarter launch. Optional — your email signup works without this.",
    step1: "Enter your email",
    step2: "Click the confirm link we send you",
    step3: "You're on the list",
  },
  heroProof: {
    readAll: "Read all {count} beta reviews (some translated) ↓",
  },
  hero: {
    badge: "Launching soon on Kickstarter",
    h1: "Turn the watch you already own into a dive computer.",
    h1Highlight: "already own",
    sub: "Turn the Apple or Galaxy Watch you already own into a 60 m dive computer.",
    priceLine:
      "Early bird from $149 on Kickstarter — a fraction of the price of a traditional dive computer.",
    backgroundAlt: "Scuba diver exploring a vibrant coral reef",
    sideImageAlt: "Watch Dive underwater hero product shot",
    // 60 m rating — pressure-test certificate pending (unverified claim).
    stat1Label: "60 m",
    stat1Desc: "Rated housing",
    stat2Label: "Scuba + Freedive",
    stat2Desc: "Dual modes",
    // Price claim — cost/quantity/conditions unconfirmed.
    stat3Label: "$149",
    stat3Desc: "50% off · early bird",
    wasPrice: "$299",
    nowPrice: "$149",
    offBadge: "50% off",
    offNote: "early bird at Kickstarter launch",
    gift: "Then share your link with the divers you'd actually go in the water with.",
    trust1: "Sign up to hear first about launch and early-bird details.",
    trust2: "No spam — one email when we go live.",
    // NVIDIA/AWS backing — membership evidence pending internal confirmation.
    backedBy: "Backed by",
    featuredBy: "Featured by",
    nvidiaAlt: "NVIDIA Inception",
    awsAlt: "Amazon Web Services",
    samsungAlt: "Samsung",
    promiseKicker: "The Watch Dive promise",
    promiseText: "A real dive computer feel for a fraction of the price",
    cardKicker: "Kickstarter promise",
    cardHeadline: "Depth. Safety. No-Deco.",
    cardFrom: "From",
    cardPrice: "$149",
  },
  value: {
    kicker: "Why Watch Dive",
    h2: "Why spend $1,000 on a separate dive computer when you already own a compatible smartwatch?",
    imageAlt: "Watch Dive housings displayed on a boat deck",
    overlayKicker: "Why divers love it",
    overlayText: "Premium dive gear feel, without the premium price.",
    lead: "Watch Dive lets new and recreational divers use key dive-computer functions on the watch they already own — at a price that makes sense.",
    card1Title: "Use what you own",
    card1Copy:
      "Built around the Apple Watch and Galaxy Watch you already wear — no second device to buy.",
    card2Title: "Premium build",
    card2Copy: "Clear housing, bold on-screen UI, and refined black and white variants.",
    card3Title: "Real dive value",
    card3Copy: "The scuba numbers that matter — without a $1,000 dive computer.",
    card4Title: "Shareable dives",
    card4Copy: "Connected app and striking visuals make every dive easy to remember and share.",
  },
  functions: {
    kicker: "Built for real recreational diving",
    h2: "Track depth, dive time, temperature, safety stops, ascent rate, and NDL — in one system.",
    // `\u005cu00a0` = the source's 60&nbsp;m.
    sub: "60\u00a0m waterproof. Scuba and freediving modes both supported.",
    videoAria: "Watch Dive functions in action",
    // "9–18 m/min" — industry convention, no internal source document cited.
    item1Title: "Ascent-Rate Alert",
    item1Body:
      "Watch Dive monitors ascent rate and provides alerts in the 9–18 m/min range — no buttons, no menus.",
    item2Title: "No-Deco / NDL",
    item2Body:
      "Watch Dive is 60 m waterproof and calculates your NDL in real time to help you track remaining bottom time.",
    item3Title: "Depth, Time & Temperature",
    item3Body:
      "Real-time depth, elapsed dive time, and water temperature — all logged automatically and synced to your Diveroid App logbook via Bluetooth after every dive.",
    item4Title: "Scuba + Freediving",
    item4Body:
      "Watch Dive supports both scuba and freediving — switch modes in seconds. All of it, from $149.",
  },
  how: {
    kicker: "How it works",
    h2: "Three steps. One dive computer solution.",
    step1Title: "Place your smartwatch inside Watch Dive",
    step1Body: "Slide your Apple Watch or Galaxy Watch into the waterproof housing.",
    step1Alt: "Hands placing a smartwatch into the Watch Dive housing",
    step2Title: "Dive with real-time guidance",
    step2Body: "Depth, dive time, temperature, ascent rate, and safety stops on your wrist.",
    step2Alt: "Freediver wearing Watch Dive at the pool edge",
    step3Title: "Sync your dive log after surfacing",
    step3Body: "Review profile, logbook, and memories in the connected app.",
    step3Alt: "Diver reviewing dive log in the connected app poolside",
  },
  app: {
    kicker: "Connected app · Diveroid 3.0",
    h2: "Your dive, saved automatically.",
    lead: "The moment you surface, Watch Dive syncs to the DIVEROID App 3.0 — auto-log every dive, share your footage with live dive data, and discover new sites nearby.",
    leadHighlight: "DIVEROID App 3.0",
    tab1: "Auto",
    tab1Desc: "Logbook & gallery",
    screen1Title: "Auto logbook & gallery",
    screen1Body: "Every dive auto-logged with depth profile, stats, and your photos.",
    tab2: "Share",
    tab2Desc: "Data-overlay clips",
    screen2Title: "Share with dive data",
    screen2Body: "Overlay depth, time, and location right onto your shots.",
    tab3: "Sites",
    tab3Desc: "Discover & review",
    screen3Title: "Dive sites near you",
    screen3Body: "Discover spots, live conditions, and top-rated sites nearby.",
    showAria: "Show {title}",
    gotoAria: "Go to {title}",
    prevAria: "Previous",
    nextAria: "Next",
  },
  reviews: {
    kicker: "From our beta testers",
    // Beta-programme claim; individual reviews use the Product Truth allowlist.
    h2: "{count} beta testers shared their impressions",
    sub: "Translation notice: Some reviews have been translated for readability, so minor differences in tone or nuance may remain.",
    disclosure:
      "Showing {published} of {total}. The rest mention product details we haven't finished verifying, so we're holding them back until we have.",
    countryUS: "United States",
    countryUK: "United Kingdom",
    countryKR: "South Korea",
    countrySG: "Singapore",
  },
  compat: {
    kicker: "Compatibility",
    // Final per-model compatibility matrix pending (unverified claim).
    h2: "Compatible with supported Apple Watch and Galaxy Watch models",
    lead: "Only a handful of watches ship with a depth sensor. The Watch Dive housing adds one, so the watch already on your wrist works as a dive computer either way.",
    housingBadge: "For supported models",
    housingTitle: "Housing + App",
    housingLead: "No depth sensor? The housing brings its own.",
    housingBody:
      "Your watch does not need a sensor of its own. It goes in the Watch Dive housing, and the app reads depth from the housing.",
    housingModel1: "All other Apple Watch models",
    housingModel2: "Galaxy Watch4, Galaxy Watch4 Classic, Galaxy Watch5, Galaxy Watch5 Pro",
    housingModel3:
      "Galaxy Watch6, Galaxy Watch6 Classic, Galaxy Watch FE, Galaxy Watch7, Galaxy Watch Ultra",
    housingModel4: "Galaxy Watch8, Galaxy Watch8 Classic, Galaxy Watch9",
    housingAlt: "Watch Dive waterproof housing",
    appOnlyTitle: "App Only",
    appOnlyBody: "For the few watches with a depth sensor already built in.",
    appOnlyModel1: "Apple Watch Ultra",
    appOnlyModel2: "Apple Watch Ultra 2, Apple Watch Ultra 3",
    appOnlyModel3: "Galaxy Watch Ultra2",
    watchScreenAlt: "Watch Dive app running on a smartwatch",
    footnote: "More models are being verified — join the waitlist to get the final list at launch.",
  },
  cameras: {
    kicker: "Works with action cameras",
    h3: "Pairs with your action camera",
    lead: "Works with GoPro, Insta360, Canon, and more — unified dive log + media in one app. Sync your footage with every dive automatically.",
    chipMore: "& more",
    videoAria: "Action camera pairing and auto dive log in the connected app",
  },
  safety: {
    kicker: "Built for real diving",
    // ‑ = the source's non-breaking hyphens.
    h2: "Serious safety, at an entry‑level price.",
    // 60 m rating / pressure test — certificate pending (unverified claim).
    point1Title: "60 m rating under verification",
    point1Body:
      "We are verifying the housing's 60 m rating before publishing the supporting test evidence.",
    // Ocean-dive validation — test evidence pending (unverified claim).
    point2Title: "Ocean-dive evidence under review",
    point2Body: "We are reviewing the dive records before publishing this validation claim.",
    point3Title: "Core safety functions",
    point3Body:
      "No‑decompression limit, ascent‑rate alert, and safety‑stop guidance on your wrist.",
    disclaimer:
      "Watch Dive is a dive aid, not a replacement for proper training. Always dive within your certification and limits, follow standard safety procedures, and keep a backup dive computer.",
  },
  offer: {
    imageAlt: "Watch Dive Kickstarter launch banner",
    kicker: "Kickstarter Early Bird · 50% off",
    headline: "$299 $149 — 50% off.",
    headlineStrike: "$299",
    headlineNew: "$149",
    lead: "Sign up to hear first when Watch Dive launches and receive details of the $149 early-bird offer before the $299 public price.",
    leadHighlight: "hear first",
  },
  creds: {
    heading: "Built by a proven team",
    // NVIDIA Inception membership — evidence pending internal confirmation.
    nvidiaAlt: "NVIDIA Inception Program member badge",
    nvidiaTitle: "Member of NVIDIA Inception",
    nvidiaBody: "NVIDIA's program for startups building with AI and accelerated computing.",
    awsAlt: "Amazon Web Services logo",
    awsTitle: "Powered by AWS",
    awsBody: "Our app and dive data run on Amazon Web Services.",
    // Samsung campaign appearance — rights/evidence pending confirmation.
    samsungAlt: "DIVEROID diving gear featured in a Samsung campaign",
    samsungFeatured: "As featured by",
    samsungLogoAlt: "Samsung",
    samsungBody: "Our diving gear appeared in a Samsung smartphone advertisement.",
  },
  faq: {
    kicker: "FAQ",
    h2: "Good questions, short answers.",
    q1: "Is Watch Dive a standalone dive computer?",
    a1: "No. Watch Dive turns your compatible smartwatch into a dive computer solution using the housing, sensor, and connected app.",
    // 60 m / 40 m figures — certificate pending (unverified claim).
    q2: "How deep can I use it?",
    a2: "Watch Dive is rated to 60 m, with a recommended recreational operating depth of 40 m.",
    q3: "Does it support safety stop and no-decompression limits?",
    a3: "Yes. It supports key recreational dive functions including safety stop, ascent-rate alert, depth, dive time, temperature, and no-decompression guidance.",
    q4: "Does it work for freediving?",
    a4: "Yes. Watch Dive supports both scuba diving and freediving.",
    q5: "When does it launch?",
    a5: "The Kickstarter campaign opens on 10 August. Join the waitlist and we email you the link the moment it is live.",
    q6: "Is my smartwatch compatible?",
    a6: "Watch Dive supports all Apple Watch models, plus these Samsung watches: Galaxy Watch4, Galaxy Watch4 Classic, Galaxy Watch5, Galaxy Watch5 Pro, Galaxy Watch6, Galaxy Watch6 Classic, Galaxy Watch FE, Galaxy Watch7, Galaxy Watch Ultra, Galaxy Watch8, Galaxy Watch8 Classic, Galaxy Watch9, and Galaxy Watch Ultra2. Apple Watch Ultra, Apple Watch Ultra 2, Apple Watch Ultra 3, and Galaxy Watch Ultra2 have built-in depth (pressure) and water-temperature sensors, so they work with the Watch Dive app alone. Every other supported watch uses the Watch Dive sensor housing together with the app.",
    q7: "How does it work?",
    a7: "The Watch Dive housing measures pressure and water temperature with its built-in sensors, connects to your smartwatch over Bluetooth, and sends the readings straight to the app.",
    q8: "How long does the battery last, and can it be replaced?",
    a8: "The battery warranty runs for two years or 1,000 dives, whichever comes first. After that, an authorized Watch Dive service center can replace a worn battery for a fee.",
  },
  footer: {
    brand: "Watch Dive",
    // Operator entity here (DIVEROID LTD, England) differs from Privacy/Terms
    // (OceanWick Inc., Korea) — reproduced as-is, flagged in the file header.
    legal:
      "© {year} Watch Dive, operated by DIVEROID LTD (company no. 16343651, registered in England). Launching soon on Kickstarter.",
    terms: "Terms",
    privacy: "Privacy Policy",
    nvidiaTrademark:
      "© {year} NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries.",
  },
  countdown: {
    launched: "The Kickstarter campaign is opening now.",
    opens: "Kickstarter opens 10 August",
    ariaPending: "Time until the Kickstarter launch",
    ariaLive:
      "{days} days, {hours} hours, {minutes} minutes and {seconds} seconds until the Kickstarter launch",
    days: "Days",
    hrs: "Hrs",
    min: "Min",
    sec: "Sec",
  },
  progress: {
    countLine: "{total} / {cap} divers",
    closedLabel: "List closed",
    spotsLeft: "{remaining} spots left",
    capNote: "The waitlist is capped at {cap} divers and closes when it is full.",
    aria: "Pre-launch waitlist places taken",
  },
  verify: {
    metaTitle: "Confirm your email — Watch Dive",
    metaDescription: "Confirm your Watch Dive waitlist email.",
    back: "← Watch Dive",
    confirmingTitle: "Confirming your email…",
    confirmingBody: "One moment while we confirm this address.",
    waitingTitle: "Confirm your email",
    waitingBody: "Nothing has been confirmed yet. Press the button to finish.",
    confirmButton: "Confirm my email",
    verifiedTitle: "Your waitlist email is confirmed",
    verifiedBody:
      "You're on the list. We'll email you the Kickstarter link the moment the campaign opens on 10 August.",
    buddyTitle: "Bring a buddy",
    buddyBody: "Share your link with divers who'd want this.",
    backHome: "Back to Watch Dive",
    expiredTitle: "This link has expired",
    expiredBody:
      "Confirmation links last 24 hours. Head back to the Watch Dive page and submit the form again to get a fresh one.",
    invalidTitle: "This link is not valid",
    invalidBody:
      "It may already have been replaced by a newer confirmation email. Head back to the Watch Dive page and submit the form again.",
    errorTitle: "We could not confirm just now",
    errorBody: "Your link is still valid. Please try again.",
    tryAgain: "Try again",
    footerPrivacy: "Privacy",
    footerTerms: "Terms",
  },
  errors: {
    notFoundHeading: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or has been moved.",
    goHome: "Go home",
    errorTitle: "This page didn't load",
    errorBody: "Something went wrong on our end. You can try refreshing or head back home.",
    tryAgain: "Try again",
  },
  privacy: {
    metaTitle: "Privacy Policy — Watch Dive",
    metaDescription:
      "How OceanWick Inc. handles your information when you sign up for Watch Dive pre-launch updates.",
    back: "← Back to home",
    h1: "Privacy Policy — Watch Dive Pre-Launch",
    effectiveLabel: "Effective date:",
    effectiveDate: "July 30, 2026",
    intro1:
      'This Privacy Policy explains how OceanWick Inc. ("we", "us", "DIVEROID") handles your information when you sign up on the Watch Dive pre-launch page to receive updates about our upcoming Kickstarter campaign.',
    intro2:
      "This page is for collecting launch interest only. It is not a store and does not process any payment.",
    s1Title: "1. Who we are",
    s1Company: "Company: OceanWick Inc. (오션윅 주식회사)",
    s1Rep: "Representative: Jay Kim",
    s1Addr: "Address: 1114, 145 Dosan-daero, Gangnam-gu, Seoul 06036, Republic of Korea",
    s1Reg: "Business registration no.: 716-81-03722",
    s1Contact: "Privacy contact: help@diveroid.com",
    s2Title: "2. What we collect",
    s2Email:
      "Email address (required) — to send the confirmation you request and, after you confirm, Watch Dive launch updates.",
    s2Phone: "Phone number (optional) — only if you choose to receive a VIP SMS launch alert.",
    s2Security:
      "Security signals — abuse flags and a short-lived, keyed network bucket used in server memory to limit automated or repeated requests. We do not retain the raw IP address, the network bucket, or the full browser user-agent in the lead record.",
    s2Usage:
      "Basic usage data — page visits and device type collected through standard web analytics tools where measurement is enabled.",
    s2NoPayment: "We do not collect payment details on this page.",
    s3Title: "3. Why we use it",
    s3Intro: "We use the information you provide to:",
    s3Item1: "send a one-time link to confirm that you control the email address;",
    s3Item2: "send you a notification when Watch Dive launches on Kickstarter;",
    s3Item3: "share early-bird pricing and launch-related updates;",
    s3Item4: "protect the form and our email delivery service from abuse;",
    s3Item5: "understand how the page performs so we can improve it.",
    s3Outro: "We will not use your information for unrelated purposes.",
    s4Title: "4. Legal basis",
    s4Body:
      "Submitting the form requests an operational confirmation email. Your waitlist registration and consent to launch updates are completed only after you use the confirmation link. You can withdraw your consent at any time (see Section 7).",
    s5Title: "5. Sharing and international transfer",
    s5Body:
      "We use trusted service providers to operate this page and send confirmations or updates — for example transactional email and SMS delivery services, web hosting, and analytics providers. These providers may store data on servers located outside Korea, including in the United States. We only share what is necessary for them to provide their service, and we never sell your personal information.",
    s6Title: "6. How long we keep it",
    s6Body:
      "We keep your information until the Watch Dive launch campaign ends or until you ask us to delete it or unsubscribe — whichever comes first. After that, we delete it without undue delay.",
    s7Title: "7. Your rights",
    s7Intro: "You can at any time:",
    s7Item1: "ask what information we hold about you;",
    s7Item2: "ask us to correct or delete it;",
    s7Item3: "unsubscribe from emails (via the link in any email we send) or SMS;",
    s7Item4: "withdraw your consent.",
    s7Outro: "To exercise any of these rights, email help@diveroid.com.",
    s8Title: "8. Children",
    s8Body:
      "This page is not intended for children under 14, and we do not knowingly collect information from them.",
    s9Title: "9. Changes to this policy",
    s9Body:
      "We may update this Privacy Policy from time to time. The latest version will always be available on this page, with the effective date shown at the top.",
    s10Title: "10. Contact",
    s10Body: "Questions about your privacy? Email help@diveroid.com.",
    footerLine: "OceanWick Inc. · 145 Dosan-daero, Gangnam-gu, Seoul, Republic of Korea",
  },
  terms: {
    metaTitle: "Terms of Use — Watch Dive",
    metaDescription: "Terms of Use for the Watch Dive pre-launch page, operated by OceanWick Inc.",
    back: "← Back to home",
    h1: "Terms of Use — Watch Dive Pre-Launch",
    effectiveLabel: "Effective date:",
    effectiveDate: "July 30, 2026",
    intro:
      'Welcome to the Watch Dive pre-launch page, operated by OceanWick Inc. ("we", "us", "DIVEROID"). By using this page and signing up, you agree to the following terms.',
    s1Title: "1. What this page is",
    s1Body:
      "This page lets you register your interest in Watch Dive and receive updates about our upcoming Kickstarter campaign. It is not a store. No purchase is made and no payment is taken here.",
    s2Title: "2. Pre-launch information",
    s2Body:
      "Watch Dive is still in development. All details shown here — including features, compatibility, specifications, pricing (such as the early-bird price), and the launch date — are provided for information only and may change before or during the Kickstarter campaign. Signing up does not reserve a unit or guarantee a specific price.",
    s3Title: "3. Email and SMS updates",
    s3Body:
      "Submitting the form requests one operational email containing a confirmation link. Your waitlist registration and agreement to receive launch and marketing updates are completed only when you use that link. If you also provide a phone number, you agree to the optional SMS update described beside that field. You can unsubscribe from future marketing at any time using the link in a marketing email or by contacting us. How we handle your data is described in our Privacy Policy.",
    s3PrivacyLink: "Privacy Policy",
    s4Title: "4. Intellectual property",
    s4Body:
      "All content on this page — including the Watch Dive and DIVEROID names, logos, text, images, and videos — belongs to OceanWick Inc. or its licensors. You may not copy or reuse it without our permission.",
    s5Title: "5. Disclaimer",
    s5Body1:
      "Watch Dive is a dive aid designed to work with a compatible smartwatch. When released, it is intended to support — not replace — proper dive training, certification, and a backup dive computer. Always dive within your training and follow safe diving practices.",
    s5Body2:
      'This page is provided "as is" without warranties of any kind. We are not liable for any damages arising from your use of this page.',
    s6Title: "6. Governing law",
    s6Body: "These terms are governed by the laws of the Republic of Korea.",
    s7Title: "7. Contact",
    s7Body: "Questions? Email help@diveroid.com.",
    footerLine:
      "OceanWick Inc. · 145 Dosan-daero, Gangnam-gu, Seoul, Republic of Korea · Business registration no. 716-81-03722",
  },
};

export type FrozenLandingMessages = typeof EN_FROZEN_LANDING_MESSAGES;
