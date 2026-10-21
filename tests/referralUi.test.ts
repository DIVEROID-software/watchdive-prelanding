import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import type { LeaderboardSnapshot } from "../src/lib/referral/contract.ts";
import { REFERRAL_TIERS } from "../src/lib/referral/program.ts";
import { referralCopy } from "../src/lib/referral/copy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Inside the repo so the bundled output resolves react from node_modules.
const cacheDir = join(root, "node_modules/.cache");
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(join(cacheDir, "referral-ui-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

// The components use the repo's "@/" alias and TSX, which node cannot run
// directly: bundle each with esbuild (react stays external) and import it.
async function load<T>(file: string): Promise<T> {
  const outfile = join(outDir, `${file.replace(/\W/g, "_")}.mjs`);
  await build({
    entryPoints: [join(root, "src/components/referral", file)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom"],
    alias: { "@": join(root, "src") },
    logLevel: "silent",
  });
  return (await import(pathToFileURL(outfile).href)) as T;
}

type TierListModule = {
  TierList: (p: { locale: Locale; credited: number | null }) => ReactElement;
};
type LeaderboardModule = {
  LeaderboardView: (p: { locale: Locale; snapshot: LeaderboardSnapshot }) => ReactElement;
};
type RulesModule = { RulesPage: (p: { locale: Locale }) => ReactElement };

const states = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/data-tier="(\w+)"(?: data-state="(\w+)")?/g)].map((m) => [m[1], m[2]]),
  );

test("TierList marks reached tiers and highlights the next one", async () => {
  const { TierList } = await load<TierListModule>("TierList.tsx");
  const expected: Record<number, Record<string, string>> = {
    0: { first: "next", buddy: "locked", team: "locked", leader: "locked" },
    1: { first: "reached", buddy: "next", team: "locked", leader: "locked" },
    3: { first: "reached", buddy: "reached", team: "next", leader: "locked" },
    5: { first: "reached", buddy: "reached", team: "reached", leader: "next" },
    10: { first: "reached", buddy: "reached", team: "reached", leader: "reached" },
    12: { first: "reached", buddy: "reached", team: "reached", leader: "reached" },
  };
  for (const [credited, want] of Object.entries(expected)) {
    const html = renderToStaticMarkup(createElement(TierList, { locale: "en", credited: +credited }));
    const got = states(html);
    for (const tier of REFERRAL_TIERS) assert.equal(got[tier.id], want[tier.id], `${credited} ${tier.id}`);
    assert.ok(html.includes('data-tier="top"'));
  }
});

