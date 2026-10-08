// QA round 13 (non-blocking): the bar covered the headline at 320px and the
// price block at 1440. Phones get a shorter body that keeps every fact the
// full one gives (vendors, purpose, optional); Accept is not offered under GPC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/components/cookie-choice-bar.tsx", "utf8");

function copyBlocks(): Array<{ locale: string; body: string; bodyShort: string }> {
  const out: Array<{ locale: string; body: string; bodyShort: string }> = [];
  const re = /\n {2}("?[a-zA-Z-]+"?): \{\n([\s\S]*?)\n {2}\},/g;
  for (const match of source.matchAll(re)) {
    const block = match[2];
    const body = /\n? {4}body:\s*\n?\s*"([^"]+)"/.exec(block)?.[1];
    const bodyShort = / {4}bodyShort:\s*\n?\s*"([^"]+)"/.exec(block)?.[1];
    if (body && bodyShort) out.push({ locale: match[1].replace(/"/g, ""), body, bodyShort });
  }
  return out;
}

test("every locale has a phone body that is shorter and names the same vendors", () => {
  const blocks = copyBlocks();
  assert.equal(blocks.length, 9);
  for (const { locale, body, bodyShort } of blocks) {
    assert.ok(bodyShort.length < body.length, locale);
    for (const vendor of ["Meta", "Google", "Microsoft Clarity"]) {
      assert.ok(bodyShort.includes(vendor), `${locale} ${vendor}`);
    }
  }
});

test("the phone body shows below sm, the full body from sm up", () => {
  assert.ok(source.includes('<span className="sm:hidden">{copy.bodyShort}</span>'));
  assert.ok(source.includes('<span className="hidden sm:inline">{copy.body}</span>'));
});

test("Accept is not offered under Global Privacy Control, and a yielding dialog is hidden", () => {
  assert.ok(source.includes("disabled={yielding || gpcOn}"));
  assert.ok(/role="dialog"\s+aria-hidden=\{yielding \|\| undefined\}/.test(source));
});

test("the inbox shortcut searches for the renamed subject", () => {
  const index = readFileSync("src/routes/index.tsx", "utf8");
  assert.ok(index.includes("#search/WatchDive"));
  assert.equal(index.includes("#search/watch+dive"), false);
});
