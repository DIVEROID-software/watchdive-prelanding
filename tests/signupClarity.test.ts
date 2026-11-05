import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import ts from "typescript";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import { SIGNUP_CLARITY_COPY } from "../src/lib/signupClarityCopy.ts";
import { ONSITE_OFFER_COPY } from "../src/components/reservation/onsite-copy.ts";

const root = resolve(import.meta.dirname, "..");
const cache = join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, "signup-clarity-"));
after(() => rmSync(temporary, { recursive: true, force: true }));

// Compile the production components, JSX and event handlers verbatim. Only
// useState initializers are injected by name, and effects are disabled, so
// these isolated renders never submit, poll, mail, pay or emit analytics.
// Child panels are markers: their mount/credential contract is tested here;
// their own behavior remains covered by the reservation/phone suites.
const source = ts.createSourceFile(
  "index.tsx",
  readFileSync(join(root, "src/routes/index.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functionNames = new Set([
  "formatMessage", "webmailFor", "isInAppBrowser", "CheckInboxCard", "EmailForm", "AcquisitionTools",
]);
const constantNames = new Set(["WEBMAIL", "ENTRY_POPUP_DOM_ID"]);
const selected = source.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && functionNames.has(node.name?.text ?? "")) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && constantNames.has(declaration.name.text))),
);
assert.equal(selected.length, functionNames.size + constantNames.size);
const printer = ts.createPrinter();
const declarations = selected.map((statement) => {
  if (!ts.isFunctionDeclaration(statement)) return statement.getText(source);
  const component = statement.name!.text;
  const transformed = ts.transform(statement, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
        node.initializer && ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "useState") {
        const field = node.name.elements[0].name!.getText(source);
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.createCallExpression(ts.factory.createIdentifier("fixtureUseState"), undefined, [
            ts.factory.createStringLiteral(`${component}.${field}`), ...node.initializer.arguments,
          ]));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit) as ts.FunctionDeclaration;
  }]);
  const printed = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], source);
  transformed.dispose();
  return printed;
}).join("\n");

