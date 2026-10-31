import { compatibilityEmailFragment } from "../compatibility/email.ts";
import type { CompatibilityContext } from "../compatibility/context.ts";
import { phoneOptInCopy } from "../phoneOptInCopy.ts";
// Direct Resend HTTP client. No SDK, so nothing can drag an API key into a
// client bundle: this module is only ever reached from a server function.
//
// Delivery is one transactional message to one recipient. It is never batched,
// never a campaign, and carries no list state. The launch mails
// (src/lib/launchMail) reuse `deliver` below, still one recipient per request,
// but keep their own list state in Notion.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import {
  isLeadId,
  requireSecret,
  verificationTokenLocale,
  verificationUrl,
  type TokenEnvironment,
} from "./token.ts";
import { watchdiveLogoImg } from "../mail/brutal.ts";
import { buildReminderEmail } from "./reminderEmail.ts";
import { DEFAULT_LOCALE, referralPath, type Locale } from "../i18n/locale.ts";
import type { ReferralMailer, ReferralNoticeMail } from "../referral/contract.ts";
import { buddyMailCopy, buddyMailEvent } from "../referral/mail-copy.ts";
import { fill } from "../referral/copy.ts";
import { REFERRAL_TIERS, referralProgramEnabled } from "../referral/program.ts";
// Core-owned (feat/referral-core): `copyValues(locale)` returns every
// program.ts number pre-formatted for the locale ({price}, {seats}, {stock},
// {winners}, {cap}, {noticeDays}, ...). `{hours}` is per tier and filled here.
import { copyValues } from "../referral/values.ts";
import { LABEL_SEPARATOR, LAUNCH_COPY } from "../launchMail/copy.ts";
import {
  createUnsubscribeToken,
  unsubscribeUrl as launchUnsubscribeUrl,
} from "../launchMail/unsubscribeToken.ts";
import {
  RESERVATION_LEGAL_NAME,
  RESERVATION_REGISTERED_OFFICE,
} from "../reservation-mail/merchant.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const LINEAR_RETRY_BASE_MS = 200;

/** Verification sends only. Other operations keep the historical linear delay. */
export const VERIFICATION_RETRY_BASE_MS = 200;
export const VERIFICATION_RETRY_CAP_MS = 2_000;
export const VERIFICATION_RETRY_JITTER_MS = 200;

export type DeliveryPolicy = {
  /** Unit interval [0, 1). Verification backoff only. */
  random?: () => number;
  /** Replaces the 10s provider abort. Tests pass a few milliseconds. */
  requestTimeoutMs?: number;
};

/**
 * Delay before another try of the same verification payload. `failedAttempt`
 * is the attempt that just failed, starting at 1. Jitter is an integer number
 * of milliseconds in `[0, VERIFICATION_RETRY_JITTER_MS)`.
 */
export function verificationBackoffMs(failedAttempt: number, randomUnit: number): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new Error("Invalid retry attempt");
  }
  const unit = Number.isFinite(randomUnit) ? Math.min(0.999999, Math.max(0, randomUnit)) : 0;
  const exponential = VERIFICATION_RETRY_BASE_MS * 2 ** (failedAttempt - 1);
  const jitter = Math.floor(unit * VERIFICATION_RETRY_JITTER_MS);
  return Math.min(VERIFICATION_RETRY_CAP_MS, exponential + jitter);
}

function retryDelayMs(operation: string, failedAttempt: number, random: () => number): number {
  if (operation !== "verification") return LINEAR_RETRY_BASE_MS * failedAttempt;
  return verificationBackoffMs(failedAttempt, random());
}

type VerificationAttemptOutcome = "accepted" | "retry" | "terminal";

/** Timing for one verification provider call. No address, token, key, or body. */
function logVerificationAttempt(
  operation: string,
  attempt: number,
  startedMs: number,
  status: number | null,
  outcome: VerificationAttemptOutcome,
): void {
  if (operation !== "verification") return;
  const log = outcome === "accepted" ? console.info : console.error;
  log("[watchdive] verification_mail_attempt", {
    provider: "resend",
    operation: "verification",
    attempt,
    status,
    durationMs: Math.max(0, Date.now() - startedMs),
    at: new Date().toISOString(),
    outcome,
  });
}

// Resend answers a request with no User-Agent with 403 code 1010. A fixed
// product string satisfies it and says nothing about the caller.
const USER_AGENT = "watchdive-prelanding/1.0";

/**
 * Two different 409s share one status. `concurrent_idempotent_requests` means
 * an identical request is still in flight and the same key may be retried;
 * `invalid_idempotent_request` means the key was reused with a different
 * payload and must never be retried. Anything else is treated as terminal.
 */
const RETRYABLE_CONFLICT = "concurrent_idempotent_requests";

export type ResendEnvironment = {
  RESEND_API_KEY?: string;
  /**
   * Ignored when choosing the mailbox. Callers and the build preflight may
   * still set it. The From address is always `FIXED_SENDER_MAILBOX`.
   */
  WATCHDIVE_EMAIL_FROM?: string;
  /** Display name shown in the inbox. Defaults to "WatchDive". */
  WATCHDIVE_EMAIL_FROM_NAME?: string;
  WATCHDIVE_EMAIL_REPLY_TO?: string;
  /** Buddy Invite master switch (program.ts `referralProgramEnabled`). */
  WATCHDIVE_REFERRAL_PROGRAM_ENABLED?: string;
  /** Signs the Buddy Invite opt-out link (launch-mail unsubscribe token). */
  WATCHDIVE_VERIFICATION_SECRET?: string;
  /** Sender phone for the Korean advertising sender block. */
  WATCHDIVE_SENDER_PHONE?: string;
};

export type ResendConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

export type VerificationMail = {
  compatibility?: CompatibilityContext;
  to: string;
  token: string;
  leadId: string;
  publicOrigin: string;
  locale: Locale;
  /**
   * The single scheduled reminder. When true, the reminder template is used
   * instead of the first confirmation. The idempotency key stays in its own
   * namespace because the reminder reuses the attempt's lead id (so the first
   * link keeps working) and would otherwise collide with the original send.
   */
  reminder?: boolean;
  /** Explicit user-authorized one-off; signing secret remains server-side. */
  manualCampaign?: "wd-manual-verify-20261019" | "wd-verification-recovery-20261031";
  /**
   * Native Instant Form confirmation only. When this is
   * `watchdive-instant-form-` plus 64 hex digits, Resend uses it instead of
   * `watchdive-verification-${leadId}`. Website sends omit it and keep the
   * existing lead-id key. The signed token format does not change.
   */
  idempotencyKey?: string;
};

export type WelcomeMail = {
  to: string;
  refCode: string;
  leadId: string;
  publicOrigin: string;
  /** ISO 8601 instant. Resend holds the message until then, up to 30 days out. */
  scheduledAt: string;
  locale: Locale;
  /**
   * Signed Buddy Invite status page (core `statusUrl`) and the locale's
   * official rules page (core `rulesUrl`). Set by scheduleWelcome only while
   * WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1; without both, and without the switch
   * in the mailer's own env, the legacy welcome goes out unchanged.
   */
  statusUrl?: string;
  rulesUrl?: string;
  shareCode?: string;
  /** Coarse signup country; `KR` applies the Korean advertising rules to the guide. */
  signupCountry?: string;
};

export type VerificationMailer = {
  send(input: VerificationMail): Promise<void>;
  sendWelcome(input: WelcomeMail): Promise<void>;
};

/**
 * A share link as a path, never `?ref=<code>`.
 *
 * The same transfer encoding that destroyed the confirmation token eats `=`
 * followed by two hex digits, and a ref code is eight characters of `[a-z0-9]`
 * — so roughly one in five `?ref=` links would arrive with the code mangled and
 * the referral silently unattributed. A path segment has no `=` to lose.
 */
export function referralUrl(
  publicOrigin: string,
  refCode: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!/^[a-z0-9]{8}$/.test(refCode)) throw new Error("Invalid referral code");
  return new URL(referralPath(locale, refCode), publicOrigin).toString();
}

/** Production From mailbox. Not read from the environment. */
export const FIXED_SENDER_MAILBOX = "help@diveroid.com";

/** Inbox display name when `WATCHDIVE_EMAIL_FROM_NAME` is blank. */
export const DEFAULT_SENDER_NAME = "WatchDive";

