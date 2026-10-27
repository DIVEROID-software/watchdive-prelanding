/** QA2 integration checks. No signup, OAuth exchange, mail or payment requests.
 * Optional SSR checks: WD_SEGMENT_QA_ORIGIN=http://127.0.0.1:5195 npm test
 * The explicit origin must be loopback; all HTTP requests below are page GETs.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import { sitemapXml } from "../src/lib/i18n/crawl.ts";
import { SUPPORTED_LOCALES, localizePath } from "../src/lib/i18n/locale.ts";
import { newSocialState, readSocialState, signSocialState } from "../src/lib/socialAuth/state.ts";
import { handleGoogleCallback } from "../src/lib/socialAuth/http.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicOrigin = "https://watchdive.diveroid.com";
const previewOrigin = process.env.WD_SEGMENT_QA_ORIGIN;

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1].toLowerCase(), m[2].replaceAll("&amp;", "&")]));
}
function tags(html: string, name: string) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(m => attributes(m[0]));
}
function section(html: string, id: string): string {
  const match = html.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</section>`));
  assert.ok(match, `missing ${id}`);
  return match[1];
}

test("QA SSR origin cannot target production or another machine", () => {
  if (!previewOrigin) return;
  const url = new URL(previewOrigin);
  assert.equal(url.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/");
  assert.equal(url.username + url.password + url.search + url.hash, "");
});

test("production entrypoint import graph excludes all local preview mocks and controls", () => {
  const visited = new Set<string>();
  function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    assert.equal(path.startsWith(resolve(root, "preview") + "/"), false, path);
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /local-preview-attempt-not-a-real-credential|local_preview_only\.not_a_real_signed_invite|cs_test_localpreview|__WD_PREVIEW_REFERRAL__/);
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node) {
      let spec: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) spec = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) spec = node.arguments[0].text;
      if (spec && (spec.startsWith(".") || spec.startsWith("@/"))) {
        const target = spec.startsWith("@/") ? resolve(root, "src", spec.slice(2)) : resolve(dirname(path), spec);
        const resolved = [target, ...[".ts", ".tsx", ".js", "/index.ts", "/index.tsx"].map(ext => target + ext)].find(candidate => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate));
        if (resolved) visit(resolved);
        else assert.ok(/\.(?:css|webp|avif|png|jpe?g|svg|mp4|woff2?|gif|ico)(?:\?.*)?$/.test(spec), `unresolved app import ${spec} in ${path}`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
  }
  for (const entry of ["vite.config.ts", "src/server.ts", "src/routeTree.gen.ts"]) visit(resolve(root, entry));
  assert.ok(visited.has(resolve(root, "src/components/segments/SegmentLanding.tsx")), "actual segment routes must be reachable");
  assert.ok(visited.has(resolve(root, "src/lib/reservation/onsite.ts")), "real reservation gate must remain reachable");
});

test("forged signed-segment state cannot turn a failed callback into a redirect or a verification", async () => {
  const secret = "QA2-only-fixture-secret-not-a-production-key";
  const now = new Date("2026-10-25T00:00:00Z");
  const env = { WATCHDIVE_SOCIAL_AUTH_SECRET: secret };
  const state = newSocialState({provider:"google",source:"hero",locale:"en",segment:"freediving",origin:publicOrigin,attribution:{},measurementConsent:false,country:{trustedVercel:false,header:null}}, now.getTime());
  const signed = signSocialState(state, secret);
  const payload = JSON.parse(Buffer.from(signed.split(".")[0], "base64url").toString());
  payload.segment = "scuba";
  const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signed.split(".")[1]}`;
  assert.equal(readSocialState(tampered, secret, env, now.getTime()), undefined);
  let networkCalls = 0;
  const response = await handleGoogleCallback(new Request(`${publicOrigin}/api/auth/google/callback?state=${state.state}&code=fixture&next=https://evil.example`, {
    headers: {cookie:`__Host-wd_social_state=${tampered}`,"user-agent":"Mozilla/5.0 QA2"},
  }), {env, now:()=>now, fetchImpl:async()=>{networkCalls++;throw new Error("No external request allowed");}});
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(networkCalls, 0);
});

for (const segment of ["freediving", "scuba"] as const) {
  for (const locale of SUPPORTED_LOCALES) {
    test(`SSR ${locale}/${segment}: locale SEO, middle/bottom forms and privacy`, {skip: !previewOrigin}, async () => {
      const origin = new URL(previewOrigin!);
      assert.ok(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
      const path = localizePath(`/${segment}`, locale);
      const response = await fetch(new URL(`${path}?utm_source=qa2&utm_campaign=123456&utm_content=234567`, origin), {redirect:"manual"});
      assert.equal(response.status, 200);
      assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
      const html = await response.text();
      const canonical = publicOrigin + path;
      assert.equal(tags(html,"html")[0]?.lang, locale);
      const links = tags(html,"link");
      assert.deepEqual(links.filter(link => link.rel === "canonical").map(link=>link.href), [canonical]);
      const expected = [...SUPPORTED_LOCALES.map(lang=>({lang,href:publicOrigin+localizePath(`/${segment}`,lang)})), {lang:"x-default",href:publicOrigin+`/${segment}`}];
      assert.deepEqual(links.filter(link=>link.rel==="alternate").map(link=>({lang:link.hreflang,href:link.href})), expected);
      assert.deepEqual(tags(html,"meta").filter(meta=>meta.property==="og:url").map(meta=>meta.content), [canonical]);
      const graphs = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
      const page = graphs.flatMap(graph=>graph["@graph"] ?? []).find(node=>node["@type"]==="WebPage");
      assert.equal(page?.url, canonical);
      assert.equal(page?.inLanguage, locale);
      assert.doesNotMatch(section(html,"segment-hero"), /<form\b|<input\b|data-wd-signup/);
      assert.equal(tags(html,"form").filter(form=>"data-wd-signup" in form).length, 2);
      for (const [placement, source] of [["middle","hero"],["bottom","offer"]]) {
        const content = section(html,`signup-${placement}`);
        assert.equal(tags(content,"form").filter(form=>"data-wd-signup" in form).length, 1);
        const email = tags(content,"input").find(input=>input.type==="email");
        assert.equal(email?.id, `${source}-email`);
        assert.equal(email?.["aria-describedby"], `${source}-confirm-note`);
        assert.equal(tags(content,"input").some(input=>input.type==="tel" && "required" in input), false);
        assert.equal(tags(content,"input").some(input=>input.autocomplete?.startsWith("cc-")), false);
      }
      for (const legal of ["privacy","terms"]) assert.ok(tags(html,"a").some(a=>a.href===localizePath(`/${legal}`,locale)));
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
      for (const id of ["segment-hero","signup-middle","signup-bottom","hero-email","offer-email"]) assert.equal(ids.filter(value=>value===id).length,1);
      assert.ok(html.indexOf('id="segment-how"') < html.indexOf('id="signup-middle"'));
      assert.ok(html.indexOf('id="segment-faq"') < html.indexOf('id="signup-bottom"'));
    });
  }
}


test("public sitemap includes all 18 canonical audience destinations without query aliases", () => {
  const locations = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  assert.equal(locations.length,45);
  assert.equal(new Set(locations).size,45);
  for (const segment of ["freediving","scuba"]) for (const locale of SUPPORTED_LOCALES) {
    assert.ok(locations.includes(publicOrigin + localizePath(`/${segment}`,locale)));
  }
  assert.equal(locations.some(url=>/[?#]/.test(url)),false);
});