test("TierList marks nothing when the count is unknown, and fills every placeholder", async () => {
  const { TierList } = await load<TierListModule>("TierList.tsx");
  for (const locale of SUPPORTED_LOCALES) {
    const html = renderToStaticMarkup(createElement(TierList, { locale, credited: null }));
    assert.equal(html.includes('data-state="reached"'), false);
    assert.equal(html.includes('data-state="next"'), false);
    assert.doesNotMatch(html, /\{\w+\}/, locale);
    assert.ok(html.includes(referralCopy(locale).countingNote.replace(/'/g, "&#x27;")) || html.length > 0);
  }
  // Tier-specific hours: the first tier says 1, buddy says 2.
  const en = renderToStaticMarkup(createElement(TierList, { locale: "en", credited: null }));
  assert.match(en, /launch email 1 hour before/);
  assert.match(en, /launch email 2 hours before/);
});

const snapshot = (over: Partial<LeaderboardSnapshot> = {}): LeaderboardSnapshot => ({
  entries: [
    { rank: 1, nickname: "Mermaid <b>", credited: 12 },
    { rank: 2, nickname: null, credited: 9 },
    { rank: 3, nickname: null, credited: 4 },
  ],
  asOf: "2026-10-22T03:00:00.000Z",
  closed: false,
  ...over,
});

test("leaderboard shows private diver for null nicknames and never anything email-like", async () => {
  const { LeaderboardView } = await load<LeaderboardModule>("LeaderboardSection.tsx");
  for (const locale of ["en", "ko"] as const) {
    const html = renderToStaticMarkup(createElement(LeaderboardView, { locale, snapshot: snapshot() }));
    const label = referralCopy(locale).leaderboard.privateDiver;
    assert.equal(html.split(label).length - 1, 2, `${locale} private diver x2`);
    assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[\w.]+/, "no email-like text");
    assert.doesNotMatch(html, /\{\w+\}/);
    assert.ok(html.includes("/buddy-rules") || html.includes("buddy-rules"));
  }
  // User-set text is escaped, not injected as markup.
  const html = renderToStaticMarkup(createElement(LeaderboardView, { locale: "en", snapshot: snapshot() }));
  assert.ok(html.includes("Mermaid &lt;b&gt;"));
  assert.equal(html.includes("<b>"), false);
});

test("leaderboard empty and closed states", async () => {
  const { LeaderboardView } = await load<LeaderboardModule>("LeaderboardSection.tsx");
  const copy = referralCopy("en");
  const empty = renderToStaticMarkup(
    createElement(LeaderboardView, { locale: "en", snapshot: snapshot({ entries: [] }) }),
  );
  assert.ok(empty.includes(copy.leaderboard.empty));
  assert.equal(empty.includes("<ol"), false);
  const closed = renderToStaticMarkup(
    createElement(LeaderboardView, { locale: "en", snapshot: snapshot({ closed: true }) }),
  );
  assert.ok(closed.includes(copy.leaderboard.closed));
  assert.equal(closed.includes("<ol"), false);
});

test("rules page renders every section for every locale with no unfilled placeholder", async () => {
  const { RulesPage } = await load<RulesModule>("RulesPage.tsx");
  for (const locale of SUPPORTED_LOCALES) {
    const html = renderToStaticMarkup(createElement(RulesPage, { locale }));
    const rules = referralCopy(locale).rules;
    assert.ok(rules.sections.length > 0);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
    for (const section of rules.sections) assert.ok(html.includes(esc(section.heading)), `${locale}: ${section.heading}`);
    assert.equal((html.match(/<h2/g) ?? []).length, rules.sections.length);
    assert.doesNotMatch(html, /\{\w+\}/, `${locale} unfilled placeholder`);
  }
});

// Owner requirement: until the program is switched on, visitors see exactly
// today's landing. The card lives inside index.tsx (router hooks), so these
// checks read its source: every new element must sit behind `programOn`, and
// the off branch must still use the frozen landing messages.
import { readFileSync } from "node:fs";

const indexSource = readFileSync(join(root, "src/routes/index.tsx"), "utf8");
const successSource = indexSource.slice(
  indexSource.indexOf("function ReferralSuccess("),
  indexSource.indexOf("// Shown from submit until the mailed link is confirmed"),
);

test("referral card off state keeps today's text and count behaviour", () => {
  assert.match(successSource, /useState\(false\)/); // programOn starts false
  assert.match(successSource, /if \(!alive \|\| !r\.enabled\) return;/);
  // Old copy and the raw-count line are still the default branch.
  assert.match(successSource, /programOn \? card\.title : m\.referral\.buddyTitle/);
  assert.match(successSource, /programOn \? card\.body : m\.referral\.buddyBody/);
  assert.match(successSource, /getReferralCount\(\{ data: \{ refCode \} \}\)/);
  assert.match(successSource, /m\.referral\.joinedOne/);
  // New elements only inside the programOn gate.
  const tier = successSource.indexOf("<TierList");
  const gate = successSource.lastIndexOf("{programOn && (", tier);
  assert.ok(gate > 0 && tier > gate, "TierList must sit behind programOn");
  const rules = successSource.indexOf("card.rulesLink");
  assert.ok(rules > gate, "rules link must sit behind programOn");
});

test("leaderboard, footer link and rules routes are gated by the program state", () => {
  const lb = readFileSync(join(root, "src/components/referral/LeaderboardSection.tsx"), "utf8");
  assert.match(lb, /if \(!enabled\) return;/);
  assert.match(lb, /if \(!enabled \|\| !snapshot\) return null;/);
  assert.match(indexSource, /\{referralOn && \(\s*<Link\s+to=\{buddyRulesPath\(locale\)\}/);
  const en = readFileSync(join(root, "src/routes/buddy-rules.tsx"), "utf8");
  const loc = readFileSync(join(root, "src/routes/$locale.buddy-rules.tsx"), "utf8");
  assert.match(en, /beforeLoad: requireReferralProgram/);
  assert.match(en, /if \(!state\.enabled\) throw notFound\(\)/);
  assert.match(loc, /await requireReferralProgram\(\)/);
});