/** Characters that can split a From header or hide a second mailbox. */
const DISPLAY_NAME_STRIP = /["<>\r\n@,;\\\u0000-\u001f\u007f\uFF20\uFE6B]/g;

/**
 * Always `Name <help@diveroid.com>`.
 *
 * `from` is accepted so existing callers keep the same signature, and then
 * discarded. `WATCHDIVE_EMAIL_FROM` used to choose the mailbox. A stale value
 * such as `verify@mail.oceanwick.ai` must not be able to put that address
 * back, and there is no second mailbox to fall back to.
 *
 * The display name is the sanitized `WATCHDIVE_EMAIL_FROM_NAME`, or WatchDive.
 * An explicit name, including `DIVEROID`, is kept. Quotes, brackets, newlines,
 * commas, `@` and the fullwidth at-sign are removed so the header cannot
 * carry another address.
 */
export function senderWithDisplayName(from: string, name?: string): string {
  void from;
  const display = (name ?? "").replace(DISPLAY_NAME_STRIP, "").replace(/[ \t]+/g, " ").trim();
  return `${display || DEFAULT_SENDER_NAME} <${FIXED_SENDER_MAILBOX}>`;
}

/**
 * The provider body is built only after this accepts the header. One `@`,
 * and it belongs to the fixed mailbox. A hand-built config cannot substitute
 * another sender when `readResendConfig` was bypassed.
 */
export function assertFixedSender(from: string): void {
  const mailbox = `<${FIXED_SENDER_MAILBOX}>`;
  if (from.split("@").length !== 2 || !from.endsWith(mailbox) || /[\r\n]/.test(from)) {
    throw new Error("Refusing to send from any mailbox other than the fixed WatchDive sender");
  }
}

export function readResendConfig(env: ResendEnvironment = process.env): ResendConfig {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const from = senderWithDisplayName(FIXED_SENDER_MAILBOX, env.WATCHDIVE_EMAIL_FROM_NAME);
  const replyTo = (env.WATCHDIVE_EMAIL_REPLY_TO ?? "").trim();
  return { apiKey, from, ...(replyTo ? { replyTo } : {}) };
}

export class ResendDeliveryError extends Error {
  // Written out rather than as a constructor parameter property: `npm test`
  // runs under Node's type stripping, which rejects that syntax.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ResendDeliveryError";
    this.status = status;
  }
}

// 429, 5xx and transport faults are worth another attempt with the same
// idempotency key. A 4xx is a rejected address or our own bug, and retrying it
// only spends rate limit.
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Reads only the error code out of a bounded slice of the body. The body can
 * echo the recipient address, so it is never logged and never surfaced — the
 * one field consulted is matched against a fixed string.
 */
