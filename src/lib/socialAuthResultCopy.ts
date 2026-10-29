import type { Locale } from "./i18n/locale.ts";

/** Finish states the callback may put in `?auth=`. */
export type SocialAuthResultKind = "confirmed" | "check-email" | "pending" | "error" | "open-browser";

const RESULT: Record<Locale, Record<SocialAuthResultKind, string>> = {
  en: {
    confirmed: "You're signed up for WatchDive launch updates.",
    "check-email": "If this address can receive email, a confirmation link is on its way.",
    pending: "Apple saved a hidden address and we have not confirmed it. No confirmation message was sent. Use the email form on this page.",
    error: "That sign-in did not finish. You can use the email form on this page.",
    "open-browser": "Google sign-in does not run in this browser. Open this page yourself in Safari or Chrome. You can continue with email on this page.",
  },
  ko: {
    confirmed: "WatchDive 출시 알림 신청이 완료되었습니다.",
    "check-email": "이 주소로 메일을 받을 수 있다면 확인 링크가 발송됩니다.",
    pending: "Apple이 숨긴 주소는 저장되었지만 아직 확인되지 않았습니다. 확인 메일은 보내지 않았습니다. 이 페이지의 이메일 양식을 사용하세요.",
    error: "로그인이 끝나지 않았습니다. 이 페이지의 이메일 양식을 사용할 수 있습니다.",
    "open-browser": "Google 로그인은 이 브라우저에서 실행되지 않습니다. 이 페이지를 Safari 또는 Chrome에서 직접 여세요. 이메일로도 계속할 수 있습니다.",
  },
  "zh-CN": {
    confirmed: "WatchDive 上线通知订阅已完成。",
    "check-email": "如果这个地址可以收信，确认链接正在寄出。",
    pending: "已保存 Apple 隐藏的地址，但尚未确认。没有发送确认邮件。请使用本页的电子邮件表单。",
    error: "这次登录没有完成。你可以使用本页的电子邮件表单。",
    "open-browser": "Google 登录无法在此浏览器中运行。请自行用 Safari 或 Chrome 打开此页面。你也可以使用电子邮件继续。",
  },
  "zh-TW": {
    confirmed: "WatchDive 上線通知訂閱已完成。",
    "check-email": "如果這個地址可以收信，確認連結正在寄出。",
    pending: "已儲存 Apple 隱藏的地址，但尚未確認。沒有寄出確認信。請使用本頁的電子郵件表單。",
    error: "這次登入沒有完成。你可以使用本頁的電子郵件表單。",
    "open-browser": "Google 登入無法在此瀏覽器中執行。請自行用 Safari 或 Chrome 開啟此頁面。你也可以使用電子郵件繼續。",
  },
  ja: {
    confirmed: "WatchDiveの発売通知の登録が完了しました。",
    "check-email": "このアドレスで受信できる場合、確認リンクが届きます。",
    pending: "Appleが隠したアドレスは保存されましたが、まだ確認されていません。確認メールは送っていません。このページのメール欄を使ってください。",
    error: "ログインは完了しませんでした。このページのメール欄を使えます。",
    "open-browser": "Googleログインはこのブラウザでは動作しません。このページをSafariまたはChromeでご自身で開いてください。メールでも続けられます。",
  },
  es: {
    confirmed: "Tu suscripción a los avisos de lanzamiento de WatchDive está confirmada.",
    "check-email": "Si esta dirección puede recibir correo, el enlace de confirmación está en camino.",
    pending: "Apple guardó una dirección oculta y todavía no la confirmamos. No enviamos un mensaje de confirmación. Usa el formulario de correo de esta página.",
    error: "Ese inicio de sesión no terminó. Puedes usar el formulario de correo de esta página.",
    "open-browser": "El inicio de sesión de Google no funciona en este navegador. Abre esta página tú mismo en Safari o Chrome. También puedes continuar con el correo.",
  },
  fr: {
    confirmed: "Votre inscription aux annonces du lancement de WatchDive est confirmée.",
    "check-email": "Si cette adresse peut recevoir des messages, un lien de confirmation est en route.",
    pending: "Apple a enregistré une adresse masquée et nous ne l’avons pas confirmée. Aucun message de confirmation n’a été envoyé. Utilisez le formulaire e-mail de cette page.",
    error: "Cette connexion ne s’est pas terminée. Vous pouvez utiliser le formulaire e-mail de cette page.",
    "open-browser": "La connexion Google ne fonctionne pas dans ce navigateur. Ouvrez vous-même cette page dans Safari ou Chrome. Vous pouvez aussi continuer avec l’e-mail.",
  },
  de: {
    confirmed: "Du bist für die Launch-Benachrichtigungen von WatchDive angemeldet.",
    "check-email": "Wenn diese Adresse E-Mails empfangen kann, ist ein Bestätigungslink unterwegs.",
    pending: "Apple hat eine verdeckte Adresse gespeichert, und wir haben sie nicht bestätigt. Es wurde keine Bestätigungsnachricht gesendet. Nutze das E-Mail-Formular auf dieser Seite.",
    error: "Diese Anmeldung wurde nicht abgeschlossen. Du kannst das E-Mail-Formular auf dieser Seite nutzen.",
    "open-browser": "Die Google-Anmeldung funktioniert in diesem Browser nicht. Öffne diese Seite selbst in Safari oder Chrome. Du kannst hier auch mit E-Mail weitermachen.",
  },
  "pt-BR": {
    confirmed: "Sua inscrição para receber os avisos de lançamento do WatchDive está confirmada.",
    "check-email": "Se este endereço puder receber e-mail, um link de confirmação está a caminho.",
    pending: "A Apple guardou um endereço oculto e nós não o confirmamos. Nenhuma mensagem de confirmação foi enviada. Use o formulário de e-mail desta página.",
    error: "Esse login não terminou. Você pode usar o formulário de e-mail desta página.",
    "open-browser": "O login do Google não funciona neste navegador. Abra esta página você mesmo no Safari ou no Chrome. Você também pode continuar com o e-mail.",
  },
  nl: {
    confirmed: "Je bent aangemeld voor lanceringsupdates van WatchDive.",
    "check-email": "Als dit adres e-mail kan ontvangen, is er een bevestigingslink onderweg.",
    pending: "Apple heeft een verborgen adres bewaard en we hebben het niet bevestigd. Er is geen bevestigingsbericht gestuurd. Gebruik het e-mailformulier op deze pagina.",
    error: "Die aanmelding is niet afgerond. Je kunt het e-mailformulier op deze pagina gebruiken.",
    "open-browser": "Inloggen met Google werkt niet in deze browser. Open deze pagina zelf in Safari of Chrome. Je kunt op deze pagina doorgaan met e-mail.",
  },
};

export function socialAuthResultCopy(locale: Locale): Record<SocialAuthResultKind, string> {
  return RESULT[locale];
}
