// Static guarantees about the shipped source: what /verify may load, what the
// client may import, what CSRF covers, and that the Claim hotfix and favicon
// survived. These read the tree rather than a fake, because the property being
// asserted is about the code that ships.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { COUNTABLE_STATUS_FILTER } from "../src/lib/verification/notionLead.ts";
import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const VERIFY_CLIENT_SOURCES = ["src/routes/verify.tsx", "src/routes/$locale.verify.tsx"] as const;

const CLIENT_ROUTE_SOURCES = [
  "src/routes/index.tsx",
  "src/routes/verify.tsx",
  "src/routes/$locale.tsx",
  "src/routes/$locale.index.tsx",
  "src/routes/$locale.verify.tsx",
  "src/routes/__root.tsx",
  "src/routes/privacy.tsx",
  "src/routes/terms.tsx",
  "src/routes/$locale.privacy.tsx",
  "src/routes/$locale.terms.tsx",
  "src/routes/r.$code.tsx",
  "src/routes/$locale.r.$code.tsx",
] as const;

// ---------------------------------------------------------------------------
// /verify carries a token in its fragment, so nothing third-party may run there
// ---------------------------------------------------------------------------

test("the route gate isolates /verify in every supported locale", () => {
  for (const path of [
    "/verify",
    "/en/verify",
    "/ko/verify",
    "/zh-cn/verify",
    "/zh-tw/verify",
    "/ja/verify",
    "/es/verify",
    "/fr/verify",
    "/de/verify",
    "/pt-br/verify",
  ]) {
    assert.equal(allowsThirdPartyScripts(path), false, `${path} allowed third-party scripts`);
    assert.equal(
      allowsThirdPartyScripts(`${path}/`),
      false,
      `${path}/ allowed third-party scripts`,
    );
  }
  assert.equal(allowsThirdPartyScripts("/"), true);
  assert.equal(allowsThirdPartyScripts("/privacy"), true);
  assert.equal(allowsThirdPartyScripts("/terms"), true);
});

test("the verify surface imports no analytics, pixel or widget", () => {
  for (const path of VERIFY_CLIENT_SOURCES) {
    const source = read(path);
    for (const forbidden of [
      "@vercel/analytics",
      "metaPixel",
      "widget.js",
      "connect.facebook.net",
    ]) {
      assert.ok(!source.includes(forbidden), `${path} imports ${forbidden}`);
    }
  }
});

test("the verify surface emits no external script or frame URL of its own", () => {
  for (const path of VERIFY_CLIENT_SOURCES) {
    const source = read(path);
    const externals = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    assert.deepEqual(externals, [], `${path} references external URLs: ${externals.join(", ")}`);
  }
});

test("the route gate module names the widget, so no route hardcodes it", () => {
  const gate = read("src/lib/thirdPartyScripts.ts");
  assert.ok(gate.includes("export const SUPPORT_WIDGET_SRC"));
  assert.ok(gate.includes('TOKEN_BEARING_ROUTES = new Set(["/verify"])'));
  assert.ok(gate.includes("stripLocalePrefix(pathname)"));
});