export async function isRetryableConflict(response: Response): Promise<boolean> {
  let raw: string;
  try {
    raw = (await response.text()).slice(0, 2048);
  } catch {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const name = (parsed as { name?: unknown } | null)?.name;
    return name === RETRYABLE_CONFLICT;
  } catch {
    // Unparseable conflict: fail closed and do not retry.
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type EmailCopy = {
  verification: {
    subject: string;
    heading: string;
    intro: string;
    button: string;
    fallback: string;
    expires: string;
    ignore: string;
  };
  welcome: {
    subject: string;
    heading: string;
    intro: string;
    button: string;
    fallback: string;
    outro: string;
  };
};

// These messages intentionally say only what the flow has actually done.
// Price, discount and product performance are still unconfirmed in
// docs/01-product-truth.md, so none is introduced in any language. Copy is
// reviewed again through the independent native-tone gate before release.
//
// Referral rewards are no longer unconfirmed: the owner approved the Buddy
// Invite program on 2026-10-22 and its tiers, rewards and limits are defined in
// src/lib/referral/program.ts. They appear only in the Buddy Invite guide and
// the friend-joined notice (buddyGuideBody / referralNoticeBody), whose words
// come from src/lib/referral/copy.ts and whose numbers come from program.ts.
// Until the owner's final go-live (WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1) the
// neutral `welcomeBody` below is still what people receive, byte for byte
// (its source is hash-frozen in tests/reminder-email.test.ts, so it is left
// exactly as reviewed, comment included).
const EMAIL_COPY = {
  en: {
    verification: {
      subject: "Confirm your WatchDive waitlist email",
      heading: "Confirm your WatchDive waitlist email",
      intro:
        "Open the link below to confirm the email address for your WatchDive pre-launch updates.",
      button: "Confirm my email",
      fallback: "If the button does not work, paste this link into your browser:",
      expires: "The link expires in 24 hours.",
      ignore: "If you did not request this, ignore this email. Nothing will happen.",
    },
    welcome: {
      subject: "You’re on the WatchDive waitlist",
      heading: "You’re on the WatchDive waitlist",
      intro:
        "Your email is confirmed. Here is your personal invite link. Share it with fellow divers.",
      button: "Open my invite link",
      fallback: "Or copy this link:",
      outro: "We will email you when WatchDive goes live on Kickstarter.",
    },
  },
  ko: {
    verification: {
      subject: "WatchDive 대기 명단 이메일을 인증해 주세요",
      heading: "이메일을 인증해 주세요",
      intro: "아래 링크를 열어 WatchDive 출시 전 소식을 받을 이메일 주소를 인증해 주세요.",
      button: "이메일 인증하기",
      fallback: "버튼이 열리지 않으면 아래 링크를 브라우저에 붙여 넣어 주세요:",
      expires: "이 링크는 24시간 후 만료됩니다.",
      ignore: "직접 요청한 적이 없다면 이 메일을 무시해 주세요. 별도의 처리는 이루어지지 않습니다.",
    },
    welcome: {
      subject: "WatchDive 출시 알림 신청이 완료되었습니다.",
      heading: "WatchDive 출시 알림 신청이 완료되었습니다.",
      intro:
        "이메일 인증이 완료되었습니다. 아래 개인 초대 링크를 다이빙에 관심 있는 분들과 공유해 주세요.",
      button: "내 초대 링크 열기",
      fallback: "링크를 직접 복사하려면:",
      outro: "WatchDive가 Kickstarter에 공개되면 이메일로 알려드리겠습니다.",
    },
  },
  "zh-CN": {
    verification: {
      subject: "请确认您的 WatchDive 候补名单邮箱",
      heading: "确认您的邮箱",
      intro: "请打开下方链接，确认用于接收 WatchDive 上线前消息的邮箱地址。",
      button: "确认邮箱",
      fallback: "如果按钮无法打开，请将以下链接复制到浏览器：",
      expires: "此链接将在 24 小时后失效。",
      ignore: "如果不是您本人提交的申请，请忽略这封邮件，我们不会进行任何操作。",
    },
    welcome: {
      subject: "您已加入 WatchDive 候补名单",
      heading: "您已加入 WatchDive 候补名单",
      intro: "邮箱已确认。下面是您的专属邀请链接，可以分享给同样热爱潜水的朋友。",
      button: "打开我的邀请链接",
      fallback: "也可以复制此链接：",
      outro: "WatchDive 在 Kickstarter 上线时，我们会通过邮件通知您。",
    },
  },
  "zh-TW": {
    verification: {
      subject: "請確認您的 WatchDive 等候名單電子郵件",
      heading: "確認您的電子郵件",
      intro: "請開啟下方連結，確認用來接收 WatchDive 上線前消息的電子郵件地址。",
      button: "確認電子郵件",
      fallback: "如果按鈕無法開啟，請將下方連結貼到瀏覽器：",
      expires: "此連結將在 24 小時後失效。",
      ignore: "如果不是您本人提出申請，請忽略這封信，我們不會進行任何動作。",
    },
    welcome: {
      subject: "您已加入 WatchDive 等候名單",
      heading: "您已加入 WatchDive 等候名單",
      intro: "電子郵件已確認。下方是您的專屬邀請連結，歡迎分享給同樣喜歡潛水的朋友。",
      button: "開啟我的邀請連結",
      fallback: "也可以複製此連結：",
      outro: "WatchDive 在 Kickstarter 上線時，我們會寄信通知您。",
    },
  },
  ja: {
    verification: {
      subject: "WatchDiveウェイトリストのメールアドレスをご確認ください",
      heading: "メールアドレスを確認してください",
      intro:
        "下のリンクを開き、WatchDiveのローンチ前情報を受け取るメールアドレスを確認してください。",
      button: "メールアドレスを確認",
      fallback: "ボタンが開かない場合は、次のリンクをブラウザに貼り付けてください：",
      expires: "このリンクの有効期限は24時間です。",
      ignore: "このメールに心当たりがない場合は、そのまま破棄してください。手続きは行われません。",
    },
    welcome: {
      subject: "WatchDiveウェイトリストへの登録が完了しました",
      heading: "WatchDiveウェイトリストへの登録が完了しました",
      intro:
        "メールアドレスの確認が完了しました。あなた専用の招待リンクを、ダイビング仲間にシェアできます。",
      button: "招待リンクを開く",
      fallback: "リンクをコピーする場合：",
      outro: "WatchDiveがKickstarterで公開される際に、メールでお知らせします。",
    },
  },
  es: {
    verification: {
      subject: "Confirma tu correo para la lista de espera de WatchDive",
      heading: "Confirma tu correo",
      intro:
        "Abre el enlace de abajo para confirmar la dirección en la que quieres recibir novedades de prelanzamiento de WatchDive.",
      button: "Confirmar mi correo",
      fallback: "Si el botón no funciona, pega este enlace en tu navegador:",
      expires: "El enlace caduca en 24 horas.",
      ignore: "Si no hiciste esta solicitud, ignora el mensaje. No se realizará ninguna acción.",
    },
    welcome: {
      subject: "Ya estás en la lista de espera de WatchDive",
      heading: "Ya estás en la lista de espera de WatchDive",
      intro:
        "Tu correo está confirmado. Este es tu enlace de invitación personal; puedes compartirlo con otras personas que bucean.",
      button: "Abrir mi enlace de invitación",
      fallback: "También puedes copiar este enlace:",
      outro: "Te avisaremos por correo cuando WatchDive se publique en Kickstarter.",
    },
  },
  fr: {
    verification: {
      subject: "Confirmez votre adresse e-mail pour la liste d’attente WatchDive",
      heading: "Confirmez votre adresse e-mail",
      intro:
        "Ouvrez le lien ci-dessous pour confirmer l’adresse à laquelle vous souhaitez recevoir les actualités de pré-lancement de WatchDive.",
      button: "Confirmer mon adresse",
      fallback: "Si le bouton ne fonctionne pas, collez ce lien dans votre navigateur :",
      expires: "Ce lien expire dans 24 heures.",
      ignore:
        "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Aucune action ne sera effectuée.",
    },
    welcome: {
      subject: "Vous êtes sur la liste d’attente WatchDive",
      heading: "Vous êtes sur la liste d’attente WatchDive",
      intro:
        "Votre adresse e-mail est confirmée. Voici votre lien d’invitation personnel, à partager avec d’autres plongeurs.",
      button: "Ouvrir mon lien d’invitation",
      fallback: "Vous pouvez aussi copier ce lien :",
      outro: "Nous vous préviendrons par e-mail lorsque WatchDive sera lancé sur Kickstarter.",
    },
  },
  de: {
    verification: {
      subject: "Bestätige deine E-Mail für die WatchDive-Warteliste",
      heading: "Bestätige deine E-Mail-Adresse",
      intro:
        "Öffne den folgenden Link, um die E-Mail-Adresse für Updates vor dem Start von WatchDive zu bestätigen.",
      button: "E-Mail-Adresse bestätigen",
      fallback: "Falls der Button nicht funktioniert, füge diesen Link in deinen Browser ein:",
      expires: "Der Link ist 24 Stunden lang gültig.",
      ignore:
        "Falls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail. Es wird nichts weiter veranlasst.",
    },
    welcome: {
      subject: "Du bist auf der WatchDive-Warteliste",
      heading: "Du bist auf der WatchDive-Warteliste",
      intro:
        "Deine E-Mail-Adresse ist bestätigt. Hier ist dein persönlicher Einladungslink zum Teilen mit anderen Tauchern.",
      button: "Meinen Einladungslink öffnen",
      fallback: "Oder kopiere diesen Link:",
      outro: "Wir informieren dich per E-Mail, sobald WatchDive auf Kickstarter startet.",
    },
  },
  "pt-BR": {
    verification: {
      subject: "Confirme seu e-mail para a lista de espera do WatchDive",
      heading: "Confirme seu e-mail",
      intro:
        "Abra o link abaixo para confirmar o endereço em que deseja receber novidades de pré-lançamento do WatchDive.",
      button: "Confirmar meu e-mail",
      fallback: "Se o botão não funcionar, cole este link no navegador:",
      expires: "O link expira em 24 horas.",
      ignore: "Se você não fez essa solicitação, ignore este e-mail. Nenhuma ação será realizada.",
    },
    welcome: {
      subject: "Você está na lista de espera do WatchDive",
      heading: "Você está na lista de espera do WatchDive",
      intro:
        "Seu e-mail foi confirmado. Este é o seu link de convite pessoal; compartilhe com outras pessoas que mergulham.",
      button: "Abrir meu link de convite",
      fallback: "Você também pode copiar este link:",
      outro: "Vamos avisar por e-mail quando o WatchDive entrar no ar no Kickstarter.",
    },
  },
  nl: {
    verification: {
      subject: "Bevestig je e-mail voor de WatchDive-wachtlijst",
      heading: "Bevestig je e-mailadres",
      intro:
        "Er is één bevestigingslink. Je aanmelding is pas afgerond als je die link opent, voor nieuws over WatchDive vóór de lancering.",
      button: "Bevestig mijn e-mail",
      fallback: "Als de knop niet werkt, plak deze link in je browser:",
      expires: "De link werkt 24 uur.",
      ignore: "Heb je dit niet gevraagd, negeer dan deze mail. Er gebeurt niets.",
    },
    welcome: {
      subject: "Je staat op de WatchDive-wachtlijst",
      heading: "Je staat op de WatchDive-wachtlijst",
      intro:
        "Je e-mail is bevestigd. Dit is je persoonlijke uitnodigingslink. Deel hem met andere duikers.",
      button: "Open mijn uitnodigingslink",
      fallback: "Of kopieer deze link:",
      outro: "We mailen je wanneer WatchDive op Kickstarter opent.",
    },
  },
} as const satisfies Record<Locale, EmailCopy>;

/** Safe page/email alignment contract: no address, token, provider key or body. */
export function verificationEmailUiCopy(locale: Locale): {
  subject: string;
  button: string;
} {
  const { subject, button } = EMAIL_COPY[locale].verification;
  return { subject, button };
}

function body(url: string, locale: Locale, compatibility?: CompatibilityContext): { subject: string; text: string; html: string } {
  const safeUrl = escapeHtml(url);
  const result = compatibility ? compatibilityEmailFragment(compatibility, locale) : null;
  const copy = EMAIL_COPY[locale].verification;
  // Official WatchDive primary PNG. The signed page origin is not used, so a
  // verification token never becomes part of the image address.
  const wordmark = watchdiveLogoImg();
  const font = "Arial,'Helvetica Neue','Apple SD Gothic Neo','Malgun Gothic','Hiragino Sans','Microsoft YaHei','PingFang SC','PingFang TC',sans-serif";
  const wrap = locale === "ko" ? "word-break:keep-all;overflow-wrap:break-word;" : "overflow-wrap:break-word;";
  // Kept separate from buddyDocument: this is transactional and must never
  // inherit the Buddy Invite advertising footer, rewards or unsubscribe links.
  return {
    text: [copy.heading, "", ...(result ? [result.text, ""] : []), copy.intro, url, "", phoneOptInCopy[locale].emailHint, "", copy.expires, copy.ignore].join("\n"),
    html: [
      "<!doctype html>",
      `<html lang="${locale}" dir="ltr"><head><meta charset="utf-8">`,
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
      `<title>${escapeHtml(copy.subject)}</title>`,
      `<style>
      .verify-blue,.verify-yellow,.verify-brand{color-scheme:only light;forced-color-adjust:none;}
      .verify-blue *,.verify-yellow *{-webkit-text-fill-color:#1a1238!important;}
      @media (prefers-color-scheme:dark){
        .verify-page{background-color:#07131c!important;}
        .verify-card{background-color:#1a1238!important;}
        .verify-copy{color:#eef9ff!important;}
        .verify-frame{border-color:#eef9ff!important;}
        .verify-shadow{background-color:#eef9ff!important;}
        .verify-blue{background-color:#36A9E1!important;}
        .verify-yellow{background-color:#ffe55c!important;}
        .verify-brand{background-color:#ffffff!important;}
        .verify-info{background-color:#201748!important;border-left-color:#36A9E1!important;}
      }</style>`,
      '<!--[if mso]><style>body,table,td,p,a,h1{font-family:Arial,sans-serif!important;}</style><![endif]-->',
      `</head><body class="verify-page" style="margin:0;padding:0;width:100%;background-color:#f5f3ee;font-family:${font};-webkit-text-size-adjust:100%;">`,
      `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(copy.intro)}</div>`,
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f3ee" class="verify-page" style="width:100%;background-color:#f5f3ee;border-collapse:collapse;">',
      '<tr><td align="center" style="padding:24px 12px;">',
      '<!--[if mso]><table role="presentation" width="576" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:576px;table-layout:fixed;border-collapse:separate;">',
      // Table-cell shadows survive Outlook's Word renderer without box-shadow.
      '<tr><td class="verify-shadow" bgcolor="#111111" style="padding:0 6px 6px 0;background-color:#111111;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="verify-frame" style="width:100%;table-layout:fixed;border:3px solid #111111;border-collapse:separate;">',
      '<tr><td class="verify-brand verify-frame" bgcolor="#ffffff" style="padding:34px!important;background-color:#ffffff;border-bottom:3px solid #111111;">',
      wordmark,
      '</td></tr><tr><td class="verify-yellow verify-frame" bgcolor="#ffe55c" height="8" style="height:8px;font-size:0;line-height:8px;background-color:#ffe55c;background-image:linear-gradient(#ffe55c,#ffe55c);border-bottom:3px solid #111111;">&nbsp;</td></tr>',
      '<tr><td class="verify-blue verify-frame" bgcolor="#36A9E1" style="padding:26px 22px;background-color:#36A9E1;background-image:linear-gradient(#36A9E1,#36A9E1);border-bottom:3px solid #111111;">',
      `<p style="margin:0 0 12px;font-size:13px;line-height:18px;font-weight:700;letter-spacing:1px;color:#1a1238;">WatchDive</p>`,
      `<h1 style="margin:0;font-family:${font};font-size:30px;line-height:1.25;font-weight:700;letter-spacing:-0.5px;color:#1a1238;${wrap}">${escapeHtml(copy.heading)}</h1>`,
      `</td></tr><tr><td class="verify-card" bgcolor="#ffffff" style="padding:24px 22px;background-color:#ffffff;font-family:${font};${wrap}">`,
      ...(result ? [`<div class="verify-copy" style="font-size:15px;line-height:1.6;">${result.html}</div>`] : []),
      `<p class="verify-copy" style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#1a1238;">${escapeHtml(copy.intro)}</p>`,
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:separate;">',
      '<tr><td class="verify-shadow" bgcolor="#111111" style="padding:0 4px 4px 0;background-color:#111111;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:separate;"><tr>',
      '<td class="verify-blue verify-frame" align="center" bgcolor="#36A9E1" style="background-color:#36A9E1;background-image:linear-gradient(#36A9E1,#36A9E1);border:3px solid #111111;mso-padding-alt:18px 12px;">',
      `<a href="${safeUrl}" rel="noreferrer noopener" style="display:block;padding:18px 12px;font-family:${font};font-size:18px;line-height:24px;font-weight:700;color:#1a1238;text-decoration:none;mso-padding-alt:0;">${escapeHtml(copy.button)}</a>`,
      '</td></tr></table></td></tr><tr><td height="24" style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr></table>',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;"><tr>',
      '<td class="verify-info verify-frame" bgcolor="#EEF9FF" style="padding:16px;background-color:#EEF9FF;border:2px solid #111111;border-left:6px solid #36A9E1;">',
      `<p class="verify-copy" style="margin:0;font-size:14px;line-height:1.65;color:#1a1238;">${escapeHtml(phoneOptInCopy[locale].emailHint)}</p>`,
      '</td></tr></table>',
      `<p class="verify-copy" style="margin:24px 0 8px;font-size:12px;line-height:1.65;color:#534e63;">${escapeHtml(copy.fallback)}</p>`,
      `<p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;"><a class="verify-copy" href="${safeUrl}" rel="noreferrer noopener" style="color:#3d2683;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeUrl}</a></p>`,
      '</td></tr></table></td></tr>',
      `<tr><td style="padding:16px 6px 0 0;font-family:${font};${wrap}"><p class="verify-copy" style="margin:0 0 6px;font-size:12px;line-height:1.65;color:#534e63;">${escapeHtml(copy.expires)}</p>`,
      `<p class="verify-copy" style="margin:0;font-size:12px;line-height:1.65;color:#534e63;">${escapeHtml(copy.ignore)}</p></td></tr>`,
      '</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>',
    ].join(""),
    subject: copy.subject,
  };
}

/** Offline preview of the initial verification mail. Does not sign, send, or read secrets. */
export function renderInitialVerificationMail(
  url: string,
  locale: Locale,
  compatibility?: CompatibilityContext,
): { subject: string; text: string; html: string } {
  return body(url, locale, compatibility);
}

// Copy stays as neutral as the confirmation mail. The referral reward is still
// unapproved in `docs/01-product-truth.md`, so this hands over the link and
// says nothing about what sharing it earns.
function welcomeBody(url: string, locale: Locale): { subject: string; text: string; html: string } {
  const safeUrl = escapeHtml(url);
  const copy = EMAIL_COPY[locale].welcome;
  const font = "Arial,'Helvetica Neue','Apple SD Gothic Neo','Malgun Gothic','Hiragino Sans','Microsoft YaHei','PingFang SC','PingFang TC',sans-serif";
  const wrap = locale === "ko" ? "word-break:keep-all;overflow-wrap:break-word;" : "overflow-wrap:break-word;";
  return {
    text: [copy.heading, "", copy.intro, url, "", copy.outro].join("\n"),
    html: [
      "<!doctype html>",
      `<html lang="${locale}" dir="ltr"><head><meta charset="utf-8">`,
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="color-scheme" content="light">',
      `<title>${escapeHtml(copy.subject)}</title></head>`,
      `<body style="margin:0;padding:0;width:100%;background-color:#f5f3ee;font-family:${font};-webkit-text-size-adjust:100%;">`,
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f3ee" style="width:100%;background-color:#f5f3ee;border-collapse:collapse;">',
      '<tr><td align="center" style="padding:24px 12px;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;">',
      '<tr><td bgcolor="#111111" style="padding:0 6px 6px 0;background-color:#111111;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:3px solid #111111;border-collapse:separate;">',
      `<tr><td bgcolor="#ffffff" style="padding:34px!important;background-color:#ffffff;border-bottom:3px solid #111111;">${watchdiveLogoImg()}</td></tr>`,
      '<tr><td bgcolor="#ffe55c" height="8" style="height:8px;font-size:0;line-height:8px;background-color:#ffe55c;border-bottom:3px solid #111111;">&nbsp;</td></tr>',
      `<tr><td bgcolor="#ffffff" style="padding:24px 22px;background-color:#ffffff;font-family:${font};${wrap}">`,
      `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.25;font-weight:700;color:#1a1238;">${escapeHtml(copy.heading)}</h1>`,
      `<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#1a1238;">${escapeHtml(copy.intro)}</p>`,
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr>',
      '<td align="center" bgcolor="#36A9E1" style="background-color:#36A9E1;border:3px solid #111111;mso-padding-alt:14px 18px;">',
      `<a href="${safeUrl}" rel="noreferrer noopener" style="display:block;padding:14px 18px;font-family:${font};font-size:16px;line-height:22px;font-weight:700;color:#1a1238;text-decoration:none;">${escapeHtml(copy.button)}</a>`,
      "</td></tr></table>",
      `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#534e63;">${escapeHtml(copy.fallback)}<br>`,
      `<span style="word-break:break-all;overflow-wrap:anywhere;">${safeUrl}</span></p>`,
      `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#534e63;">${escapeHtml(copy.outro)}</p>`,
      "</td></tr></table></td></tr></table></td></tr></table></body></html>",
    ].join(""),
    subject: copy.subject,
  };
}

/** Program-off welcome. Same bytes as the mailer sends. Preview-only callers use this. */
export function renderLegacyWelcomeMail(url: string, locale: Locale): { subject: string; text: string; html: string } {
  return welcomeBody(url, locale);
}

/**
 * One accepted send, or a throw. Retries reuse the same idempotency key and the
 * byte-identical payload, so a retry can never become a second message.
 */
async function deliverWithRetries(
  config: ResendConfig,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  operation: string,
  policy: DeliveryPolicy = {},
): Promise<void> {
  // Payload used to be spread last, so a `from` or `reply_to` on the message
  // replaced the config. Strip both, then put the fixed mailbox first.
  assertFixedSender(config.from);
  const rest: Record<string, unknown> = { ...payload };
  delete rest.from;
  delete rest.reply_to;
  const serialized = JSON.stringify({
    from: config.from,
    ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    ...rest,
  });
  const timeoutMs = policy.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const random = policy.random ?? Math.random;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedMs = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "Idempotency-Key": idempotencyKey,
        },
        body: serialized,
      });
    } catch {
      // Transport fault: no status to reason about, so treat as retryable
      // and never echo the cause, which can carry the recipient address.
      lastError = new ResendDeliveryError("Resend request failed", 0);
      if (attempt < MAX_ATTEMPTS) {
        logVerificationAttempt(operation, attempt, startedMs, 0, "retry");
        await sleep(retryDelayMs(operation, attempt, random));
        continue;
      }
      logVerificationAttempt(operation, attempt, startedMs, 0, "terminal");
      throw lastError;
    }

    if (!response.ok) {
      const error = new ResendDeliveryError(
        `Resend delivery failed (${response.status})`,
        response.status,
      );
      // A conflict is retryable only when Resend says the identical request
      // is still in flight; the same key and payload go back out.
      const conflictRetryable =
        response.status === 409 ? await isRetryableConflict(response) : false;
      if ((retryable(response.status) || conflictRetryable) && attempt < MAX_ATTEMPTS) {
        lastError = error;
        logVerificationAttempt(operation, attempt, startedMs, response.status, "retry");
        await sleep(retryDelayMs(operation, attempt, random));
        continue;
      }
      logVerificationAttempt(operation, attempt, startedMs, response.status, "terminal");
      throw error;
    }

    // A 2xx without a usable message id is not an accepted send. Trusting
    // it would let the flow report a delivery that may never have happened.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      logVerificationAttempt(operation, attempt, startedMs, response.status, "terminal");
      throw new ResendDeliveryError("Resend returned an unreadable success", response.status);
    }
    const id = (parsed as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9._~-]{1,256}$/.test(id)) {
      logVerificationAttempt(operation, attempt, startedMs, response.status, "terminal");
      throw new ResendDeliveryError("Resend returned a malformed success", response.status);
    }
    logVerificationAttempt(operation, attempt, startedMs, response.status, "accepted");
    return;
  }

  throw lastError ?? new ResendDeliveryError("Resend request failed", 0);
}

