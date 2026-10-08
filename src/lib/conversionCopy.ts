import type { Locale } from "./i18n/locale.ts";

type Copy = {
  cta: string;
  benefit: string;
  terms: string;
  reassurance: string;
  confirmation: string;
  compatibility: string;
};
export const conversionCopy: Record<Locale, Copy> = {
  en: {
    cta: "Get the launch alert",
    benefit: "Get notified when the $149 early-bird offer opens.",
    terms: "For the first 100 Kickstarter backers. Signing up does not reserve the offer.",
    reassurance: "Free signup · No payment now",
    confirmation: "Confirm your email using the link we send you.",
    compatibility: "Check your watch compatibility",
  },
  ko: {
    cta: "출시 알림 받기",
    benefit: "$149 얼리버드 혜택이 열리면 알려드려요.",
    terms: "Kickstarter 선착순 후원자 100명 한정. 알림 신청으로 혜택이 예약되지는 않습니다.",
    reassurance: "무료 신청 · 지금 결제 없음",
    confirmation: "보내드리는 메일의 링크를 눌러 이메일을 인증해주세요.",
    compatibility: "내 워치 호환성 확인",
  },
  "zh-CN": {
    cta: "接收上线提醒",
    benefit: "$149 早鸟优惠开放时通知您。",
    terms: "限 Kickstarter 前 100 位支持者。报名不代表预留优惠。",
    reassurance: "免费报名 · 现在无需付款",
    confirmation: "请点击我们发送的邮件链接，确认您的邮箱。",
    compatibility: "查看手表兼容性",
  },
  "zh-TW": {
    cta: "接收上線提醒",
    benefit: "$149 早鳥優惠開放時通知您。",
    terms: "限 Kickstarter 前 100 位支持者。報名不代表保留優惠。",
    reassurance: "免費報名 · 現在無需付款",
    confirmation: "請點擊我們寄送的郵件連結，確認您的信箱。",
    compatibility: "查看手錶相容性",
  },
  ja: {
    cta: "公開のお知らせを受け取る",
    benefit: "$149の早期特典が始まったらお知らせします。",
    terms: "Kickstarterの先着100名の支援者限定。登録だけでは特典は確保されません。",
    reassurance: "登録無料 · 今のお支払いは不要",
    confirmation: "届いたメールのリンクからメールアドレスを確認してください。",
    compatibility: "対応するウォッチを確認",
  },
  es: {
    cta: "Avisadme del lanzamiento",
    benefit: "Te avisamos cuando se abra la oferta de lanzamiento de $149.",
    terms: "Para los primeros 100 patrocinadores en Kickstarter. Registrarte no reserva la oferta.",
    reassurance: "Registro gratis · Sin pago ahora",
    confirmation: "Confirma tu correo con el enlace que te enviaremos.",
    compatibility: "Comprueba si tu reloj es compatible",
  },
  fr: {
    cta: "Recevoir l’alerte de lancement",
    benefit: "Soyez averti dès l’ouverture de l’offre de lancement à 149 $.",
    terms:
      "Pour les 100 premiers contributeurs sur Kickstarter. L’inscription ne réserve pas l’offre.",
    reassurance: "Inscription gratuite · Aucun paiement maintenant",
    confirmation: "Confirmez votre adresse grâce au lien envoyé par e-mail.",
    compatibility: "Vérifier la compatibilité de ma montre",
  },
  de: {
    cta: "Zum Start benachrichtigen",
    benefit: "Erfahre, wann das Early-Bird-Angebot für 149 $ startet.",
    terms:
      "Für die ersten 100 Unterstützer auf Kickstarter. Die Anmeldung reserviert das Angebot nicht.",
    reassurance: "Kostenlos anmelden · Jetzt nichts bezahlen",
    confirmation: "Bestätige deine E-Mail-Adresse über den Link, den wir dir schicken.",
    compatibility: "Kompatibilität deiner Uhr prüfen",
  },
  "pt-BR": {
    cta: "Receber aviso de lançamento",
    benefit: "Avisamos quando a oferta de lançamento de US$ 149 abrir.",
    terms: "Para os primeiros 100 apoiadores no Kickstarter. O cadastro não reserva a oferta.",
    reassurance: "Cadastro grátis · Sem pagamento agora",
    confirmation: "Confirme seu e-mail pelo link que enviaremos.",
    compatibility: "Verificar a compatibilidade do meu relógio",
  },
};