const outfile = join(temporary, "components.mjs");
await build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { FROZEN_LANDING_MESSAGES } from "./src/lib/i18n/frozen-landing-messages.ts";
      import { conversionCopy } from "./src/lib/conversionCopy.ts";
      import { SIGNUP_CLARITY_COPY } from "./src/lib/signupClarityCopy.ts";
      import { ONSITE_OFFER_COPY } from "./src/components/reservation/onsite-copy.ts";
      import { spamFolderHintFor } from "./src/lib/spamFolderHint.ts";
      import { phoneRetryDraft } from "./src/components/initial-phone-consent.ts";
      import { socialAuthResultCopy } from "./src/lib/socialAuthResultCopy.ts";
      import { RETARGETING_COPY } from "./src/components/retargeting/copy.ts";
      import { ENTRY_COPY } from "./src/components/retargeting/entry-copy.ts";
      let fixture = {}, currentLocale = "en", entryCaptureFlag;
      export let calls = [], writes = [];
      export function configure(locale, state = {}) {
        currentLocale = locale; fixture = state; calls = []; writes = [];
        entryCaptureFlag = state.entryCaptureFlag;
      }
      function fixtureUseState(key, initial) {
        return [Object.hasOwn(fixture, key) ? fixture[key] : initial,
          value => { writes.push({key, value}); fixture[key] = value; }];
      }
      const useEffect = () => {}, useLayoutEffect = () => {};
      const useRef = current => ({ current });
      const useCurrentLocale = () => currentLocale;
      const useFrozenLandingMessages = () => FROZEN_LANDING_MESSAGES[currentLocale];
      const useConversionCopy = locale => conversionCopy[locale];
      const useSocialSignupCompleted = () => false;
      const useSocialContinuation = () => ({});
      const useReferralProgramEnabled = () => false;
      const defaultPhoneCountry = () => "US", getRef = () => undefined;
      const marker = name => props => {
        calls.push({name, props});
        return createElement("section", {"data-test-panel": name});
      };
      const SignupReservationOffer = marker("reservation");
      const PhoneOptInCard = marker("phone");
      const MeasurementAsk = marker("measurement");
      const ReferralSuccess = marker("referral");
      const SocialAuthEntry = marker("social");
      const EarlyBirdRace = marker("early-bird");
      const CompatibilityChecker = marker("compatibility");
      const EntryCapture = marker("entry");
      const ExitIntentCapture = marker("exit");
      const WebPushOptIn = marker("push");
      ${declarations}
    `,
    resolveDir: root,
    loader: "tsx",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  define: { "import.meta.env.VITE_WATCHDIVE_ENTRY_CAPTURE": "entryCaptureFlag" },
  external: ["react", "react/jsx-runtime", "react-dom"],
  alias: { "@": join(root, "src") },
  logLevel: "silent",
});
const ui = await import(pathToFileURL(outfile).href);
const presentation = { cta: "Fixture signup action", note: "Fixture confirmation instruction" };
const pendingState = {
  "EmailForm.pending": "Fixture accepted, awaiting confirmation",
  "EmailForm.handle": "fixture-private-attempt",
  "EmailForm.email": "fixture@gmail.com",
  "EmailForm.askMeasurement": true,
};

function render(locale: string, props: Record<string, unknown>, state = {}) {
  ui.configure(locale, state);
  return renderToStaticMarkup(createElement(ui.EmailForm, { id: "hero", ...props }));
}

function markup(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

function panelNames() { return ui.calls.map((call: { name: string }) => call.name); }

function nodes(element: unknown): { type: unknown; props: Record<string, any> }[] {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!isValidElement(element)) return [];
  const props = element.props as Record<string, any>;
  return [{ type: element.type, props }, ...nodes(props.children)];
}

test("segment pending shows inbox and one transparent optional-reservation note in every locale", () => {
  assert.deepEqual(Object.keys(SIGNUP_CLARITY_COPY).sort(), [...SUPPORTED_LOCALES].sort());
  for (const locale of SUPPORTED_LOCALES) {
    const html = render(locale, { presentation }, pendingState);
    const copy = SIGNUP_CLARITY_COPY[locale];
    const m = FROZEN_LANDING_MESSAGES[locale];
    assert.deepEqual(panelNames(), ["measurement"], locale);
    assert.ok(html.includes(`class="wd-signup-pending-note">${markup(copy.pendingReservation)} ${markup(ONSITE_OFFER_COPY[locale].separate)}</p>`), locale);
    assert.equal((html.match(/wd-signup-pending-note/g) ?? []).length, 1);
    assert.equal((html.match(/help@diveroid.com/g) ?? []).length, 1);
    for (const text of [copy.sender, m.inbox.help, m.inbox.noteSubject, m.inbox.noteButton, m.inbox.requirement, m.inbox.wrongAddress]) {
      assert.ok(html.includes(markup(text)), `${locale}: ${text}`);
    }
    assert.match(html, /id="hero-verify-inbox"/);
    assert.match(html, /disabled="" class="wd-resend"/);
    assert.doesNotMatch(html, /fixture-private-attempt|Fixture accepted/);
  }
});

test("compact pending is inbox-only, and the nonpresentation legacy offer and phone stay mounted", () => {
  for (const props of [
    { compact: true, presentation, domId: "entry-capture", id: "offer", recordFunnel: false },
    { compact: true },
  ]) {
    const html = render("en", props, pendingState);
    assert.deepEqual(panelNames(), ["measurement"]);
    assert.doesNotMatch(html, /wd-signup-pending-note|data-test-panel="(?:reservation|phone)"/);
  }
  const legacy = render("en", {}, pendingState);
  assert.deepEqual(panelNames(), ["reservation", "phone", "measurement"]);
  assert.doesNotMatch(legacy, /wd-signup-pending-note/);
  assert.match(legacy, /Fixture accepted, awaiting confirmation/);
  const reservation = ui.calls.find((call: { name: string }) => call.name === "reservation");
  assert.equal(reservation.props.inboxId, "hero-verify-inbox");
  assert.equal(reservation.props.autoFocus, true);
});

test("verified full forms keep reservation and optional phone with the attempt credential; compact stays concise", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const props of [{ presentation }, {}]) {
      const html = render(locale, props, { ...pendingState, "EmailForm.verified": true });
      assert.deepEqual(panelNames(), "presentation" in props
        ? ["referral", "reservation", "phone"]
        : ["reservation", "referral", "phone"]);
      for (const name of ["reservation", "phone"]) {
        const panel = ui.calls.find((call: { name: string }) => call.name === name);
        assert.deepEqual(panel.props.credential, { kind: "attempt", value: "fixture-private-attempt" });
      }
      assert.equal(ui.calls.find((call: { name: string }) => call.name === "reservation").props.verified, true);
      assert.doesNotMatch(html, /wd-inbox-card|wd-signup-pending-note|fixture-private-attempt/);
    }
    const compact = render(locale, { compact: true, presentation }, { ...pendingState, "EmailForm.verified": true });
    assert.deepEqual(panelNames(), []);
    assert.match(compact, /role="status"/);
  }
});

test("in-app and mail-provider guidance retain one sender line, recovery actions and measurement", () => {
  for (const inApp of [false, true]) {
    const html = render("en", { presentation }, { ...pendingState, "CheckInboxCard.inApp": inApp });
    assert.equal((html.match(/help@diveroid.com/g) ?? []).length, 1);
    assert.equal(html.includes("wd-inapp-hint"), inApp);
    assert.equal(html.includes("https://mail.google.com/mail/u/0/#search/WatchDive"), !inApp);
    if (inApp) assert.ok(html.includes(markup(FROZEN_LANDING_MESSAGES.en.inbox.inAppHint)));
    assert.deepEqual(panelNames(), ["measurement"]);
  }
  const outlook = render("en", { presentation }, { ...pendingState, "EmailForm.email": "fixture@outlook.com" });
  assert.ok(outlook.includes(markup(FROZEN_LANDING_MESSAGES.en.inbox.providerOutlook)));
  assert.match(outlook, /https:\/\/outlook.live.com\/mail\/0\/inbox/);
  assert.match(outlook, /wd-resend/);
});

test("visible locale labels sit outside the action grid and native handlers preserve typed email", () => {
  const expectedErrors = [
    "Enter a valid email address.", "올바른 이메일 주소를 입력해 주세요.",
    "请输入有效的电子邮箱地址。", "請輸入有效的電子郵件地址。",
    "有効なメールアドレスを入力してください。", "Escribe un correo válido.",
    "Saisissez une adresse e-mail valide.", "Gib eine gültige E-Mail-Adresse ein.",
    "Digite um e-mail válido.", "Vul een geldig e-mailadres in.",
  ];
  for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
    for (const props of [{ id: "hero", presentation }, { id: "offer" }, { id: "offer", domId: "entry-capture", compact: true, presentation }]) {
      ui.configure(locale, { "EmailForm.email": "fixture+label@example.test" });
      const tree = ui.EmailForm(props);
      const all = nodes(tree);
      const field = all.find((node) => node.type === "input" && node.props.type === "email")!;
      assert.ok(field);
      const label = all.find((node) => node.type === "label" && node.props.htmlFor === field.props.id)!;
      assert.ok(label, `${locale}: ${props.id}`);
      assert.equal(label.props.children, FROZEN_LANDING_MESSAGES[locale].form.step1);
      assert.equal(label.props.className, "wd-email-label");
      const grid = all.find((node) => node.type === "div" && node.props.className?.startsWith("grid "))!;
      assert.ok(nodes(grid.props.children).some((node) => node.props.id === field.props.id));
      assert.equal(nodes(grid.props.children).some((node) => node.type === "label"), false);
      assert.equal(field.props.required, true);
      assert.equal(field.props.autoComplete, "email");
      assert.equal(field.props.inputMode, "email");
      assert.equal(field.props.pattern, undefined);
      assert.equal(all.filter((node) => node.props.required).length, 1);
      assert.equal(field.props.value, "fixture+label@example.test");
      const honeypot = all.find((node) => node.props.name === "wd_hp")!;
      assert.equal(honeypot.props["aria-hidden"], "true");
      assert.equal(honeypot.props.autoComplete, "off");
      for (const value of ["", "bad-address", "fixture+label@example.test"]) {
        let validationMessage = "";
        const input = { value, setCustomValidity(message: string) { validationMessage = message; } };
        field.props.onInvalid({ currentTarget: input });
        assert.equal(validationMessage, expectedErrors[index]);
        assert.equal(input.value, value);
        field.props.onInput({ currentTarget: input });
        assert.equal(validationMessage, "");
        assert.equal(input.value, value);
      }
      assert.deepEqual(ui.writes, [], "validation handlers must not clear React email state");
    }
  }
});

test("email-first presentation moves one social entry after email without changing compact, locale or source contracts", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const id of ["hero", "offer"]) {
      for (const compact of [false, true]) {
        for (const selectedPresentation of [undefined, presentation, { ...presentation, socialAfterEmail: true }]) {
          const html = render(locale, { id, compact, presentation: selectedPresentation });
          const social = ui.calls.filter((call: { name: string }) => call.name === "social");
          assert.equal(social.length, compact ? 0 : 1, `${locale} ${id} compact=${compact}`);
          assert.equal((html.match(/type="email"/g) ?? []).length, 1);
          assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
          if (compact) {
            assert.doesNotMatch(html, /wd-form-alternatives|data-test-panel="social"/);
            continue;
          }
          assert.equal(social[0].props.locale, locale);
          assert.equal(social[0].props.source, id);
          assert.equal(social[0].props.disabled, false);
          const socialPosition = html.indexOf('data-test-panel="social"');
          const inputPosition = html.indexOf('type="email"');
          const submitPosition = html.indexOf('type="submit"');
          if (selectedPresentation?.socialAfterEmail) {
            assert.ok(socialPosition > inputPosition && socialPosition > submitPosition, "email action leads both alternatives");
            assert.match(html, /wd-form-alternatives/);
          } else {
            assert.ok(socialPosition < inputPosition, "legacy social-first default remains");
            assert.doesNotMatch(html, /wd-form-alternatives/);
          }
        }
      }
    }
    render(locale, { presentation: { ...presentation, socialAfterEmail: true } }, { "EmailForm.loading": true });
    assert.equal(ui.calls.find((call: { name: string }) => call.name === "social").props.disabled, true);
  }
});

test("capture none removes both entry and exit while default capture, compatibility and push remain independent", () => {
  for (const entryCaptureFlag of [undefined, "true", "false"]) {
    for (const capture of [undefined, "configured", "none"]) {
      for (const compatibility of [true, false]) {
        for (const available of [true, false]) {
          const ready = { compatibility: available, push: { enabled: true, publicKey: "fixture-public-key" } };
          ui.configure("ko", { entryCaptureFlag, "AcquisitionTools.ready": ready });
          const html = renderToStaticMarkup(createElement(ui.AcquisitionTools, { capture, compatibility }));
          const expectedCapture = capture === "none" ? [] : [entryCaptureFlag === "false" ? "exit" : "entry"];
          assert.deepEqual(panelNames(), [
            ...(compatibility && available ? ["compatibility"] : []), ...expectedCapture, "push",
          ]);
          for (const name of ["entry", "exit"]) {
            assert.equal(html.includes(`data-test-panel="${name}"`), expectedCapture.includes(name));
          }
          const push = ui.calls.find((call: { name: string }) => call.name === "push");
          assert.deepEqual(push.props.config, ready.push);
          for (const panel of ui.calls) assert.equal(panel.props.locale, "ko");
        }
      }
    }
  }
  ui.configure("en", { "AcquisitionTools.ready": { compatibility: true, push: { enabled: false } } });
  renderToStaticMarkup(createElement(ui.AcquisitionTools));
  assert.deepEqual(panelNames(), ["compatibility", "entry", "push"], "no-prop legacy invocation keeps configured capture");
});