// ---- Buddy Invite mails ------------------------------------------------------
//
// The welcome guide, the friend-joined notice and the one-off announcement
// (scripts/referral-announce.ts) all render here, so the three can never drift.
//
// Built for the clients the waitlist actually opens mail in (Gmail web/app,
// Naver, Outlook desktop/web, iOS Mail): presentation tables, inline styles on
// every element (Gmail and Naver drop or rewrite <style>), a bulletproof button
// whose coloured cell still shows when the link's padding is ignored (Outlook's
// Word engine), explicit background colours so auto dark modes keep contrast,
// no web font, no image, no flex or grid. Long links break anywhere so a phone
// never scrolls sideways.
//
// The welcome guide and the one-off announcement are promotional. The
// friend-joined notice is a status mail: verified count, tiers already
// reached, and a link to the invite status page. It does not carry the share
// call to action or the reward ladder. All three still carry the sender's
// identity and a working opt-out: the launch-mail /unsubscribe/<token>
// endpoint, which records `unsubscribed` in the row's `Launch mail` cell.
// Every later launch, reservation, Buddy Invite notice and announcement run
// treats that marker as final. For Korean readers (ko locale, or a KR signup
// country) the guide and the announcement take the "(광고)" subject prefix
// (정보통신망법 제50조, 시행령 별표6) and a Korean sender block with a phone
// number; without that number the mail is refused rather than sent. The
// status notice keeps that sender block and opt-out, and omits only the
// subject prefix. That omission is the 2026-10-27 local candidate for this
// one factual subject. It is not a finding that the notice is exempt.

