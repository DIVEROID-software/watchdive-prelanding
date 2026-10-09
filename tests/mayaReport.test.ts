import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMayaReport, CHANNEL, MAYA } from "../src/lib/reporting/mayaReport.server.ts";
const env = {
  WATCHDIVE_REPORT_SECRET: "test-report-secret-32-characters-long",
  SLACK_BOT_TOKEN: "fake-token-never-returned",
};
const id = "wd-team-performance-daily-20261009";
const text = `WatchDive report ${id}`;
const req = (p?: object, secret = env.WATCHDIVE_REPORT_SECRET) =>
  new Request("https://watchdive.diveroid.com/api/maya-report", {
    method: p ? "POST" : "GET",
    headers: { authorization: `Bearer ${secret}` },
    ...(p ? { body: JSON.stringify(p) } : {}),
  });
function transport(user = MAYA) {
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const fetcher = (async (url: any, init: RequestInit) => {
    const u = String(url);
    const body = u.includes("slack.com/api/")
      ? Object.fromEntries(new URLSearchParams(init.body as string))
      : init.body;
    calls.push({ url: u, body, headers: new Headers(init.headers) });
    if (u.endsWith("auth.test"))
      return Response.json(
        { ok: true, user_id: user, team_id: "T08UUS990LA" },
        { headers: { "x-oauth-scopes": "chat:write,files:write,channels:history" } },
      );
    if (u.endsWith("files.getUploadURLExternal"))
      return Response.json({
        ok: true,
        file_id: "F12345",
        upload_url: "https://files.slack.com/upload/v1/secret-upload-url",
      });
    if (u.includes("/upload/")) return new Response("OK");
    if (u.endsWith("files.completeUploadExternal"))
      return Response.json({ ok: true, files: [{ id: "F12345" }] });
    if (u.endsWith("conversations.history"))
      return Response.json({
        ok: true,
        messages: [
          { user: MAYA, text, ts: "123.456", files: [{ id: "F12345" }] },
          { user: "someone_else", text, ts: "123.457" },
        ],
      });
    throw new Error("unexpected");
  }) as typeof fetch;
  return { calls, fetcher };
}
test("unauthorized requests cannot access Slack", async () => {
  const t = transport();
  assert.equal((await handleMayaReport(req(undefined, "wrong"), env, t.fetcher)).status, 401);
  assert.equal(t.calls.length, 0);
});
test("refuses other bot; status contains no token", async () => {
  assert.equal((await handleMayaReport(req(), env, transport("other").fetcher)).status, 403);
  const good = await (await handleMayaReport(req(), env, transport().fetcher)).json();
  assert.equal(good.user_id, MAYA);
  assert.equal(good.channel_id, CHANNEL);
  assert.ok(!JSON.stringify(good).includes(env.SLACK_BOT_TOKEN));
});
test("private prepare, bound ticket, fixed channel complete", async () => {
  const t = transport();
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32)]).toString(
    "base64",
  );
  const p = await (
    await handleMayaReport(
      req({ action: "prepare", report_id: id, text, png_base64: png }),
      env,
      t.fetcher,
    )
  ).json();
  assert.equal(p.ok, true);
  assert.ok(!t.calls.some((c) => c.url.endsWith("files.completeUploadExternal")));
  assert.equal(
    t.calls.find((c) => c.url.includes("/upload/"))!.headers.has("authorization"),
    false,
  );
  assert.ok(!JSON.stringify(p).includes("secret-upload-url"));
  assert.equal(
    (
      await handleMayaReport(
        req({
          action: "complete",
          report_id: id,
          text: text + "changed",
          file_id: p.file_id,
          ticket: p.ticket,
        }),
        env,
        t.fetcher,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleMayaReport(
        req({
          action: "complete",
          report_id: id,
          text,
          file_id: p.file_id,
          ticket: p.ticket,
          channel_id: "another",
        }),
        env,
        t.fetcher,
      )
    ).status,
    200,
  );
  assert.equal(t.calls.at(-1)!.body.channel_id, CHANNEL);
  assert.equal(t.calls.at(-1)!.body.initial_comment, text);
});
test("invalid report, PII text and non-PNG never upload", async () => {
  for (const p of [
    { action: "prepare", report_id: "bad", text },
    { action: "prepare", report_id: id, text: text + " person@example.com" },
    { action: "prepare", report_id: id, text, png_base64: "bm90LXBuZw==" },
  ]) {
    const t = transport();
    assert.equal((await handleMayaReport(req(p), env, t.fetcher)).status, 400);
    assert.equal(t.calls.length, 1);
  }
});
test("lookup matches Maya only", async () => {
  const r = await (
    await handleMayaReport(req({ action: "lookup", report_id: id }), env, transport().fetcher)
  ).json();
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].ts, "123.456");
});
test("upstream failures cannot expose secrets", async () => {
  const f = (async () => {
    throw new Error("failed " + env.SLACK_BOT_TOKEN);
  }) as typeof fetch;
  const r = await handleMayaReport(req(), env, f);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "slack_request_failed");
});
