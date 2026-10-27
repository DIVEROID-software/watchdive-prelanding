// The single 24-hour verification reminder. The first confirmation mail stays
// in resend.ts `body()`; this module is selected only when reminder=true.
//
// Pure: no fetch, no logging, no recipient, no token parsing. The href is the
// signed verification URL the caller already built. Images are the approved
// public assets, unaltered.
import { isLocale, type Locale } from "../i18n/locale.ts";
import {
  MAIL_CYAN,
  MAIL_FONT,
  MAIL_INK,
  MAIL_MID,
  MAIL_PAGE,
  MAIL_PAPER,
  MAIL_TEXT,
  MAIL_YELLOW,
  WATCHDIVE_MAIL_LOGO_URL,
  watchdiveLogoImg,
} from "../mail/brutal.ts";

export const REMINDER_ASSET_ORIGIN = "https://watchdive.diveroid.com";
export const REMINDER_WORDMARK_URL = WATCHDIVE_MAIL_LOGO_URL;
export const REMINDER_PHOTO_URL = `${REMINDER_ASSET_ORIGIN}/brand/reservation/watchdive-underwater.jpg`;

const FONT = MAIL_FONT;
const DEEP = "#201748";
const MID = MAIL_MID;
const SURFACE = MAIL_CYAN;
const PAPER = MAIL_PAPER;
const INK = MAIL_TEXT;

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
    subject: "WatchDive: Forgot to confirm your email?",
    preheader: "Confirm your email to complete your signup for WatchDive launch updates.",
    headline: "Forgot to confirm\nyour email?",
    received: "Confirm your email to complete your signup for WatchDive launch updates.",
    instruction: "Click the button below to finish signing up.",
    button: "Confirm my email",
    fallback: "If the button does not open, paste this address into your browser:",
    once: "This is the only reminder we send.",
    ignore: "If you did not request this, you can ignore this email.",
    imageAlt: "A diver wearing WatchDive on the wrist, underwater",
  },
  ko: {
    subject: "WatchDive, 이메일 인증을 깜빡하셨나요?",
    preheader: "이메일 인증을 마쳐야 출시 알림 신청이 완료됩니다.",
    headline: "이메일 인증을\n깜빡하셨나요?",
    received: "이메일 인증을 마쳐야 출시 알림 신청이 완료됩니다.",
    instruction: "아래 버튼을 눌러 알림 신청을 마무리해 주세요.",
    button: "이메일 인증하기",
    fallback: "버튼이 작동하지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.",
    once: "이 안내는 한 번만 보내 드립니다.",
    ignore: "신청한 적이 없다면 이 메일을 무시해 주세요.",
    imageAlt: "수중에서 WatchDive를 찬 다이버의 손목",
  },
  "zh-CN": {
    subject: "WatchDive：忘记确认邮箱了吗？",
    preheader: "完成邮箱确认后，WatchDive 上线提醒订阅才算完成。",
    headline: "忘记确认\n邮箱了吗？",
    received: "完成邮箱确认后，WatchDive 上线提醒订阅才算完成。",
    instruction: "请点击下方按钮，完成订阅。",
    button: "确认邮箱",
    fallback: "如果按钮无法打开，请将下面的地址粘贴到浏览器：",
    once: "这是我们发送的唯一一次提醒。",
    ignore: "如果不是您本人申请的，请忽略这封邮件。",
    imageAlt: "潜水员在水下佩戴 WatchDive 的手腕",
  },
  "zh-TW": {
    subject: "WatchDive：忘記確認電子郵件了嗎？",
    preheader: "完成電子郵件確認後，WatchDive 上線通知訂閱才算完成。",
    headline: "忘記確認\n電子郵件了嗎？",
    received: "完成電子郵件確認後，WatchDive 上線通知訂閱才算完成。",
    instruction: "請點選下方按鈕，完成訂閱。",
    button: "確認電子郵件",
    fallback: "如果按鈕無法開啟，請將下面的網址貼到瀏覽器：",
    once: "這是我們寄出的唯一一次提醒。",
    ignore: "如果不是您本人申請的，請忽略這封信。",
    imageAlt: "潛水員在水下配戴 WatchDive 的手腕",
  },
  ja: {
    subject: "WatchDive：メールアドレスの確認をお忘れですか？",
    preheader: "メールアドレスを確認すると、WatchDiveの発売通知への登録が完了します。",
    headline: "メールアドレスの確認を\nお忘れですか？",
    received: "メールアドレスを確認すると、WatchDiveの発売通知への登録が完了します。",
    instruction: "下のボタンから登録を完了してください。",
    button: "メールアドレスを確認",
    fallback: "ボタンが開かない場合は、次のURLをブラウザに貼り付けてください。",
    once: "このお知らせは一度だけお送りします。",
    ignore: "お心当たりがない場合は、このメールを破棄してください。",
    imageAlt: "水中で WatchDive を腕につけたダイバー",
  },
  es: {
    subject: "WatchDive: ¿Olvidaste confirmar tu correo?",
    preheader:
      "Debes confirmar tu correo para completar tu suscripción a los avisos de lanzamiento de WatchDive.",
    headline: "¿Olvidaste confirmar\ntu correo?",
    received:
      "Debes confirmar tu correo para completar tu suscripción a los avisos de lanzamiento de WatchDive.",
    instruction: "Pulsa el botón de abajo para completar tu suscripción.",
    button: "Confirmar mi correo",
    fallback: "Si el botón no se abre, pega esta dirección en el navegador:",
    once: "Este es el único recordatorio que enviamos.",
    ignore: "Si no solicitaste esto, puedes ignorar este mensaje.",
    imageAlt: "Un buceador con WatchDive en la muñeca, bajo el agua",
  },
  fr: {
    subject: "WatchDive : avez-vous oublié de confirmer votre e-mail ?",
    preheader:
      "Vous devez confirmer votre adresse e-mail pour finaliser votre inscription aux annonces de lancement de WatchDive.",
    headline: "Vous avez oublié de\nconfirmer votre e-mail ?",
    received:
      "Vous devez confirmer votre adresse e-mail pour finaliser votre inscription aux annonces de lancement de WatchDive.",
    instruction: "Cliquez sur le bouton ci-dessous pour finaliser votre inscription.",
    button: "Confirmer mon e-mail",
    fallback: "Si le bouton ne s’ouvre pas, collez cette adresse dans votre navigateur :",
    once: "Ceci est le seul rappel que nous envoyons.",
    ignore: "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.",
    imageAlt: "Un plongeur portant WatchDive au poignet, sous l’eau",
  },
  de: {
    subject: "WatchDive: E-Mail-Bestätigung vergessen?",
    preheader:
      "Bestätige deine E-Mail-Adresse, um deine Anmeldung für Neuigkeiten zum WatchDive-Start abzuschließen.",
    headline: "E-Mail-Bestätigung\nvergessen?",
    received:
      "Bestätige deine E-Mail-Adresse, um deine Anmeldung für Neuigkeiten zum WatchDive-Start abzuschließen.",
    instruction: "Klicke auf den Button unten, um deine Anmeldung abzuschließen.",
    button: "E-Mail bestätigen",
    fallback: "Falls der Button sich nicht öffnet, füge diese Adresse in deinen Browser ein:",
    once: "Diesen Hinweis senden wir nur einmal.",
    ignore: "Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    imageAlt: "Eine tauchende Person mit WatchDive am Handgelenk, unter Wasser",
  },
  "pt-BR": {
    subject: "WatchDive: Esqueceu de confirmar seu e-mail?",
    preheader:
      "Você precisa confirmar seu e-mail para concluir a inscrição nos avisos de lançamento do WatchDive.",
    headline: "Esqueceu de confirmar\nseu e-mail?",
    received:
      "Você precisa confirmar seu e-mail para concluir a inscrição nos avisos de lançamento do WatchDive.",
    instruction: "Clique no botão abaixo para concluir sua inscrição.",
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
    ".wd-pad{padding-left:16px!important;padding-right:16px!important}",
    ".wd-title{font-size:24px!important;line-height:1.35!important}",
    ".wd-photo{width:100%!important;max-width:100%!important;height:auto!important}",
    "}",
    "</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${MAIL_PAGE};font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${MAIL_PAGE};">${escapeHtml(copy.preheader)}${preheaderPad}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MAIL_PAGE}" style="width:100%;border-collapse:collapse;background-color:${MAIL_PAGE};">`,
    `<tr><td class="wd-shell" align="center" style="padding:24px 12px;">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;">',
    `<tr><td bgcolor="${MAIL_INK}" style="padding:0 6px 6px 0;background-color:${MAIL_INK};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:3px solid ${MAIL_INK};border-collapse:separate;background-color:${PAPER};">`,
    `<tr><td class="wd-pad" align="left" bgcolor="${PAPER}" style="padding:34px!important;background-color:${PAPER};border-bottom:3px solid ${MAIL_INK};">`,
    watchdiveLogoImg(REMINDER_WORDMARK_URL),
    "</td></tr>",
    `<tr><td bgcolor="${MAIL_YELLOW}" height="8" style="height:8px;font-size:0;line-height:8px;background-color:${MAIL_YELLOW};border-bottom:3px solid ${MAIL_INK};">&nbsp;</td></tr>`,
    `<tr><td bgcolor="${PAPER}" style="padding:0;background-color:${PAPER};font-size:0;line-height:0;border-bottom:3px solid ${MAIL_INK};">`,
    `<img class="wd-photo" src="${REMINDER_PHOTO_URL}" width="600" alt="${escapeHtml(copy.imageAlt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${SURFACE}" style="padding:22px 22px 8px;background-color:${SURFACE};border-bottom:3px solid ${MAIL_INK};">`,
    `<h1 class="wd-title" style="margin:0;color:${INK};font-family:${FONT};font-size:28px;font-weight:700;line-height:1.3;letter-spacing:${headlineTracking};word-break:${wordBreak};overflow-wrap:anywhere;">${headlineHtml(copy.headline)}</h1>`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:18px 22px 0;background-color:${PAPER};">`,
    `<p style="margin:0 0 8px;color:${INK};font-family:${FONT};font-size:15px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.received)}</p>`,
    `<p style="margin:0;color:${INK};font-family:${FONT};font-size:15px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.instruction)}</p>`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:22px 22px 0;background-color:${PAPER};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr>`,
    `<td align="center" bgcolor="${SURFACE}" style="background-color:${SURFACE};border:3px solid ${MAIL_INK};mso-padding-alt:14px 28px;">`,
    `<a href="${safeUrl}" rel="noreferrer noopener" style="display:block;padding:14px 28px;color:${INK};font-family:${FONT};font-size:16px;font-weight:600;line-height:22px;text-align:center;text-decoration:none;">${escapeHtml(copy.button)}</a>`,
    "</td></tr></table>",
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:16px 22px 0;background-color:${PAPER};">`,
    `<p style="margin:0 0 6px;color:${INK};font-family:${FONT};font-size:12px;font-weight:400;line-height:1.5;text-align:left;word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.fallback)}</p>`,
    `<p style="margin:0;word-break:break-all;overflow-wrap:anywhere;text-align:left;">`,
    `<a href="${safeUrl}" rel="noreferrer noopener" style="color:${MID};font-family:${FONT};font-size:12px;font-weight:400;line-height:1.45;text-decoration:underline;">${safeUrl}</a>`,
    "</p>",
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:20px 22px 28px;background-color:${PAPER};">`,
    `<p style="margin:0 0 4px;color:${DEEP};font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.once)}</p>`,
    `<p style="margin:0;color:${DEEP};font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;${bodyTracking}word-break:${wordBreak};overflow-wrap:anywhere;">${escapeHtml(copy.ignore)}</p>`,
    "</td></tr>",
    "</table>",
    "</td></tr></table>",
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