const FONT_STACK =
  "'Pangram Sans','Spoqa Han Sans Neo','Helvetica Neue',Arial," +
  "'Apple SD Gothic Neo','Malgun Gothic','Hiragino Sans','Hiragino Kaku Gothic ProN'," +
  "'Microsoft YaHei','PingFang SC','PingFang TC',sans-serif";
const PAGE_BG = "#f5f3ee";
const REWARD_BG = "#ebe7f5";
const HIGHLIGHT_BG = "#ffe55c";
const CARD_BG = "#ffffff";
const INK = "#1a1238";
const BODY_INK = INK;
const MUTED_INK = "#3d2683";
const LINK_INK = "#3d2683";
// Surface Blue marks actions and tier badges; yellow is reserved for the
// event flag and share code. Explicit dark-mode rules preserve the ink pair.
export const BUTTON_BG = "#36A9E1";
export const BUTTON_INK = INK;

/** Env var holding the sender phone the Korean sender block must show. */
export const SENDER_PHONE_ENV = "WATCHDIVE_SENDER_PHONE";
/** Required first characters of a Korean advertising subject line. */
export const KR_AD_SUBJECT_PREFIX = "(광고) ";
export const KR_SENDER_ADDRESS =
  "Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom";
export const KR_OPT_OUT_LINE =
  "수신을 원하지 않으시면 수신거부를 눌러 주세요. If you do not wish to receive these emails, click Unsubscribe.";
const KR_OPT_OUT_LABEL = "수신거부 / Unsubscribe";
const SENDER_EMAIL = FIXED_SENDER_MAILBOX;

/** The Korean advertising rules apply to a Korean-language mail or a KR signup. */
export function koreanAdRulesApply(locale: Locale, signupCountry?: string): boolean {
  return locale === "ko" || (signupCountry ?? "").trim().toUpperCase() === "KR";
}

/** A plausible phone number from env, or undefined. Never invented. */
export function readSenderPhone(env: Record<string, string | undefined>): string | undefined {
  const value = (env[SENDER_PHONE_ENV] ?? "").trim();
  return /^\+?[0-9][0-9 ().-]{5,24}[0-9]$/.test(value) ? value : undefined;
}

export class AdComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdComplianceError";
  }
}

/** What every Buddy Invite mail needs to say about who sent it and how to stop it. */
export type AdFooter = {
  /** https one-click opt-out (launch-mail endpoint). */
  unsubscribeUrl: string;
  /** Korean advertising rules (see koreanAdRulesApply). */
  korean: boolean;
  /** Required when `korean`. */
  senderPhone?: string;
};

/**
 * Builds the footer for one recipient or throws, so a caller can never send a
 * Buddy Invite mail without a working https opt-out, or a Korean one without
 * the sender phone the law requires.
 */
export function buddyAdFooter(input: {
  locale: Locale;
  signupCountry?: string;
  unsubscribeUrl: string | undefined;
  env: Record<string, string | undefined>;
}): AdFooter {
  if (!input.unsubscribeUrl || !/^https:\/\/[^\s<>"]+$/.test(input.unsubscribeUrl)) {
    throw new AdComplianceError("Buddy Invite mail needs an https unsubscribe link");
  }
  const korean = koreanAdRulesApply(input.locale, input.signupCountry);
  if (!korean) return { unsubscribeUrl: input.unsubscribeUrl, korean };
  const senderPhone = readSenderPhone(input.env);
  if (!senderPhone) {
    throw new AdComplianceError(`${SENDER_PHONE_ENV} is required for Korean advertising mail`);
  }
  return { unsubscribeUrl: input.unsubscribeUrl, korean, senderPhone };
}

/** The signed launch-mail opt-out for one lead, or undefined when it cannot be signed. */
export function buddyUnsubscribeUrl(
  publicOrigin: string,
  leadId: string,
  locale: Locale,
  env: TokenEnvironment,
): string | undefined {
  if (!isLeadId(leadId)) return undefined;
  let secret: string;
  try {
    secret = requireSecret(env);
  } catch {
    return undefined;
  }
  return launchUnsubscribeUrl(publicOrigin, createUnsubscribeToken(leadId, locale, secret));
}

/** RFC 2369 + RFC 8058 headers: https one-click first, mailto as the fallback. */
export function buddyListUnsubscribeHeaders(
  unsubscribeUrl: string,
  mailto: string = SENDER_EMAIL,
): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${mailto}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function adSubject(
  subject: string,
  footer: AdFooter,
  kind: "marketing" | "status-notice" = "marketing",
): string {
  if (kind === "status-notice") return subject;
  return footer.korean ? `${KR_AD_SUBJECT_PREFIX}${subject}` : subject;
}

function wordBreakFor(locale: Locale): string {
  // Korean breaks between words, as on the landing and in the launch mail.
  return locale === "ko" ? "word-break:keep-all;" : "";
}

function para(style: string, content: string, locale: Locale): string {
  return (
    `<p style="margin:0;font-family:${FONT_STACK};${wordBreakFor(locale)}` +
    `overflow-wrap:break-word;${style}">${content}</p>`
  );
}

function linkHtml(url: string, label?: string): string {
  const safeUrl = escapeHtml(url);
  return (
    `<a href="${safeUrl}" rel="noreferrer noopener" style="color:${LINK_INK};` +
    `text-decoration:underline;word-break:${label === undefined ? "break-all" : "inherit"};overflow-wrap:anywhere;">` +
    `${label === undefined ? safeUrl : escapeHtml(label)}</a>`
  );
}

/**
 * A button that survives Outlook: the colour sits on the table cell, the link
 * fills it, and `mso-padding-alt` restores the padding Word ignores on <a>.
 */
function buttonHtml(url: string, label: string, tone: "primary" | "secondary" = "primary"): string {
  const primary = tone === "primary";
  const bg = primary ? BUTTON_BG : CARD_BG;
  const ink = primary ? BUTTON_INK : INK;
  const klass = primary ? "mail-accent mail-frame" : "mail-frame";
  const fill = primary ? `background-image:linear-gradient(${bg},${bg});` : "";
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;border-collapse:separate;">' +
    `<tr><td class="${klass}" align="center" bgcolor="${bg}" style="background-color:${bg};${fill}border:3px solid ${INK};mso-padding-alt:14px 18px;">` +
    `<a href="${escapeHtml(url)}" rel="noreferrer noopener" style="display:block;padding:14px 18px;` +
    `font-family:${FONT_STACK};font-size:16px;font-weight:700;line-height:22px;color:${ink};` +
    `text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`
  );
}

