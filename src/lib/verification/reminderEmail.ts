// The single 24-hour verification reminder. The first confirmation mail stays
// in resend.ts `body()`; this module is selected only when reminder=true.
//
// Pure: no fetch, no logging, no recipient, no token parsing. The href is the
// signed verification URL the caller already built. Images are the approved
// public assets, unaltered.
import { isLocale, type Locale } from "../i18n/locale.ts";

export const REMINDER_ASSET_ORIGIN = "https://watchdive.diveroid.com";
export const REMINDER_WORDMARK_URL = `${REMINDER_ASSET_ORIGIN}/brand/reservation/diveroid-wordmark-color-transparent.png`;
export const REMINDER_PHOTO_URL = `${REMINDER_ASSET_ORIGIN}/brand/reservation/watchdive-underwater.jpg`;

const FONT =
  "'Pangram Sans','Spoqa Han Sans Neo','Helvetica Neue','Apple SD Gothic Neo',Helvetica,Arial,'Malgun Gothic',sans-serif";

const DEEP = "#201748";
const MID = "#3D2683";
const SURFACE = "#36A9E1";
const FOAM = "#EEF9FF";
const CANVAS = "#F6FAFC";
const PAPER = "#FFFFFF";
const INK = "#10212E";

export type ReminderEmailCopy = {
  subject: string;
  preheader: string;
  /** One explicit line break, rendered as <br> in HTML and a newline in text. */
  headline: string;
  received: string;
  instruction: string;
  button: string;
  fallback: string;
  once: string;
  ignore: string;
  imageAlt: string;
};

export type ReminderEmail = {
  subject: string;
  text: string;
  html: string;
};

