// Direct Resend HTTP client. No SDK, so nothing can drag an API key into a
// client bundle: this module is only ever reached from a server function.
//
// Delivery is one transactional message to one recipient. It is never batched,
// never a campaign, and carries no list state.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { verificationTokenLocale, verificationUrl } from "./token.ts";
import { DEFAULT_LOCALE, referralPath, type Locale } from "../i18n/locale.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

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
  WATCHDIVE_EMAIL_FROM?: string;
  WATCHDIVE_EMAIL_REPLY_TO?: string;
};

export type ResendConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

export type VerificationMail = {
  to: string;
  token: string;
  leadId: string;
  publicOrigin: string;
  locale: Locale;
};

export type WelcomeMail = {
  to: string;
  refCode: string;
  leadId: string;
  publicOrigin: string;
  /** ISO 8601 instant. Resend holds the message until then, up to 30 days out. */
  scheduledAt: string;
  locale: Locale;
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

export function readResendConfig(env: ResendEnvironment = process.env): ResendConfig {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const from = (env.WATCHDIVE_EMAIL_FROM ?? "").trim();
  if (!from) throw new Error("WATCHDIVE_EMAIL_FROM is not set");
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
// Price, discount, product performance and referral rewards are still
// unconfirmed in docs/01-product-truth.md, so none is introduced in any
// language. Copy is reviewed again through the independent native-tone gate
// before release.
const EMAIL_COPY = {
  en: {
    verification: {
      subject: "Confirm your Watch Dive waitlist email",
      heading: "Confirm your Watch Dive waitlist email",
      intro:
        "Open the link below to confirm the email address for your Watch Dive pre-launch updates.",
      button: "Confirm my email",
      fallback: "If the button does not work, paste this link into your browser:",
      expires: "The link expires in 24 hours.",
      ignore: "If you did not request this, ignore this email. Nothing will happen.",
    },
    welcome: {
      subject: "You’re on the Watch Dive waitlist",
      heading: "You’re on the Watch Dive waitlist",
      intro:
        "Your email is confirmed. Here is your personal invite link. Share it with fellow divers.",
      button: "Open my invite link",
      fallback: "Or copy this link:",
      outro: "We will email you when Watch Dive goes live on Kickstarter.",
    },
  },
  ko: {
    verification: {
      subject: "Watch Dive 대기 명단 이메일을 인증해 주세요",
      heading: "이메일을 인증해 주세요",
      intro: "아래 링크를 열어 Watch Dive 출시 전 소식을 받을 이메일 주소를 인증해 주세요.",
      button: "이메일 인증하기",
      fallback: "버튼이 열리지 않으면 아래 링크를 브라우저에 붙여 넣어 주세요:",
      expires: "이 링크는 24시간 후 만료됩니다.",
      ignore: "직접 요청한 적이 없다면 이 메일을 무시해 주세요. 별도의 처리는 이루어지지 않습니다.",
    },
    welcome: {
      subject: "Watch Dive 대기 명단 등록이 완료되었습니다",
      heading: "Watch Dive 대기 명단 등록이 완료되었습니다",
      intro:
        "이메일 인증이 완료되었습니다. 아래 개인 초대 링크를 다이빙에 관심 있는 분들과 공유해 주세요.",
      button: "내 초대 링크 열기",
      fallback: "링크를 직접 복사하려면:",
      outro: "Watch Dive가 Kickstarter에 공개되면 이메일로 알려드리겠습니다.",
    },
  },
  "zh-CN": {
    verification: {
      subject: "请确认您的 Watch Dive 候补名单邮箱",
      heading: "确认您的邮箱",
      intro: "请打开下方链接，确认用于接收 Watch Dive 上线前消息的邮箱地址。",
      button: "确认邮箱",
      fallback: "如果按钮无法打开，请将以下链接复制到浏览器：",
      expires: "此链接将在 24 小时后失效。",
      ignore: "如果不是您本人提交的申请，请忽略这封邮件，我们不会进行任何操作。",
    },
    welcome: {
      subject: "您已加入 Watch Dive 候补名单",
      heading: "您已加入 Watch Dive 候补名单",
      intro: "邮箱已确认。下面是您的专属邀请链接，可以分享给同样热爱潜水的朋友。",
      button: "打开我的邀请链接",
      fallback: "也可以复制此链接：",
      outro: "Watch Dive 在 Kickstarter 上线时，我们会通过邮件通知您。",
    },
  },
  "zh-TW": {
    verification: {
      subject: "請確認您的 Watch Dive 等候名單電子郵件",
      heading: "確認您的電子郵件",
      intro: "請開啟下方連結，確認用來接收 Watch Dive 上線前消息的電子郵件地址。",
      button: "確認電子郵件",
      fallback: "如果按鈕無法開啟，請將下方連結貼到瀏覽器：",
      expires: "此連結將在 24 小時後失效。",
      ignore: "如果不是您本人提出申請，請忽略這封信，我們不會進行任何動作。",
    },
    welcome: {
      subject: "您已加入 Watch Dive 等候名單",
      heading: "您已加入 Watch Dive 等候名單",
      intro: "電子郵件已確認。下方是您的專屬邀請連結，歡迎分享給同樣喜歡潛水的朋友。",
      button: "開啟我的邀請連結",
      fallback: "也可以複製此連結：",
      outro: "Watch Dive 在 Kickstarter 上線時，我們會寄信通知您。",
    },
  },
  ja: {
    verification: {
      subject: "Watch Diveウェイトリストのメールアドレスをご確認ください",
      heading: "メールアドレスを確認してください",
      intro:
        "下のリンクを開き、Watch Diveのローンチ前情報を受け取るメールアドレスを確認してください。",
      button: "メールアドレスを確認",
      fallback: "ボタンが開かない場合は、次のリンクをブラウザに貼り付けてください：",
      expires: "このリンクの有効期限は24時間です。",
      ignore: "このメールに心当たりがない場合は、そのまま破棄してください。手続きは行われません。",
    },
    welcome: {
      subject: "Watch Diveウェイトリストへの登録が完了しました",
      heading: "Watch Diveウェイトリストへの登録が完了しました",
      intro:
        "メールアドレスの確認が完了しました。あなた専用の招待リンクを、ダイビング仲間にシェアできます。",
      button: "招待リンクを開く",
      fallback: "リンクをコピーする場合：",
      outro: "Watch DiveがKickstarterで公開される際に、メールでお知らせします。",
    },
  },
  es: {
    verification: {
      subject: "Confirma tu correo para la lista de espera de Watch Dive",
      heading: "Confirma tu correo",
      intro:
        "Abre el enlace de abajo para confirmar la dirección en la que quieres recibir novedades de prelanzamiento de Watch Dive.",
      button: "Confirmar mi correo",
      fallback: "Si el botón no funciona, pega este enlace en tu navegador:",
      expires: "El enlace caduca en 24 horas.",
      ignore: "Si no hiciste esta solicitud, ignora el mensaje. No se realizará ninguna acción.",
    },
    welcome: {
      subject: "Ya estás en la lista de espera de Watch Dive",
      heading: "Ya estás en la lista de espera de Watch Dive",
      intro:
        "Tu correo está confirmado. Este es tu enlace de invitación personal; puedes compartirlo con otras personas que bucean.",
      button: "Abrir mi enlace de invitación",
      fallback: "También puedes copiar este enlace:",
      outro: "Te avisaremos por correo cuando Watch Dive se publique en Kickstarter.",
    },
  },
  fr: {
    verification: {
      subject: "Confirmez votre adresse e-mail pour la liste d’attente Watch Dive",
      heading: "Confirmez votre adresse e-mail",
      intro:
        "Ouvrez le lien ci-dessous pour confirmer l’adresse à laquelle vous souhaitez recevoir les actualités de pré-lancement de Watch Dive.",
      button: "Confirmer mon adresse",
      fallback: "Si le bouton ne fonctionne pas, collez ce lien dans votre navigateur :",
      expires: "Ce lien expire dans 24 heures.",
      ignore:
        "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail. Aucune action ne sera effectuée.",
    },
    welcome: {
      subject: "Vous êtes sur la liste d’attente Watch Dive",
      heading: "Vous êtes sur la liste d’attente Watch Dive",
      intro:
        "Votre adresse e-mail est confirmée. Voici votre lien d’invitation personnel, à partager avec d’autres plongeurs.",
      button: "Ouvrir mon lien d’invitation",
      fallback: "Vous pouvez aussi copier ce lien :",
      outro: "Nous vous préviendrons par e-mail lorsque Watch Dive sera lancé sur Kickstarter.",
    },
  },
  de: {
    verification: {
      subject: "Bestätige deine E-Mail für die Watch-Dive-Warteliste",
      heading: "Bestätige deine E-Mail-Adresse",
      intro:
        "Öffne den folgenden Link, um die E-Mail-Adresse für Updates vor dem Start von Watch Dive zu bestätigen.",
      button: "E-Mail-Adresse bestätigen",
      fallback: "Falls der Button nicht funktioniert, füge diesen Link in deinen Browser ein:",
      expires: "Der Link ist 24 Stunden lang gültig.",
      ignore:
        "Falls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail. Es wird nichts weiter veranlasst.",
    },
    welcome: {
      subject: "Du bist auf der Watch-Dive-Warteliste",
      heading: "Du bist auf der Watch-Dive-Warteliste",
      intro:
        "Deine E-Mail-Adresse ist bestätigt. Hier ist dein persönlicher Einladungslink zum Teilen mit anderen Tauchern.",
      button: "Meinen Einladungslink öffnen",
      fallback: "Oder kopiere diesen Link:",
      outro: "Wir informieren dich per E-Mail, sobald Watch Dive auf Kickstarter startet.",
    },
  },
  "pt-BR": {
    verification: {
      subject: "Confirme seu e-mail para a lista de espera do Watch Dive",
      heading: "Confirme seu e-mail",
      intro:
        "Abra o link abaixo para confirmar o endereço em que deseja receber novidades de pré-lançamento do Watch Dive.",
      button: "Confirmar meu e-mail",
      fallback: "Se o botão não funcionar, cole este link no navegador:",
      expires: "O link expira em 24 horas.",
      ignore: "Se você não fez essa solicitação, ignore este e-mail. Nenhuma ação será realizada.",
    },
    welcome: {
      subject: "Você está na lista de espera do Watch Dive",
      heading: "Você está na lista de espera do Watch Dive",
      intro:
        "Seu e-mail foi confirmado. Este é o seu link de convite pessoal; compartilhe com outras pessoas que mergulham.",
      button: "Abrir meu link de convite",
      fallback: "Você também pode copiar este link:",
      outro: "Vamos avisar por e-mail quando o Watch Dive entrar no ar no Kickstarter.",
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

function body(url: string, locale: Locale): { subject: string; text: string; html: string } {
  const safeUrl = escapeHtml(url);
  const copy = EMAIL_COPY[locale].verification;
  return {
    text: [copy.heading, "", copy.intro, url, "", copy.expires, copy.ignore].join("\n"),
    html: [
      `<div lang="${locale}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">`,
      `<h1 style="font-size:20px;margin:0 0 12px">${copy.heading}</h1>`,
      '<p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 24px">',
      copy.intro,
      "</p>",
      `<p style="margin:0 0 24px"><a href="${safeUrl}" rel="noreferrer noopener" `,
      'style="display:inline-block;background:#0ea5e9;color:#04121f;font-weight:600;',
      'font-size:16px;padding:14px 28px;border-radius:12px;text-decoration:none">',
      `${copy.button}</a></p>`,
      '<p style="font-size:13px;line-height:1.6;color:#64748b;margin:0 0 8px">',
      `${copy.fallback}<br>`,
      `<span style="word-break:break-all">${safeUrl}</span>`,
      "</p>",
      '<p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">',
      `${copy.expires} `,
      copy.ignore,
      "</p>",
      "</div>",
    ].join(""),
    subject: copy.subject,
  };
}

// Copy stays as neutral as the confirmation mail. The referral reward is still
// unapproved in `docs/01-product-truth.md`, so this hands over the link and
// says nothing about what sharing it earns.
function welcomeBody(url: string, locale: Locale): { subject: string; text: string; html: string } {
  const safeUrl = escapeHtml(url);
  const copy = EMAIL_COPY[locale].welcome;
  return {
    text: [copy.heading, "", copy.intro, url, "", copy.outro].join("\n"),
    html: [
      `<div lang="${locale}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">`,
      `<h1 style="font-size:20px;margin:0 0 12px">${copy.heading}</h1>`,
      '<p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 24px">',
      copy.intro,
      "</p>",
      `<p style="margin:0 0 24px"><a href="${safeUrl}" rel="noreferrer noopener" `,
      'style="display:inline-block;background:#0ea5e9;color:#04121f;font-weight:600;',
      'font-size:16px;padding:14px 28px;border-radius:12px;text-decoration:none">',
      `${copy.button}</a></p>`,
      '<p style="font-size:13px;line-height:1.6;color:#64748b;margin:0 0 8px">',
      `${copy.fallback}<br>`,
      `<span style="word-break:break-all">${safeUrl}</span>`,
      "</p>",
      '<p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">',
      copy.outro,
      "</p>",
      "</div>",
    ].join(""),
    subject: copy.subject,
  };
}

/**
 * One accepted send, or a throw. Retries reuse the same idempotency key and the
 * byte-identical payload, so a retry can never become a second message.
 */
async function deliver(
  config: ResendConfig,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const serialized = JSON.stringify({
    from: config.from,
    ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    ...payload,
  });
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
        await sleep(200 * attempt);
        continue;
      }
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
        await sleep(200 * attempt);
        continue;
      }
      throw error;
    }

    // A 2xx without a usable message id is not an accepted send. Trusting
    // it would let the flow report a delivery that may never have happened.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ResendDeliveryError("Resend returned an unreadable success", response.status);
    }
    const id = (parsed as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9._~-]{1,256}$/.test(id)) {
      throw new ResendDeliveryError("Resend returned a malformed success", response.status);
    }
    return;
  }

  throw lastError ?? new ResendDeliveryError("Resend request failed", 0);
}