/** White plate so the cyan-and-black wordmark stays recognizable in dark mode. */
function logoHeader(): string {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;border-collapse:separate;table-layout:fixed;">' +
    `<tr><td class="mail-shadow" bgcolor="${INK}" style="background-color:${INK};padding:0 6px 6px 0;">` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>' +
    `<td class="mail-logo mail-frame" bgcolor="${CARD_BG}" style="border:3px solid ${INK};background-color:${CARD_BG};padding:34px!important;">${watchdiveLogoImg()}</td>` +
    "</tr></table></td></tr></table>"
  );
}

function labelledLinkHtml(label: string, url: string, locale: Locale): string {
  return para(
    `margin:0 0 14px;font-size:13px;line-height:1.6;color:${MUTED_INK};`,
    `${escapeHtml(label)}<br>${linkHtml(url)}`,
    locale,
  );
}

/** Sender identity and opt-out, as HTML rows and as plain-text lines. */
function footerParts(locale: Locale, footer: AdFooter): { html: string; text: string[] } {
  const launch = LAUNCH_COPY[locale];
  const small = `margin:0 0 8px;font-size:12px;line-height:1.6;color:${MUTED_INK};`;
  const html: string[] = [para(small, escapeHtml(launch.reason), locale)];
  const text: string[] = ["—", launch.reason];
  if (footer.korean) {
    const sender = `보내는 곳: ${RESERVATION_LEGAL_NAME} · ${SENDER_EMAIL} · ${footer.senderPhone} · ${KR_SENDER_ADDRESS}`;
    // The phone number stays on one line; a wrapped number reads as two.
    const phone = escapeHtml(footer.senderPhone ?? "");
    html.push(
      para(
        small,
        escapeHtml(sender).replace(phone, `<span style="white-space:nowrap;">${phone}</span>`),
        "ko",
      ),
      para(small, escapeHtml(KR_OPT_OUT_LINE), "ko"),
      para(small, linkHtml(footer.unsubscribeUrl, KR_OPT_OUT_LABEL), "ko"),
    );
    text.push(sender, KR_OPT_OUT_LINE, `${KR_OPT_OUT_LABEL}: ${footer.unsubscribeUrl}`);
  } else {
    const sender = `${RESERVATION_LEGAL_NAME} · ${RESERVATION_REGISTERED_OFFICE}`;
    const sep = LABEL_SEPARATOR[locale];
    html.push(
      para(small, linkHtml(footer.unsubscribeUrl, launch.page.confirmButton), locale),
      para(small, escapeHtml(sender), locale),
      para(small, escapeHtml(launch.help), locale),
    );
    text.push(
      `${launch.page.confirmButton}${sep}${footer.unsubscribeUrl}`,
      sender,
      launch.help,
    );
  }
  return { html: html.join(""), text };
}

