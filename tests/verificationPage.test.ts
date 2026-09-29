import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { createVerificationToken, verificationUrl } from "../src/lib/verification/token.ts";
import { isVerificationTokenShape } from "../src/lib/verification/tokenShape.ts";
import { TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

// Execute the actual page parser, not a second implementation of its rules.
// Extracting it keeps the React/router/server-function runtime out of this
// Node unit test. Include the old regex if present so this reproduces the bug.
const source = readFileSync(new URL("../src/routes/verify.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("verify.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const parser = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "tokenFromFragment",
);
assert.ok(parser, "the page must parse email fragments");
const legacyPattern = ast.statements.filter(
  (node) => ts.isVariableStatement(node) && node.declarationList.declarations.some(
    (declaration) => declaration.name.getText(ast) === "TOKEN_PATTERN",
  ),
);
const code = ts.transpileModule(
  [...legacyPattern.map((node) => node.getText(ast)), parser.getText(ast)].join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const tokenFromFragment = runInNewContext(`${code}\ntokenFromFragment`, {
  isVerificationTokenShape,
}) as (hash: string) => string | undefined;

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const expiry = Date.now() + 86_400_000;

test("freshly issued verification links pass the /verify page check in every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const consent of [false, true]) {
      const token = createVerificationToken(ID, expiry, consent, TEST_SECRET, locale);
      const link = new URL(verificationUrl(TEST_ORIGIN, token));
      assert.equal(tokenFromFragment(link.hash), token, `${locale}, consent=${consent}`);
      assert.equal(tokenFromFragment(`#token=${encodeURIComponent(token)}`), token);
      assert.equal(tokenFromFragment(`#${encodeURIComponent(token)}`), token);
    }
  }
});

test("the verify page imports its shape check from the browser-safe shared module", () => {
  assert.match(source, /import\s*\{\s*isVerificationTokenShape\s*\}\s*from\s*["']@\/lib\/verification\/tokenShape["']/);
  assert.equal(legacyPattern.length, 0, "do not restore an independent page token regex");
});

test("legacy four-part email links still pass the page check", () => {
  const payload = `${ID}.${Math.floor(expiry / 1000)}.1`;
  const signature = createHmac("sha256", TEST_SECRET).update(`verify:v1:${payload}`).digest("base64url");
  const token = `${payload}.${signature}`;
  assert.equal(tokenFromFragment(`#${token}`), token);
  assert.equal(tokenFromFragment(`#token=${token}`), token);
});

test("malformed fragments are rejected without throwing", () => {
  const token = createVerificationToken(ID, expiry, false, TEST_SECRET, "en");
  for (const fragment of ["", "#", "#token=", "#%E0%A4%A", `#${token}.extra`, `#${token.replace('.en.', '.xx.')}`, `#${token.slice(0, -1)}`]) {
    assert.equal(tokenFromFragment(fragment), undefined, fragment);
  }
});