test("the root mounts every third-party script behind the route gate", () => {
  const source = read("src/routes/__root.tsx");
  // Nothing third-party may sit in the always-rendered path.
  assert.ok(source.includes("const thirdParty = allowsThirdPartyScripts(pathname)"));
  assert.match(source, /\{thirdParty\s*&&\s*META_PIXEL_READY\s*&&/);
  assert.ok(source.includes("!LAUNCHOS_BROWSER_MEASUREMENT_ENABLED || launchOsConsentLocale"));
  assert.ok(source.includes("{thirdParty && <Analytics />}"));
  assert.ok(source.includes("{thirdParty && <script src={SUPPORT_WIDGET_SRC} defer />}"));
  assert.ok(source.includes("if (!allowsThirdPartyScripts(pathname)) return;"));
  // The widget must no longer be a static head script, which no route can drop.
  assert.ok(!/scripts:\s*\[/.test(source), "root still declares static head scripts");
});

test("the restored no-banner design keeps Meta fail-closed and honors privacy signals", () => {
  const root = read("src/routes/__root.tsx");
  const pixel = read("src/lib/metaPixel.ts");

  assert.ok(root.includes('VITE_META_TRACKING_ENABLED ?? "").toLowerCase() === "true"'));
  assert.ok(root.includes("/^\\d{10,20}$/.test(META_PIXEL_ID)"));
  const storedDenial = root.indexOf(
    'localStorage.getItem("watchdive.measurement-consent.v3")==="denied"',
  );
  const globalPrivacyControl = root.indexOf("navigator.globalPrivacyControl===true");
  const injectPixel = root.indexOf('s.src="https://connect.facebook.net/en_US/fbevents.js"');
  assert.ok(storedDenial > 0 && storedDenial < injectPixel, "stored opt-out runs after pixel load");
  assert.ok(
    globalPrivacyControl > 0 && globalPrivacyControl < injectPixel,
    "Global Privacy Control runs after pixel load",
  );

  assert.ok(
    pixel.includes('if (typeof window === "undefined" || !hasMetaMeasurementConsent()) return;'),
  );
  assert.ok(pixel.includes('getMetaMeasurementConsent() === "denied"'));
  assert.ok(pixel.includes("globalPrivacyControl") && pixel.includes("!== true"));
  assert.ok(pixel.includes('window.fbq("consent", "revoke")'));
});

test("the client relay has no Node crypto or secret-bearing implementation", () => {
  const client = read("src/lib/api/launchOsRelay.ts");
  assert.ok(client.includes('await import("./launchOsRelay.server.ts")'));
  assert.ok(!client.includes('from "node:crypto"'));
  assert.ok(!client.includes("LAUNCHOS_WEB_EVENTS_INGRESS_SECRET"));
  assert.ok(!client.includes("WAITLIST_REPLAY_HMAC_SECRET"));
});

test("the revised privacy notice dates and bounds LaunchOS retention", () => {
  const route = read("src/routes/privacy.tsx");
  const english = read("src/lib/i18n/frozen-landing-en.ts");
  const korean = read("src/lib/i18n/frozen-landing-messages.ts");
  assert.ok(english.includes('effectiveDate: "August 2, 2026"'));
  assert.ok(korean.includes('effectiveDate: "2026년 8월 2일"'));
  assert.ok(route.includes("pseudonymous random visit ID"));
  assert.ok(route.includes("Meta campaign, ad set and ad IDs"));
  assert.ok(route.includes("never for more than 400 days from collection"));
  assert.ok(route.includes("런칭 캠페인 종료 또는 삭제 요청 중 먼저 도래"));
});

test("a fresh server grant resets one-shot browser funnel state before reload", () => {
  const control = read("src/components/optional-measurement-control.tsx");
  const choose = control.indexOf("const choose = async");
  const reset = control.indexOf("optionalMeasurementChoiceRequiresDocumentReset(previous", choose);
  const clear = control.indexOf("clearBrowserWatchDiveMeasurementContext();", reset);
  const reload = control.indexOf("window.location.reload();", clear);
  assert.ok(choose > 0 && reset > choose && clear > reset && reload > clear);
});

test("homepage metadata stays route-scoped and unverified claims stay out of shared surfaces", () => {
  const root = read("src/routes/__root.tsx");
  const index = read("src/routes/index.tsx");
  const localizedIndex = read("src/routes/$locale.index.tsx");
  const seo = read("src/lib/i18n/seo.ts");
  const loader = read("src/lib/i18n/frozen-landing-loader.ts");

  assert.ok(index.includes('landingHead("en")'));
  assert.ok(localizedIndex.includes("landingHead(locale, match.context.messages)"));
  assert.ok(!root.includes("landingHead"), "shared root still owns homepage metadata");

  // These product and offer claims are not verified in Product Truth. They
  // must not be restored by shared metadata or by a token-bearing page.
  for (const path of ["src/routes/__root.tsx", "src/lib/i18n/seo.ts", ...VERIFY_CLIENT_SOURCES]) {
    const source = read(path).toLowerCase();
    for (const claim of ["$149 early bird", "60 m dive computer"]) {
      assert.ok(!source.includes(claim), `${path} carries unverified claim: ${claim}`);
    }
  }

  assert.ok(seo.includes("const copy = messages.meta"));
  assert.ok(loader.includes('await import("./frozen-landing-messages")'));
  for (const clientSource of [root, index, localizedIndex, seo]) {
    assert.ok(
      !clientSource.includes('from "@/lib/i18n/frozen-landing-messages"') &&
        !clientSource.includes('from "./frozen-landing-messages"'),
      "a canonical client surface statically imports every locale catalog",
    );
  }
});

test("the fragment is stripped before the confirmation POST is awaited", () => {
  const source = read("src/routes/verify.tsx");
  const readFragment = source.indexOf(
    "const fragmentToken = tokenFromFragment(window.location.hash)",
  );
  const strip = source.indexOf("window.history.replaceState");
  const post = source.indexOf("void confirm()");
  assert.ok(readFragment > 0, "the implementation no longer reads a fragment token");
  assert.ok(
    readFragment < strip && post > strip,
    "the fragment is not read, stripped, then POSTed in that order",
  );
});

test("both verify routes preserve no-referrer, noindex and one isolated implementation", () => {
  const canonical = read("src/routes/verify.tsx");
  const localized = read("src/routes/$locale.verify.tsx");

  for (const source of [canonical, localized]) {
    assert.ok(source.includes('{ name: "referrer", content: "no-referrer" }'));
    assert.ok(source.includes('{ name: "robots", content: "noindex, nofollow, noarchive" }'));
  }

  assert.ok(canonical.includes("component: VerifyPage"));
  assert.ok(localized.includes('import { VerifyPage } from "@/routes/verify"'));
  assert.ok(localized.includes("component: VerifyPage"));
});

// ---------------------------------------------------------------------------
// Server-only material must not be reachable from a client route
// ---------------------------------------------------------------------------

test("no client route imports the provider, the store or the secrets", () => {
  for (const route of CLIENT_ROUTE_SOURCES) {
    const source = read(route);
    for (const forbidden of [
      "verification/resend",
      "verification/notionLead",
      "verification/deps.server",
      "RESEND_API_KEY",
      "NOTION_API_KEY",
      "WATCHDIVE_VERIFICATION_SECRET",
    ]) {
      assert.ok(!source.includes(forbidden), `${route} reaches server-only material: ${forbidden}`);
    }

    // tokenShape is deliberately client-safe; only the HMAC token module is
    // forbidden from a route or component bundle.
    assert.doesNotMatch(
      source,
      /["'](?:@\/|\.\.\/|\.\/)*lib\/verification\/token(?:\.ts)?["']/,
      `${route} imports the server-only signing token module`,
    );
  }
});

test("the secrets are read only where they are used, never in a shared client module", () => {
  const deps = read("src/lib/verification/deps.server.ts");
  assert.ok(deps.includes("createResendMailer"));
  assert.ok(deps.includes("createNotionLeadStore"));
  // The name is the contract: `.server.ts` is what keeps it off the client.
  assert.ok(deps.includes("createServiceDependencies"));
});

test("errors handed back to a caller are opaque", () => {
  const deps = read("src/lib/verification/deps.server.ts");
  assert.ok(deps.includes('new Error("Request failed")'));
  // Only the error name is logged — never a message, body, address or token.
  assert.ok(deps.includes("error instanceof Error ? error.name"));

  const fns = read("src/lib/api/waitlist.functions.ts");
  for (const scope of ["verification-request", "verification-confirm", "verification-poll"]) {
    assert.ok(fns.includes(`sanitizeServerError("${scope}"`), `${scope} is not sanitized`);
  }
});

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

test("CSRF validation is installed and scoped to server functions", () => {
  const start = read("src/start.ts");
  assert.ok(start.includes("createCsrfMiddleware"));
  assert.ok(start.includes('context.handlerType === "serverFn"'));
  assert.ok(start.includes("requestMiddleware: [csrfMiddleware, errorMiddleware]"));
});

test("the confirmation is a POST server function, never a GET route", () => {
  const fns = read("src/lib/api/waitlist.functions.ts");
  assert.ok(fns.includes('export const confirmVerification = createServerFn({ method: "POST" })'));
  assert.ok(fns.includes('export const pollVerification = createServerFn({ method: "POST" })'));
  // A GET handler on /verify would be a state change a link preview could trip.
  for (const path of VERIFY_CLIENT_SOURCES) {
    const source = read(path);
    assert.ok(!source.includes("server:"), `${path} declares a server handler`);
  }
});

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

test("public counts are verified-or-legacy and non-suspect", () => {
  assert.deepEqual(COUNTABLE_STATUS_FILTER, {
    or: [
      { property: "Verification status", select: { equals: "verified" } },
      { property: "Verification status", select: { is_empty: true } },
    ],
  });

  const fns = read("src/lib/api/waitlist.functions.ts");
  assert.ok(fns.includes("const COUNTABLE = { and: [NOT_SUSPECT, COUNTABLE_STATUS_FILTER] }"));
  // Both public numbers go through it, so pending never inflates either.
  assert.ok(fns.includes("filter: COUNTABLE,"));
  assert.ok(fns.includes("...COUNTABLE.and],"));
});

// ---------------------------------------------------------------------------
// No client address or user agent is persisted, logged, or projected
// ---------------------------------------------------------------------------

test("the store never touches the legacy IP or User agent columns", () => {
  const store = read("src/lib/verification/notionLead.ts");

  // Not written, not read, not as a digest. The CRM is a projection of leads,
  // not a record of who connected from where.
  for (const forbidden of [
    "IP: textProp",
    "properties.IP",
    'properties["IP"]',
    '"User agent": textProp',
    'properties["User agent"]',
  ]) {
    assert.ok(!store.includes(forbidden), `the store touches ${forbidden}`);
  }
});

test("no verification module carries a client address on a record", () => {
  for (const path of [
    "src/lib/verification/contracts.ts",
    "src/lib/verification/notionLead.ts",
    "src/lib/verification/service.ts",
  ]) {
    const source = read(path);
    for (const forbidden of ["networkKey:", "ip:", "ua:"]) {
      assert.ok(!source.includes(forbidden), `${path} still carries ${forbidden}`);
    }
  }
});

test("the handler never queries or writes Notion by address", () => {
  const fns = read("src/lib/api/waitlist.functions.ts");

  assert.ok(!fns.includes('property: "IP"'), "the handler still queries Notion by address");
  assert.ok(!fns.includes("IP: textProp"), "the handler still writes an address");
  // The digest is a map key for an in-process counter and nothing else.
  assert.ok(fns.includes("networkGate.record(networkKey(ip, requireSecret(process.env)))"));
  assert.ok(fns.includes("const networkGate = createNetworkGate();"));
});

test("the address and user agent never reach a log", () => {
  for (const path of [
    "src/lib/api/waitlist.functions.ts",
    "src/lib/verification/service.ts",
    "src/lib/verification/notionLead.ts",
    "src/lib/verification/resend.ts",
    "src/lib/verification/networkGate.ts",
    "src/lib/verification/deps.server.ts",
  ]) {
    const source = read(path);
    for (const line of source.split("\n")) {
      if (!line.includes("console.")) continue;
      for (const forbidden of ["ip", "ua", "email", "token", "network"]) {
        assert.ok(
          !new RegExp(`console\\.[a-z]+\\([^)]*\\b${forbidden}\\b`).test(line),
          `${path} logs ${forbidden}: ${line.trim()}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Regressions the change had to preserve
// ---------------------------------------------------------------------------

test("the canonical-email dual-shape hotfix is untouched and still in the path", () => {
  const hotfix = read("src/lib/api/notionCanonicalEmail.ts");
  assert.ok(hotfix.includes("export async function withCanonicalEmailShape"));
  assert.ok(hotfix.includes("isCanonicalEmailShapeError"));

  const store = read("src/lib/verification/notionLead.ts");
  // Both the lookup and the create must go through it, or a live schema flip
  // breaks Claim again.
  assert.equal(store.split("withCanonicalEmailShape(() =>").length - 1, 2);
});

test("the Claim form still submits through joinWaitlist with its honeypot", () => {
  const form = read("src/routes/index.tsx");
  assert.ok(form.includes("const res = await joinWaitlist({"));
  assert.ok(form.includes("honeypot: hp,"));
  assert.ok(form.includes('name="company"'));
  assert.ok(form.includes("measurementConsent: hasMetaMeasurementConsent(),"));
  assert.ok(form.includes("locale,"), "the verification email can lose the selected locale");
});

test("the favicon is still declared and still present", () => {
  const root = read("src/routes/__root.tsx");
  assert.ok(root.includes('href: "/favicon.svg"'));
  assert.ok(root.includes('rel: "icon"'));
  assert.ok(read("public/favicon.svg").includes("<svg"));
});