/** The one document shell every Buddy Invite mail uses. */
function buddyDocument(input: {
  locale: Locale;
  subject: string;
  preheader: string;
  content: string;
  footer: AdFooter;
}): string {
  const { locale } = input;
  const foot = footerParts(locale, input.footer);
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(locale)}" dir="ltr">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<style>
    .mail-accent,.mail-highlight{color-scheme:only light;forced-color-adjust:none;}
    .mail-accent,.mail-accent *,.mail-highlight,.mail-highlight *{-webkit-text-fill-color:${INK}!important;}
    @media (prefers-color-scheme:dark){
      body,[bgcolor="${PAGE_BG}"]{background-color:#07131c!important;}
      [bgcolor="${CARD_BG}"],[bgcolor="${REWARD_BG}"]{background-color:${INK}!important;}
      [style*="color:${BODY_INK}"],[style*="color:${MUTED_INK}"]{color:#eef9ff!important;}
      a[style*="color:${LINK_INK}"]{color:#eef9ff!important;}
      .mail-frame{border-color:#eef9ff!important;}
      .mail-accent-rule{border-color:${BUTTON_BG}!important;}
      .mail-shadow{background-color:#eef9ff!important;}
      .mail-accent{background-color:${BUTTON_BG}!important;color:${INK}!important;}
      .mail-accent [style*="color:"]{color:${INK}!important;-webkit-text-fill-color:${INK}!important;}
      .mail-highlight{background-color:${HIGHLIGHT_BG}!important;color:${INK}!important;}
      .mail-highlight [style*="color:"]{color:${INK}!important;-webkit-text-fill-color:${INK}!important;}
      .mail-logo{background-color:#ffffff!important;}
    }</style>`,
    `<title>${escapeHtml(input.subject)}</title>`,
    // Outlook's Word engine falls back to Times for an unknown first font.
    "<!--[if mso]><style>body,table,td,p,a,h1,h2{font-family:Arial,sans-serif !important;}</style><![endif]-->",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;">`,
    // Inbox preview text. The trailing spacers keep the body from bleeding in.
    `<div style="display:none;font-size:1px;line-height:1px;color:${PAGE_BG};max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">` +
      `${escapeHtml(input.preheader)}${"&#8199;&#65279;&#847; ".repeat(12)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}" style="width:100%;background-color:${PAGE_BG};border-collapse:collapse;">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    '<!--[if mso]><table role="presentation" width="576" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:576px;border-collapse:separate;">',
    `<tr><td style="color:${BODY_INK};font-family:${FONT_STACK};">`,
    logoHeader(),
    input.content,
    "</td></tr>",
    `<tr><td style="padding:4px 12px 0;font-family:${FONT_STACK};">${foot.html}</td></tr>`,
    "</table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr></table>",
    "</body></html>",
  ].join("\n");
}

function headingHtml(text: string, locale: Locale): string {
  return (
    `<h1 style="margin:0 0 12px;font-family:${FONT_STACK};font-size:30px;line-height:1.18;` +
    `font-weight:700;color:${INK};${wordBreakFor(locale)}overflow-wrap:break-word;">${escapeHtml(text)}</h1>`
  );
}

const STYLE_BODY_P = `margin:0 0 20px;font-size:15px;line-height:1.6;color:${BODY_INK};`;

/** Compatibility projection of the shared event model for notice labels. */
export function referralRewardLines(locale: Locale): { name: string; reward: string }[] {
  const copy = buddyMailCopy(locale);
  return buddyMailEvent(locale).steps.map((step) => ({
    name: step.id === "top" ? fill(copy.top.name, copyValues(locale)) : copy.tiers[step.id].name,
    reward: step.benefit,
  }));
}

/** Hard offset made of table cells, so Word-based Outlook needs no box-shadow. */
function brutalPanel(content: string, locale: Locale): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;table-layout:fixed;"><tr>
<td class="mail-shadow" bgcolor="${INK}" style="background-color:${INK};padding:0 6px 6px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>
<td class="mail-frame" bgcolor="${CARD_BG}" style="border:3px solid ${INK};background-color:${CARD_BG};padding:20px 16px;color:${BODY_INK};font-family:${FONT_STACK};${wordBreakFor(locale)}overflow-wrap:break-word;">${content}</td>
</tr></table></td></tr><tr><td height="24" style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

function sectionHeading(label: string): string {
  return `<h2 class="mail-accent-rule" style="margin:0 0 18px;padding-bottom:10px;border-bottom:3px solid ${BUTTON_BG};font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(label)}</h2>`;
}

/** Inline table ladder and compact mail-only conditions; no CSS layout dependency. */
function eventRewardBlock(locale: Locale, rulesUrl: string, notice?: {
  credited: number; crossed: readonly string[];
}): { html: string; text: string } {
  const event = buddyMailEvent(locale, notice?.credited ?? null);
  const copy = buddyMailCopy(locale);
  const steps = notice
    ? event.steps.filter((step) => notice.crossed.includes(step.id) || step.next)
    : event.steps;
  const rows = steps.map((step) => {
    const reached = notice?.crossed.includes(step.id);
    const state = reached ? `✓ ${event.reached}` : notice && step.next ? `→ ${event.next}` : "";
    return `<tr><td style="padding:0 0 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>
<td class="mail-badge mail-accent mail-frame" width="70" align="center" valign="middle" bgcolor="${BUTTON_BG}" style="width:70px;padding:14px 2px;background-color:${BUTTON_BG};background-image:linear-gradient(${BUTTON_BG},${BUTTON_BG});border:3px solid ${INK};color:${INK};">
<span style="font-size:${step.id === "top" ? "20" : "38"}px;line-height:1.1;font-weight:700;color:${INK};white-space:nowrap;">${escapeHtml(step.badge)}${step.badgeUnit ? `<span style="font-size:22px;">${escapeHtml(step.badgeUnit)}</span>` : ""}</span>
<br><span style="font-size:10px;line-height:1.3;color:${INK};overflow-wrap:anywhere;">${escapeHtml(step.badgeCaption)}</span></td>
<td class="mail-frame" bgcolor="${REWARD_BG}" valign="middle" style="padding:12px 10px;background-color:${REWARD_BG};border:3px solid ${INK};color:${INK};">
<span style="font-size:12px;line-height:1.5;color:${MUTED_INK};">${escapeHtml(step.name)}</span><br>
<strong style="font-size:17px;line-height:1.35;color:${INK};">${escapeHtml(step.benefit)}</strong>
${step.qualifier ? `<br><span style="font-size:12px;line-height:1.6;color:${MUTED_INK};">${escapeHtml(step.qualifier)}</span>` : ""}
${state ? `<br><span style="font-size:12px;line-height:1.7;color:${MUTED_INK};font-weight:700;">${escapeHtml(state)}</span>` : ""}
</td></tr></table></td></tr>`;
  }).join("\n");
  const values = { ...copyValues(locale), count: REFERRAL_TIERS.find((tier) => tier.id === "leader")!.minFriends };
  const conditions = copy.mail.conditions.map((line) => fill(line, values));
  const html = brutalPanel([
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border-collapse:collapse;"><tr><td class="mail-highlight mail-frame" bgcolor="${HIGHLIGHT_BG}" style="padding:5px 10px;background-color:${HIGHLIGHT_BG};background-image:linear-gradient(${HIGHLIGHT_BG},${HIGHLIGHT_BG});border:3px solid ${INK};color:${INK};font-size:14px;line-height:1.5;font-weight:700;"><span style="color:${INK};">${escapeHtml(event.label)}</span></td></tr></table>`,
    `<h2 style="margin:0 0 10px;font-size:26px;line-height:1.2;font-weight:700;color:${INK};">${escapeHtml(event.headline)}</h2>`,
    para(`margin:0 0 20px;font-size:14px;line-height:1.6;color:${BODY_INK};`, escapeHtml(event.subline), locale),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>`,
    `<h3 class="mail-accent-rule" style="margin:16px 0 10px;padding-top:16px;border-top:3px solid ${BUTTON_BG};font-size:14px;line-height:1.5;font-weight:700;color:${INK};">${escapeHtml(event.conditionsTitle)}</h3>`,
    ...conditions.map((line) => para(`margin:0 0 10px;font-size:12px;line-height:1.65;color:${BODY_INK};`, escapeHtml(line), locale)),
    linkHtml(rulesUrl, copy.mail.welcomeRules),
  ].join("\n"), locale);
  const text = [event.label, event.headline, event.subline,
    ...steps.map((step) => `- ${step.badge}${step.badgeUnit} ${step.badgeCaption} → ${step.name}: ${step.benefit}${step.qualifier ? ` (${step.qualifier})` : ""}${notice?.crossed.includes(step.id) ? ` — ${event.reached}` : notice && step.next ? ` — ${event.next}` : ""}`),
    "", event.conditionsTitle, ...conditions, copy.mail.welcomeRules, rulesUrl].join("\n");
  return { html, text };
}

function validShareCode(code?: string): string {
  return code && /^[A-Z0-9]{4,12}$/.test(code) ? code : "";
}

function shareCodeHtml(code: string, label: string, locale: Locale): string {
  if (!code) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;table-layout:fixed;"><tr><td class="mail-highlight mail-frame" bgcolor="${HIGHLIGHT_BG}" style="border:3px solid ${INK};padding:16px 10px;background-color:${HIGHLIGHT_BG};background-image:linear-gradient(${HIGHLIGHT_BG},${HIGHLIGHT_BG});">` +
    para(`font-size:13px;line-height:1.6;color:${INK};`, escapeHtml(label), locale) +
    `<p style="margin:6px 0 0;font-family:Consolas,Menlo,monospace;font-size:26px;line-height:1.3;font-weight:700;letter-spacing:1px;color:${INK};word-break:break-all;">${escapeHtml(code)}</p></td></tr></table>`;
}

export type WelcomeLinks = { shareUrl: string; statusUrl: string; rulesUrl: string };

/**
 * The Buddy Invite guide: the welcome mail while the program is switched on,
 * and the one-off announcement to people who verified before the release. The
 * three sections confirm signup, explain the event, then provide sharing and
 * status links. The program-off welcome uses renderLegacyWelcomeMail.
 */
export function buddyGuideBody(
  links: WelcomeLinks,
  locale: Locale,
  footer: AdFooter,
  shareCode?: string,
): { subject: string; text: string; html: string } {
  const copy = buddyMailCopy(locale);
  const values = copyValues(locale);
  const mail = copy.mail;
  const t = (template: string) => fill(template, values);
  const event = eventRewardBlock(locale, links.rulesUrl);
  const subject = adSubject(t(mail.welcomeSubject), footer);
  const validCode = validShareCode(shareCode);
  const content = [
    brutalPanel(headingHtml(t(mail.welcomeHeading), locale) +
      para(STYLE_BODY_P.replace("20px", "0"), escapeHtml(t(mail.welcomeOutro)), locale), locale),
    event.html,
    brutalPanel([
      sectionHeading(mail.shareHeading),
      para(STYLE_BODY_P, escapeHtml(t(mail.welcomeIntro)), locale),
      buttonHtml(links.shareUrl, t(mail.welcomeButton)),
      labelledLinkHtml(t(mail.welcomeFallback), links.shareUrl, locale),
      shareCodeHtml(validCode, t(mail.welcomeCode), locale),
      labelledLinkHtml(t(mail.welcomeStatus), links.statusUrl, locale),
    ].join("\n"), locale),
  ].join("\n");
  return {
    subject,
    text: [
      t(mail.welcomeHeading), t(mail.welcomeOutro), "", event.text, "",
      mail.shareHeading, t(mail.welcomeIntro), t(mail.welcomeButton), links.shareUrl,
      ...(validCode ? ["", `${t(mail.welcomeCode)} ${validCode}`] : []),
      "", t(mail.welcomeStatus), links.statusUrl, "", ...footerParts(locale, footer).text,
    ].join("\n"),
    html: buddyDocument({ locale, subject, preheader: t(mail.welcomeOutro), content, footer }),
  };
}

/**
 * Friend-joined status notice. The subject is the verified count, with no
 * "(광고)" prefix. The body names only tiers already crossed and links to the
 * private status page. Share links, share codes, the reward ladder, and the
 * "invite more" lines stay in the guide and the announcement. The referrer is
 * still never told who joined (contract.ts). `shareUrl`, `shareCode`,
 * `nextTier` and `remainingToNext` are accepted so existing callers compile,
 * and they are not rendered. Korean sender identity and opt-out stay.
 */
export function referralNoticeBody(
  input: Pick<
    ReferralNoticeMail,
    "locale" | "credited" | "crossed" | "nextTier" | "remainingToNext" | "statusUrl" | "shareUrl" | "shareCode"
  >,
  footer: AdFooter,
): { subject: string; text: string; html: string } {
  const { locale } = input;
  const copy = buddyMailCopy(locale);
  const values = { ...copyValues(locale), count: input.credited };
  const mail = copy.mail;
  const heading = fill(mail.noticeHeading, values);
  const body = fill(mail.noticeBody, values);
  const noticeFooter = fill(mail.noticeFooter, values);
  const subject = adSubject(fill(mail.noticeSubject, values), footer, "status-notice");
  const crossed = new Set(input.crossed);
  const reachedLines = REFERRAL_TIERS.filter((tier) => crossed.has(tier.id)).map(
    (tier) => `${copy.event.reached}: ${fill(copy.tiers[tier.id].name, values)}`,
  );
  const statusLabel = fill(mail.noticeButton, values);
  const content = [
    brutalPanel(
      headingHtml(heading, locale) +
        para(STYLE_BODY_P, escapeHtml(body), locale) +
        reachedLines
          .map((line) =>
            para(
              `margin:0 0 8px;font-size:15px;line-height:1.6;color:${BODY_INK};`,
              escapeHtml(line),
              locale,
            ),
          )
          .join(""),
      locale,
    ),
    brutalPanel(
      [
        buttonHtml(input.statusUrl, statusLabel),
        para(`margin:0 0 14px;font-size:13px;line-height:1.6;`, linkHtml(input.statusUrl), locale),
        para(
          `margin:8px 0 0;font-size:13px;line-height:1.6;color:${MUTED_INK};`,
          escapeHtml(noticeFooter),
          locale,
        ),
      ].join("\n"),
      locale,
    ),
  ].join("\n");
  return {
    subject,
    text: [
      heading,
      "",
      body,
      ...reachedLines,
      "",
      statusLabel,
      input.statusUrl,
      "",
      noticeFooter,
      "",
      ...footerParts(locale, footer).text,
    ].join("\n"),
    html: buddyDocument({ locale, subject, preheader: body, content, footer }),
  };
}

export type DeliveryFailureReason =
  "unexpected_error" | "transport_error" | "invalid_provider_response" | "provider_rejected";

export type DeliveryFailureClass = { status: number | null; reason: DeliveryFailureReason };

/**
 * The only description of a failed send that may leave this module: an HTTP
 * status and one of four fixed reasons. Never the error message, which for an
 * unexpected error could carry anything, including the recipient address.
 */
export function classifyDeliveryFailure(error: unknown): DeliveryFailureClass {
  const status = error instanceof ResendDeliveryError ? error.status : null;
  const reason: DeliveryFailureReason =
    status === null
      ? "unexpected_error"
      : status === 0
        ? "transport_error"
        : status >= 200 && status < 300
          ? "invalid_provider_response"
          : "provider_rejected";
  return { status, reason };
}

// The service intentionally returns a generic response when delivery fails.
// Log once after retries are exhausted so those failures remain observable.
// Never log the payload, recipient, token, API key, or provider response body.
//
// Exported for the launch-mail job (src/lib/launchMail), which sends through
// this same path: same retries, same idempotency handling, same silence.
export async function deliver(
  config: ResendConfig,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  idempotencyKey: string,
  operation:
    | "verification"
    | "verification_reminder"
    | "welcome"
    | "referral_notice"
    | "referral_announce"
    | "launch_mail"
    | "reservation_mail",
  payload: Record<string, unknown>,
  policy?: DeliveryPolicy,
): Promise<void> {
  try {
    await deliverWithRetries(config, fetchImpl, sleep, idempotencyKey, payload, operation, policy);
  } catch (error) {
    const { status, reason } = classifyDeliveryFailure(error);
    console.error("[watchdive] email_delivery_failed", {
      provider: "resend",
      operation,
      status,
      reason,
    });
    throw error;
  }
}

const NATIVE_CONFIRMATION_KEY = /^watchdive-instant-form-[a-f0-9]{64}$/;

/** Native confirmation uses the ingester key. Every other send keeps the lead id. */
export function nativeConfirmationIdempotencyKey(override: string | undefined, leadId: string): string {
  if (override && NATIVE_CONFIRMATION_KEY.test(override)) return override;
  return `watchdive-verification-${leadId}`;
}

export function createResendMailer(
  env: ResendEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  policy: DeliveryPolicy = {},
): VerificationMailer {
  const config = readResendConfig(env);
  // Read once per mailer, from the same env as the Resend key, so the guide can
  // only go out where the operator turned the program on.
  const programOn = referralProgramEnabled(env);

  return {
    async send({ to, token, leadId, publicOrigin, locale, reminder, manualCampaign, compatibility, idempotencyKey: idempotencyOverride }) {
      const signedLocale = verificationTokenLocale(token);
      if (!signedLocale || signedLocale !== locale) {
        throw new Error("Verification token locale mismatch");
      }
      const url = verificationUrl(publicOrigin, token);
      const content = reminder ? buildReminderEmail(url, signedLocale) : body(url, signedLocale, compatibility);
      // Ties every retry of one attempt to one message. A new attempt mints a
      // new lead id, so a resend is a genuinely new key. The reminder reuses
      // the attempt's lead id, so it gets its own namespace — one key per
      // attempt, which also makes a duplicated reminder collapse at Resend.
      const idempotencyKey = manualCampaign === "wd-manual-verify-20261019" || manualCampaign === "wd-verification-recovery-20261031"
        ? `${manualCampaign}-${leadId}`
        : reminder
        ? `watchdive-verification-reminder-${leadId}`
        : nativeConfirmationIdempotencyKey(idempotencyOverride, leadId);
      await deliver(
        config,
        fetchImpl,
        sleep,
        idempotencyKey,
        reminder ? "verification_reminder" : "verification",
        {
          to: [to],
          subject: content.subject,
          text: content.text,
          html: content.html,
        },
        reminder ? undefined : policy,
      );
    },

    async sendWelcome({
      shareCode,
      to,
      refCode,
      leadId,
      publicOrigin,
      scheduledAt,
      locale,
      statusUrl,
      rulesUrl,
      signupCountry,
    }) {
      // The key is the same for both bodies, so one lead still gets one mail.
      // Keyed on the lead, not the moment: two confirmations that race, or a
      // retry from a later click, all collapse onto one scheduled message.
      const idempotencyKey = `watchdive-welcome-${leadId}`;
      if (!(programOn && statusUrl && rulesUrl)) {
        // Off, or missing either link: the legacy welcome, byte for byte.
        const content = welcomeBody(referralUrl(publicOrigin, refCode, locale), locale);
        await deliver(config, fetchImpl, sleep, idempotencyKey, "welcome", {
          to: [to],
          subject: content.subject,
          text: content.text,
          html: content.html,
          scheduled_at: scheduledAt,
          // This message is closer to marketing than the confirmation is, so it
          // carries a working opt-out that needs no new endpoint.
          headers: {
            "List-Unsubscribe": listUnsubscribe(config),
          },
        });
        return;
      }
      // The guide is promotional: it refuses (throws, nothing sent) without an
      // https opt-out, or without the sender phone a Korean reader must see.
      // scheduleWelcome then leaves `Welcome email` empty for a later retry.
      const unsubscribeUrl = buddyUnsubscribeUrl(publicOrigin, leadId, locale, env);
      const footer = buddyAdFooter({ locale, signupCountry, unsubscribeUrl, env });
      // The share link is the unprefixed /r/<code> (core `shareUrl`): the
      // friend's own language picks the page, and the status page, the
      // announcement and this guide all hand out the same link.
      const content = buddyGuideBody(
        { shareUrl: referralUrl(publicOrigin, refCode), statusUrl, rulesUrl },
        locale,
        footer,
        shareCode,
      );
      await deliver(config, fetchImpl, sleep, idempotencyKey, "welcome", {
        to: [to],
        subject: content.subject,
        text: content.text,
        html: content.html,
        scheduled_at: scheduledAt,
        headers: buddyListUnsubscribeHeaders(footer.unsubscribeUrl, mailtoAddress(config)),
      });
    },
  };
}

function mailtoAddress(config: ResendConfig): string {
  return config.replyTo || FIXED_SENDER_MAILBOX;
}

/** A Resend header value only ever carries this fixed opt-out address shape. */
function listUnsubscribe(config: ResendConfig): string {
  return `<mailto:${mailtoAddress(config)}?subject=unsubscribe>`;
}

/**
 * Friend-joined notices go through the same `deliver` path as every other
 * mail: same retries, same idempotency handling, same silent failure logging,
 * under their own operation label. The caller supplies the idempotency key
 * (`${REFERRAL_PROGRAM_ID}-notice-${refCode}-${credited}`), so a notice whose
 * Notion bookkeeping failed collapses at Resend when the next tick retries it.
 */
export function createResendReferralMailer(
  env: ResendEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): ReferralMailer {
  const config = readResendConfig(env);
  const programOn = referralProgramEnabled(env);
  return {
    async sendReferralNotice(input) {
      // Second lock behind runReferralNotices: with the master switch off this
      // mailer cannot send a notice even if a caller forgets the gate.
      if (!programOn) throw new Error("Buddy Invite is switched off");
      // Refuses (throws, nothing sent) without an https opt-out or, for a
      // Korean reader, without the sender phone.
      const footer = buddyAdFooter({
        locale: input.locale,
        signupCountry: input.signupCountry,
        unsubscribeUrl: input.unsubscribeUrl,
        env,
      });
      const content = referralNoticeBody(input, footer);
      await deliver(config, fetchImpl, sleep, input.idempotencyKey, "referral_notice", {
        to: [input.to],
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: buddyListUnsubscribeHeaders(footer.unsubscribeUrl, mailtoAddress(config)),
      });
    },
  };
}
