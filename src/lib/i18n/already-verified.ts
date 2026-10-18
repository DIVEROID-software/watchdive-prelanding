import type { Locale } from "./locale.ts";

export const alreadyVerifiedCopy: Record<Locale, { title: string; body: string; other: string }> = {
  ko: { title: "이미 인증된 이메일입니다", body: "출시 알림 신청이 완료되어 있습니다. 인증 메일은 다시 발송되지 않습니다.", other: "다른 이메일로 신청하기" },
  en: { title: "This email is already verified", body: "You’re already signed up for launch updates. We won’t send another verification email.", other: "Use another email" },
  ja: { title: "このメールアドレスは認証済みです", body: "発売のお知らせへの登録は完了しています。認証メールは再送されません。", other: "別のメールアドレスで登録" },
  "zh-CN": { title: "此邮箱已完成验证", body: "您已成功订阅上市通知。我们不会再次发送验证邮件。", other: "使用其他邮箱" },
  "zh-TW": { title: "此信箱已完成驗證", body: "您已成功訂閱上市通知。我們不會再次寄送驗證郵件。", other: "使用其他信箱" },
  es: { title: "Este correo ya está verificado", body: "Ya estás en la lista de novedades del lanzamiento. No enviaremos otro correo de verificación.", other: "Usar otro correo" },
  fr: { title: "Cette adresse e-mail est déjà vérifiée", body: "Vous êtes déjà inscrit aux actualités du lancement. Aucun nouvel e-mail de vérification ne sera envoyé.", other: "Utiliser une autre adresse" },
  de: { title: "Diese E-Mail-Adresse ist bereits bestätigt", body: "Du bist bereits für Neuigkeiten zum Start angemeldet. Wir senden keine weitere Bestätigungs-E-Mail.", other: "Andere E-Mail-Adresse verwenden" },
  "pt-BR": { title: "Este e-mail já foi verificado", body: "Você já está inscrito para receber novidades do lançamento. Não enviaremos outro e-mail de verificação.", other: "Usar outro e-mail" },
};