export const REMINDER_EMAIL_COPY = {
  en: {
    subject: "WatchDive, confirming your email is all that's left",
    preheader: "Your request is in. Confirm your email so launch news can reach you.",
    headline: "WatchDive launch news,\nso you don't miss it.",
    received: "Your request for updates is in.",
    instruction: "Use the button below to finish confirming your email.",
    button: "Confirm my email",
    fallback: "If the button does not open, paste this address into your browser:",
    once: "This is the only reminder we send.",
    ignore: "If you did not request this, you can ignore this email.",
    imageAlt: "A diver wearing WatchDive on the wrist, underwater",
  },
  ko: {
    subject: "WatchDive, 이메일 인증만 남았어요",
    preheader: "알림 신청은 접수됐어요. 이메일 인증만 남았습니다.",
    headline: "WatchDive 출시 소식,\n놓치지 않도록.",
    received: "알림 신청은 잘 접수됐어요.",
    instruction: "아래 버튼을 눌러 이메일 인증을 마무리해 주세요.",
    button: "이메일 인증하기",
    fallback: "버튼이 작동하지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.",
    once: "이 안내는 한 번만 보내 드립니다.",
    ignore: "신청한 적이 없다면 이 메일을 무시해 주세요.",
    imageAlt: "수중에서 WatchDive를 찬 다이버의 손목",
  },
  "zh-CN": {
    subject: "WatchDive，只差确认邮箱了",
    preheader: "提醒申请已收到。完成邮箱确认后，即可收到 WatchDive 上线消息。",
    headline: "WatchDive 上线消息，\n别错过。",
    received: "提醒申请已经收到。",
    instruction: "请点击下方按钮，完成邮箱确认。",
    button: "确认邮箱",
    fallback: "如果按钮无法打开，请将下面的地址粘贴到浏览器：",
    once: "这是我们发送的唯一一次提醒。",
    ignore: "如果不是您本人申请的，请忽略这封邮件。",
    imageAlt: "潜水员在水下佩戴 WatchDive 的手腕",
  },
  "zh-TW": {
    subject: "WatchDive，只差確認電子郵件了",
    preheader: "提醒申請已收到。完成電子郵件確認後，即可收到 WatchDive 上線消息。",
    headline: "WatchDive 上線消息，\n別錯過。",
    received: "提醒申請已經收到。",
    instruction: "請點選下方按鈕，完成電子郵件確認。",
    button: "確認電子郵件",
    fallback: "如果按鈕無法開啟，請將下面的網址貼到瀏覽器：",
    once: "這是我們寄出的唯一一次提醒。",
    ignore: "如果不是您本人申請的，請忽略這封信。",
    imageAlt: "潛水員在水下配戴 WatchDive 的手腕",
  },
  ja: {
    subject: "WatchDive、メールの確認だけ残っています",
    preheader: "お知らせの申請を受け付けました。メール確認を終えると、公開情報をお届けできます。",
    headline: "WatchDiveの公開情報を、\n見逃さないために。",
    received: "お知らせの申請を受け付けました。",
    instruction: "下のボタンから、メールアドレスの確認を完了してください。",
    button: "メールアドレスを確認",
    fallback: "ボタンが開かない場合は、次のURLをブラウザに貼り付けてください。",
    once: "このお知らせは一度だけお送りします。",
    ignore: "お心当たりがない場合は、このメールを破棄してください。",
    imageAlt: "水中で WatchDive を腕につけたダイバー",
  },
  es: {
    subject: "WatchDive, solo falta confirmar tu correo",
    preheader:
      "Tu solicitud ya está registrada. Confirma tu correo para recibir las noticias del lanzamiento.",
    headline: "Las noticias del lanzamiento\nde WatchDive, sin perdértelas.",
    received: "Tu solicitud de avisos ya está registrada.",
    instruction: "Pulsa el botón para terminar de confirmar tu correo.",
    button: "Confirmar mi correo",
    fallback: "Si el botón no se abre, pega esta dirección en el navegador:",
    once: "Este es el único recordatorio que enviamos.",
    ignore: "Si no solicitaste esto, puedes ignorar este mensaje.",
    imageAlt: "Un buceador con WatchDive en la muñeca, bajo el agua",
  },
  fr: {
    subject: "WatchDive, il ne reste que la confirmation de votre e-mail",
    preheader:
      "Votre demande est enregistrée. Confirmez votre e-mail pour recevoir les nouvelles du lancement.",
    headline: "Les nouvelles du lancement\nWatchDive, pour ne rien manquer.",
    received: "Votre demande d’alertes est bien enregistrée.",
    instruction: "Utilisez le bouton ci-dessous pour terminer la confirmation de votre e-mail.",
    button: "Confirmer mon e-mail",
    fallback: "Si le bouton ne s’ouvre pas, collez cette adresse dans votre navigateur :",
    once: "Ceci est le seul rappel que nous envoyons.",
    ignore: "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.",
    imageAlt: "Un plongeur portant WatchDive au poignet, sous l’eau",
  },
  de: {
    subject: "WatchDive, es fehlt nur noch die E-Mail-Bestätigung",
    preheader:
      "Deine Anfrage ist eingegangen. Bestätige deine E-Mail, damit die Startnachrichten dich erreichen.",
    headline: "Neuigkeiten zum WatchDive-Start,\ndamit du nichts verpasst.",
    received: "Deine Anfrage für Hinweise ist eingegangen.",
    instruction: "Schließe die Bestätigung deiner E-Mail über den Button unten ab.",
    button: "E-Mail bestätigen",
    fallback: "Falls der Button sich nicht öffnet, füge diese Adresse in deinen Browser ein:",
    once: "Diesen Hinweis senden wir nur einmal.",
    ignore: "Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    imageAlt: "Eine tauchende Person mit WatchDive am Handgelenk, unter Wasser",
  },
  "pt-BR": {
    subject: "WatchDive, falta só confirmar seu e-mail",
    preheader: "Seu pedido foi recebido. Confirme o e-mail para receber as notícias de lançamento.",
    headline: "As notícias de lançamento\ndo WatchDive, sem você perder.",
    received: "Seu pedido de avisos foi recebido.",
    instruction: "Use o botão abaixo para concluir a confirmação do e-mail.",
    button: "Confirmar meu e-mail",
    fallback: "Se o botão não abrir, cole este endereço no navegador:",
    once: "Este é o único lembrete que enviamos.",
    ignore: "Se você não pediu isso, pode ignorar este e-mail.",
    imageAlt: "Uma pessoa mergulhando com o WatchDive no pulso, debaixo d’água",
  },
} as const satisfies Record<Locale, ReminderEmailCopy>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headlineHtml(headline: string): string {
  return escapeHtml(headline).replaceAll("\n", "<br>");
}

/**
 * HTML and plain text for the one reminder. `url` is used as the only
 * destination: the button and the fallback text are the same href.
 */
