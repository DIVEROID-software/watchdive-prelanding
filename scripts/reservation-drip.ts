// No scheduler is installed or enabled here. Default is offline preview only.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { SUPPORTED_LOCALES, privacyPath, termsPath } from "../src/lib/i18n/locale.ts";
import { createNotionRequest } from "../src/lib/verification/notionLead.ts";
import { createStripeClient } from "../src/lib/reservation/stripeApi.ts";
import { deliverReservationMessage } from "../src/lib/reservation-mail/provider.ts";
import { DRIP_CAMPAIGN, DRIP_STAGES, DRIP_SCHEMA_PLAN, dripEnabled } from "../src/lib/reservation-drip/policy.ts";
import { DRIP_COPY_HASH, renderDripMail } from "../src/lib/reservation-drip/render.ts";
import { RESERVATION_EMAIL_SEGMENTS, rewritePreviewAssetUrls } from "../src/lib/reservation-drip/media.ts";
import { runReservationDrip } from "../src/lib/reservation-drip/run.ts";

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, print = console.log): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, allowPositionals: false, strict: true, options: {
      preview: { type: "boolean" }, "dry-run": { type: "boolean" }, send: { type: "boolean" },
      "confirm-campaign": { type: "string" }, "out-dir": { type: "string" },
      "legacy-receipt-dir": { type: "string" }, "drip-receipt-dir": { type: "string" },
      "not-before": { type: "string" }, limit: { type: "string" }, help: { type: "boolean" },
    } }));
  } catch { print("Invalid arguments. Use --help."); return 1; }
  if (values.help) {
    print("Default/--preview: offline 4-stage × 3-segment × 10-language draft previews (120), plus general filename aliases. --dry-run: read-only Notion readiness, no Stripe or messages. --send --confirm-campaign wd-reservation-drip-v1: requires approved copy hash, prospective cutoff, existing D0 ledger, new stage ledger directory, verified legacy scheduler cutover and all live-account guards. Never run send before review. Optional --limit caps each stage. All amounts USD."); return 0;
  }
  if (values.send && (values.preview || values["dry-run"] || values["confirm-campaign"] !== DRIP_CAMPAIGN)) { print("Contradictory mode or missing exact campaign confirmation."); return 1; }
  if (!values.send && !values["dry-run"]) {
    const dir = resolve(values["out-dir"] ?? ".reservation-drip-preview");
    await mkdir(dir, { recursive: true });
    const links: string[] = [];
    const items: { kind: string; segment: string; locale: string; file: string; subject: string; template: "present"; animated: boolean }[] = [];
    for (const segment of RESERVATION_EMAIL_SEGMENTS) {
      links.push(`<h2>${segment}</h2><ul>`);
      for (const locale of SUPPORTED_LOCALES) for (const stage of DRIP_STAGES) {
        const mail = renderDripMail(stage, {
          locale, segment, inviteUrl: `https://watchdive.diveroid.com/reservation?lang=${locale}#invite=unsigned-preview-not-for-payment`,
          unsubscribeUrl: "https://watchdive.diveroid.com/unsubscribe#preview",
          privacyUrl: `https://watchdive.diveroid.com${privacyPath(locale)}`,
          termsUrl: `https://watchdive.diveroid.com${termsPath(locale)}`,
        });
        const html = rewritePreviewAssetUrls(mail.html);
        const file = `${stage}.${segment}.${locale}.html`;
        const textName = `${stage}.${segment}.${locale}.txt`;
        const textBody = `Subject: ${mail.subject}\n\n${mail.text}`;
        await writeFile(join(dir, file), html);
        await writeFile(join(dir, textName), textBody);
        if (segment === "general") {
          await writeFile(join(dir, `${stage}.${locale}.html`), html);
          await writeFile(join(dir, `${stage}.${locale}.txt`), textBody);
        }
        links.push(`<li><a href="${file}">${locale} · ${stage.toUpperCase()}</a></li>`);
        items.push({ kind: stage, segment, locale, file, subject: mail.subject, template: "present", animated: stage === "d0" || (stage === "d7" && segment === "freediving") });
      }
      links.push("</ul>");
    }
    const samples = items.length;
    await writeFile(join(dir, "index.html"), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WatchDive 메일 초안</title><style>body{font:18px system-ui;background:#201748;color:white;max-width:920px;margin:40px auto;padding:24px}a{color:#65ceee}ul{columns:3;line-height:2}@media(max-width:600px){ul{columns:2}}</style><h1>$3 예약 메일 · 로컬 초안 ${samples}통</h1><p>실제 발송 없음. 가입 화면이 프리다이빙·스쿠버·일반이면 문장과 이미지가 달라집니다. D0는 예약 안내와 GIF, D1은 사용 장면, D3는 선착순 100명 $149와 다음 $200, D7은 다음 다이빙과 $149 가격 안내입니다. 사전 알림 신청이 계속 늘고 있어요. 인원 수, 매일 증가, 마감, 급증은 쓰지 않습니다. 선착순 100명은 $149, 그다음은 $200. 버튼은 $3 하나. $3가 $149에서 빠지지 않는 설명은 결제 화면에 있습니다. 이미지는 이 컴퓨터의 127.0.0.1:5195에서만 열고, 결제 링크는 그대로입니다. 발송·배포·최종 문구 승인은 아닙니다.</p>${links.join("")}</html>`);
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ draft: true, sendApproved: false, copyHash: DRIP_COPY_HASH, samples, priceUsdAfterFirst100: 200, schemaPlan: DRIP_SCHEMA_PLAN, items }, null, 2));
    print(JSON.stringify({ mode: "preview", samples, copyHash: DRIP_COPY_HASH, output: dir, sent: 0 })); return 0;
  }
  if (values.send && !dripEnabled(env, DRIP_COPY_HASH)) { print("Send refused: feature, approved copy hash or legacy-job cutover is not confirmed."); return 2; }
  const legacyReceiptDir = values["legacy-receipt-dir"] ?? env.WATCHDIVE_RESERVATION_DRIP_LEGACY_RECEIPT_DIR;
  const dripReceiptDir = values["drip-receipt-dir"] ?? env.WATCHDIVE_RESERVATION_DRIP_RECEIPT_DIR;
  const notBefore = values["not-before"] ?? env.WATCHDIVE_RESERVATION_DRIP_NOT_BEFORE;
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (!legacyReceiptDir || !dripReceiptDir || !notBefore || !env.NOTION_API_KEY || !env.NOTION_WAITLIST_DB_ID || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) { print("Missing required configuration or invalid limit; values redacted."); return 2; }
  try {
    // Constructing the client does not call it. Dry-run never uses it.
    const stripe = createStripeClient({ secretKey: values.send ? env.STRIPE_SECRET_KEY ?? "" : "", allowLive: values.send === true });
    const result = await runReservationDrip({ mode: values.send ? "send" : "dry-run", legacyReceiptDir, dripReceiptDir, notBefore, limit }, {
      env, request: createNotionRequest(fetch, env), databaseId: env.NOTION_WAITLIST_DB_ID, stripe,
      send: message => { if (!values.send) throw new Error("Dry-run send refused"); return deliverReservationMessage(env, message); },
    });
    print(JSON.stringify(result));
    return result.aborted || result.stages.some(({ result }) => result.aborted || result.failed || result.unresolved || result.unrecorded) ? 2 : 0;
  } catch { print("Drip run failed safely; no credentials or recipient data printed."); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
