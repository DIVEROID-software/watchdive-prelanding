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

// ---------------------------------------------------------------------------
// /verify carries a token in its fragment, so nothing third-party may run there
// ---------------------------------------------------------------------------

test("the route gate names /verify and nothing else", () => {
  assert.equal(allowsThirdPartyScripts("/verify"), false);
  assert.equal(allowsThirdPartyScripts("/verify/"), false);
  assert.equal(allowsThirdPartyScripts("/"), true);
  assert.equal(allowsThirdPartyScripts("/privacy"), true);
  assert.equal(allowsThirdPartyScripts("/terms"), true);
});

test("the verify route imports no analytics, pixel or widget", () => {
  const source = read("src/routes/verify.tsx");
  for (const forbidden of ["@vercel/analytics", "metaPixel", "widget.js", "connect.facebook.net"]) {
    assert.ok(!source.includes(forbidden), `/verify imports ${forbidden}`);
  }
});

test("the verify route emits no external script or frame URL of its own", () => {
  const source = read("src/routes/verify.tsx");
  const externals = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
  assert.deepEqual(externals, [], `/verify references external URLs: ${externals.join(", ")}`);
});

test("the route gate module names the widget, so no route hardcodes it", () => {
  const gate = read("src/lib/thirdPartyScripts.ts");
  assert.ok(gate.includes("SUPPORT_WIDGET_SRC"));
  assert.ok(gate.includes('TOKEN_BEARING_ROUTES = new Set(["/verify"])'));
});

test("the root mounts every third-party script behind the route gate", () => {
  const source = read("src/routes/__root.tsx");
  // Nothing third-party may sit in the always-rendered path.
  assert.ok(source.includes("{thirdParty && <Analytics />}"));
  assert.ok(source.includes("{thirdParty && <script src={SUPPORT_WIDGET_SRC} defer />}"));
  assert.ok(source.includes("if (!allowsThirdPartyScripts(pathname)) return;"));
  // The widget must no longer be a static head script, which no route can drop.
  assert.ok(!/scripts:\s*\[/.test(source), "root still declares static head scripts");
});

test("the verification page cannot inherit homepage marketing claims", () => {
  const root = read("src/routes/__root.tsx");
  const index = read("src/routes/index.tsx");
  const verify = read("src/routes/verify.tsx");

  // Homepage metadata belongs to the homepage route, not the root shared by
  // privacy, terms, and the new verification surface.
  for (const claim of ["$149 early bird", "60 m dive computer"]) {
    assert.ok(!root.includes(claim), `shared root still carries marketing claim: ${claim}`);
    assert.ok(!verify.includes(claim), `/verify carries marketing claim: ${claim}`);
    assert.ok(index.includes(claim), `homepage metadata lost while moving claim: ${claim}`);
  }
});

test("the fragment is stripped before the confirmation POST is awaited", () => {
  const source = read("src/routes/verify.tsx");
  const strip = source.indexOf("window.history.replaceState");
  const post = source.indexOf("void confirm()");
  assert.ok(strip > 0 && post > strip, "the token is POSTed before the fragment is stripped");
});

// ---------------------------------------------------------------------------
// Server-only material must not be reachable from a client route
// ---------------------------------------------------------------------------

test("no client route imports the provider, the store or the secrets", () => {
  for (const route of [
    "src/routes/index.tsx",
    "src/routes/verify.tsx",
    "src/routes/__root.tsx",
    "src/routes/privacy.tsx",
    "src/routes/terms.tsx",
  ]) {
    const source = read(route);
    for (const forbidden of [
      "verification/resend",
      "verification/notionLead",
      "verification/deps.server",
      "verification/token",
      "RESEND_API_KEY",
      "NOTION_API_KEY",
      "WATCHDIVE_VERIFICATION_SECRET",
    ]) {
      assert.ok(!source.includes(forbidden), `${route} reaches server-only material: ${forbidden}`);
    }
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
  const route = read("src/routes/verify.tsx");
  assert.ok(!route.includes("server:"), "/verify declares a server handler");
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
  const index = read("src/routes/index.tsx");
  assert.ok(index.includes("const res = await joinWaitlist({"));
  assert.ok(index.includes("honeypot: hp,"));
  assert.ok(index.includes('name="company"'));
  assert.ok(index.includes("measurementConsent: hasMetaMeasurementConsent(),"));
});

test("the favicon is still declared and still present", () => {
  const root = read("src/routes/__root.tsx");
  assert.ok(root.includes('href: "/favicon.svg"'));
  assert.ok(root.includes('rel: "icon"'));
  assert.ok(read("public/favicon.svg").includes("<svg"));
});