export function buildReminderEmail(url: string, locale: Locale): ReminderEmail {
  if (!isLocale(locale)) throw new Error("Invalid reminder locale");
  const copy = REMINDER_EMAIL_COPY[locale];
  const safeUrl = escapeHtml(url);
  const wordBreak = locale === "ko" ? "keep-all" : "normal";
  const headlineTracking = locale === "ko" ? "-0.02em" : "-0.01em";
  const bodyTracking = locale === "ko" ? "letter-spacing:-0.01em;" : "";
  const preheaderPad = "&nbsp;&zwnj;".repeat(40);

  const html = [
    "<!doctype html>",
    `<html lang="${locale}" dir="ltr">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(copy.subject)}</title>`,
    "<style>",
    "@media only screen and (max-width:480px){",
    ".wd-shell{padding:16px 8px!important}",
    ".wd-foam,.wd-card{width:100%!important;max-width:100%!important}",
    ".wd-foam{padding:8px!important}",
    ".wd-pad{padding-left:22px!important;padding-right:22px!important}",
    ".wd-title{font-size:24px!important;line-height:1.4!important}",
    ".wd-photo{width:100%!important;max-width:100%!important;height:auto!important}",
    "}",
    "</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${CANVAS};font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${CANVAS};">${escapeHtml(copy.preheader)}${preheaderPad}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="width:100%;border-collapse:collapse;background-color:${CANVAS};">`,
    `<tr><td class="wd-shell" align="center" style="padding:40px 16px;">`,
    "<!--[if mso]><table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td><![endif]-->",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FOAM}" class="wd-foam" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${FOAM};border-radius:28px;">`,
    `<tr><td class="wd-foam" style="padding:12px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" class="wd-card" style="width:100%;max-width:100%;border-collapse:collapse;background-color:${PAPER};border-radius:20px;">`,
    `<tr><td class="wd-pad" align="left" bgcolor="${PAPER}" style="padding:32px 40px 20px;background-color:${PAPER};border-radius:20px 20px 0 0;">`,
    `<img src="${REMINDER_WORDMARK_URL}" width="160" height="24" alt="DIVEROID" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;">`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:0 40px 4px;background-color:${PAPER};">`,
    `<img class="wd-photo" src="${REMINDER_PHOTO_URL}" width="520" alt="${escapeHtml(copy.imageAlt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;border-radius:16px;">`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:0 40px;background-color:${PAPER};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;"><tr>`,
    `<td height="3" bgcolor="${SURFACE}" style="height:3px;line-height:3px;font-size:0;background-color:${SURFACE};border-radius:2px;">&nbsp;</td>`,
    "</tr></table>",
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:28px 40px 8px;background-color:${PAPER};">`,
    `<h1 class="wd-title" style="margin:0;color:${DEEP};font-family:${FONT};font-size:28px;font-weight:500;line-height:1.35;letter-spacing:${headlineTracking};word-break:${wordBreak};overflow-wrap:anywhere;">${headlineHtml(copy.headline)}</h1>`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:16px 40px 0;background-color:${PAPER};">`,
    `<p style="margin:0 0 8px;color:${INK};font-family:${FONT};font-size:15px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.received)}</p>`,
    `<p style="margin:0;color:${INK};font-family:${FONT};font-size:15px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.instruction)}</p>`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:28px 40px 0;background-color:${PAPER};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>`,
    `<td align="center" bgcolor="${MID}" style="background-color:${MID};border-radius:12px;mso-padding-alt:14px 28px;">`,
    `<a href="${safeUrl}" rel="noreferrer noopener" style="display:block;padding:14px 28px;border-radius:12px;color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:600;line-height:22px;text-align:center;text-decoration:none;">${escapeHtml(copy.button)}</a>`,
    "</td></tr></table>",
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:16px 40px 0;background-color:${PAPER};">`,
    `<p style="margin:0 0 6px;color:${INK};font-family:${FONT};font-size:12px;font-weight:400;line-height:1.5;text-align:left;word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.fallback)}</p>`,
    `<p style="margin:0;word-break:break-all;overflow-wrap:anywhere;text-align:left;">`,
    `<a href="${safeUrl}" rel="noreferrer noopener" style="color:${MID};font-family:${FONT};font-size:12px;font-weight:400;line-height:1.45;text-decoration:underline;">${safeUrl}</a>`,
    "</p>",
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:24px 40px 32px;background-color:${PAPER};border-radius:0 0 20px 20px;">`,
    `<p style="margin:0 0 4px;color:${INK};font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.once)}</p>`,
    `<p style="margin:0;color:${INK};font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.ignore)}</p>`,
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr></table>",
    "</body>",
    "</html>",
  ].join("");

  const text = [
    copy.headline,
    "",
    copy.received,
    copy.instruction,
    "",
    copy.button,
    url,
    "",
    copy.fallback,
    url,
    "",
    copy.once,
    copy.ignore,
  ].join("\n");

  return { subject: copy.subject, text, html };
}