export function createResendMailer(
  env: ResendEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): VerificationMailer {
  const config = readResendConfig(env);

  return {
    async send({ to, token, leadId, publicOrigin, locale }) {
      const signedLocale = verificationTokenLocale(token);
      if (!signedLocale || signedLocale !== locale) {
        throw new Error("Verification token locale mismatch");
      }
      const content = body(verificationUrl(publicOrigin, token), signedLocale);
      // Ties every retry of one attempt to one message. A new attempt mints a
      // new lead id, so a resend is a genuinely new key.
      await deliver(config, fetchImpl, sleep, `watchdive-verification-${leadId}`, {
        to: [to],
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
    },

    async sendWelcome({ to, refCode, leadId, publicOrigin, scheduledAt, locale }) {
      const content = welcomeBody(referralUrl(publicOrigin, refCode, locale), locale);
      // Keyed on the lead, not the moment: two confirmations that race, or a
      // retry from a later click, all collapse onto one scheduled message.
      await deliver(config, fetchImpl, sleep, `watchdive-welcome-${leadId}`, {
        to: [to],
        subject: content.subject,
        text: content.text,
        html: content.html,
        scheduled_at: scheduledAt,
        // This message is closer to marketing than the confirmation is, so it
        // carries a working opt-out that needs no new endpoint.
        headers: {
          "List-Unsubscribe": `<mailto:${config.replyTo || "help@diveroid.com"}?subject=unsubscribe>`,
        },
      });
    },
  };
}
