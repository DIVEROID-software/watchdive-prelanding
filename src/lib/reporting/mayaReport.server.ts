// The Maya credential stays in the server. Only the authorized campaign channel
// can receive a report. prepare never publishes; complete uses Slack's single-use
// upload ID. The operator persists that ID before completing (no blind retries).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { checkCronAuthorization } from "../verification/cronAuth.ts";

export const CHANNEL = "C0B248H45FZ";
export const MAYA = "U0BA463T858";
const TEAM = "T08UUS990LA";
type Env = { SLACK_BOT_TOKEN?: string; WATCHDIVE_REPORT_SECRET?: string };
type Payload = {
  action?: string;
  report_id?: string;
  text?: string;
  png_base64?: string;
  file_id?: string;
  ticket?: string;
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const safeError = (s: unknown) =>
  typeof s === "string" && /^[a-z_]{1,64}$/.test(s) ? s : "slack_request_failed";

export async function handleMayaReport(
  request: Request,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (
    checkCronAuthorization(request.headers.get("authorization"), env.WATCHDIVE_REPORT_SECRET) !==
    "authorized"
  )
    return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.SLACK_BOT_TOKEN) return json({ ok: false, error: "maya_not_configured" }, 503);
  if (!["GET", "POST"].includes(request.method))
    return json({ ok: false, error: "method_not_allowed" }, 405);
  let stage = "authentication";
  try {
    const api = async (method: string, body: object = {}) => {
      stage = method;
      const response = await fetcher(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(
          Object.entries(body).map(([key, value]) => [
            key,
            typeof value === "object" ? JSON.stringify(value) : String(value),
          ]),
        ).toString(),
        signal: AbortSignal.timeout(20000),
      });
      const value = await response.json();
      if (!response.ok || value.ok !== true) throw new Error(safeError(value.error));
      return {
        value,
        scopes:
          response.headers
            .get("x-oauth-scopes")
            ?.split(",")
            .map((x) => x.trim()) ?? [],
      };
    };
    const identity = await api("auth.test");
    if (identity.value.user_id !== MAYA || identity.value.team_id !== TEAM)
      return json({ ok: false, error: "maya_identity_mismatch" }, 403);
    if (request.method === "GET")
      return json({
        ok: true,
        user_id: MAYA,
        team_id: TEAM,
        channel_id: CHANNEL,
        scopes: identity.scopes,
      });
    if (Number(request.headers.get("content-length") ?? 0) > 3_000_000)
      return json({ ok: false, error: "payload_too_large" }, 413);
    const raw = await request.text();
    if (raw.length > 3_000_000) return json({ ok: false, error: "payload_too_large" }, 413);
    let p: Payload;
    try {
      p = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (
      !p ||
      typeof p.report_id !== "string" ||
      !/^wd-team-performance-daily-\d{8}$/.test(p.report_id)
    )
      return json({ ok: false, error: "invalid_report_id" }, 400);
    if (p.action === "lookup") {
      const history = (await api("conversations.history", { channel: CHANNEL, limit: 100 })).value;
      const matches = (history.messages ?? []).filter(
        (m: { text?: string; user?: string }) => m.user === MAYA && m.text?.includes(p.report_id!),
      );
      return json({
        ok: true,
        matches: matches.map((m: { ts: string; files?: { id: string }[] }) => ({
          ts: m.ts,
          file_ids: m.files?.map((f) => f.id) ?? [],
          channel_id: CHANNEL,
          user_id: MAYA,
        })),
      });
    }
    if (
      typeof p.text !== "string" ||
      p.text.length > 8000 ||
      !p.text.includes(p.report_id) ||
      !p.text.includes("WatchDive") ||
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(p.text)
    )
      return json({ ok: false, error: "invalid_report_text" }, 400);
    const ticket = (fileId: string) =>
      createHmac("sha256", env.WATCHDIVE_REPORT_SECRET!)
        .update(`${p.report_id}\n${fileId}\n${digest(p.text!)}`)
        .digest("hex");
    if (p.action === "prepare") {
      if (typeof p.png_base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.png_base64))
        return json({ ok: false, error: "invalid_png" }, 400);
      const png = Buffer.from(p.png_base64, "base64");
      if (
        png.length > 2_000_000 ||
        png.length < 24 ||
        png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      )
        return json({ ok: false, error: "invalid_png" }, 400);
      const upload = (
        await api("files.getUploadURLExternal", {
          filename: `${p.report_id}.png`,
          length: png.length,
          alt_txt: "WatchDive 팀별 누적 인증 이메일 수와 인증당 획득 비용",
        })
      ).value;
      const url = new URL(upload.upload_url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "files.slack.com" ||
        !/^F[A-Z0-9]+$/.test(upload.file_id)
      )
        return json({ ok: false, error: "unexpected_upload_destination" }, 502);
      const sent = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: png,
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!sent.ok) return json({ ok: false, error: "image_upload_failed" }, 502);
      return json({
        ok: true,
        file_id: upload.file_id,
        ticket: ticket(upload.file_id),
        user_id: MAYA,
        channel_id: CHANNEL,
      });
    }
    if (p.action === "complete") {
      if (
        typeof p.file_id !== "string" ||
        !/^F[A-Z0-9]+$/.test(p.file_id) ||
        typeof p.ticket !== "string" ||
        !/^[a-f0-9]{64}$/.test(p.ticket) ||
        !timingSafeEqual(Buffer.from(p.ticket, "hex"), Buffer.from(ticket(p.file_id), "hex"))
      )
        return json({ ok: false, error: "invalid_upload_ticket" }, 400);
      const done = (
        await api("files.completeUploadExternal", {
          files: [{ id: p.file_id, title: `WatchDive 팀별 성과 · ${p.report_id.slice(-8)}` }],
          channel_id: CHANNEL,
          initial_comment: p.text,
        })
      ).value;
      return json({
        ok: true,
        file_ids: done.files.map((f: { id: string }) => f.id),
        channel_id: CHANNEL,
        user_id: MAYA,
        report_id: p.report_id,
      });
    }
    return json({ ok: false, error: "invalid_action" }, 400);
  } catch (error) {
    // Never include request, auth values, upload URLs or upstream error bodies.
    return json(
      { ok: false, error: safeError(error instanceof Error ? error.message : ""), stage },
      502,
    );
  }
}
