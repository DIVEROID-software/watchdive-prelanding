import type { Locale } from "./i18n/locale.ts";

type Copy = {
  eyebrow: string;
  title: string;
  body: string;
  terms: string;
  country: string;
  search: string;
  empty: string;
  number: string;
  consent: string;
  button: string;
  busy: string;
  invalid: string;
  consentRequired: string;
  error: string;
  accepted: string;
  saved: string;
  emailHint: string;
};

export const PHONE_CONSENT_VERSION = "WD-SMS-CONSENT-V2";
export const phoneOptInCopy: Record<Locale, Copy> = {
  en: {
    eyebrow: "OPTIONAL · LAUNCH TEXT ALERT",
    title: "Be ready for the first 100.",
    body: "Add a launch-day text reminder alongside email, so you can spot the alert and act quickly when WatchDive opens on Kickstarter.",
    terms:
      "The early-bird offer goes to the first 100 backers on Kickstarter. Adding a number does not reserve a spot or guarantee the offer.",
    country: "Country / calling code",
    search: "Search country or code (e.g. UK, +44)",
    empty: "No country found. Try its name or calling code.",
    number: "Mobile number",
    consent:
      "Send me a WatchDive Kickstarter launch alert by SMS. Optional; I can opt out anytime. Message and data rates may apply.",
    button: "Add my text reminder",
    busy: "Saving…",
    invalid: "Check your country code and enter a complete mobile number.",
    consentRequired: "Please agree to the optional SMS alert to add your number.",
    error: "We couldn’t save your number. Try again, or reopen your email confirmation link.",
    accepted:
      "Request received. Please confirm your email to complete registration. A text reminder does not reserve an early-bird spot.",
    saved: "Your number and text-alert preference are saved. You can still receive email updates.",
    emailHint:
      "After confirming your email, you can add an optional launch-day text reminder to help you act quickly for the first 100 Kickstarter early-bird spots. A phone number does not reserve or guarantee a spot.",
  },
  ko: {
    eyebrow: "선택 · 출시 문자 알림",
    title: "선착순 100명을 노린다면, 알림도 빠르게.",
    body: "이메일에 출시 당일 문자 알림도 더하세요. WatchDive가 Kickstarter에서 열리면 알림을 확인하고 빠르게 참여할 수 있도록 도와드려요.",
    terms:
      "얼리버드 혜택은 Kickstarter에서 먼저 후원한 100명에게 적용돼요. 번호 등록으로 순서가 예약되거나 혜택이 보장되지는 않아요.",
    country: "국가 / 국가번호",
    search: "국가명 또는 번호 검색 (예: 한국, +82)",
    empty: "검색 결과가 없어요. 국가명이나 국가번호를 확인해 주세요.",
    number: "휴대전화 번호",
    consent:
      "WatchDive Kickstarter 출시 문자 알림 수신에 동의합니다. 선택 사항이며 언제든 수신을 거부할 수 있습니다. 통신사 요금이 발생할 수 있습니다.",
    button: "문자 알림도 신청하기",
    busy: "저장 중…",
    invalid: "국가번호와 휴대전화 번호를 확인해 주세요.",
    consentRequired: "문자 알림을 신청하려면 선택 수신 동의에 체크해 주세요.",
    error: "번호를 저장하지 못했어요. 다시 시도하거나 이메일 인증 링크를 다시 열어 주세요.",
    accepted:
      "신청을 받았어요. 이메일 인증까지 완료해 주세요. 문자 알림 신청은 얼리버드 순서를 예약하지 않아요.",
    saved: "번호와 문자 알림 수신 동의를 저장했어요. 이메일 알림도 계속 받으실 수 있어요.",
    emailHint:
      "이메일 인증 후 출시 당일 문자 알림도 신청할 수 있어요. 알림을 빨리 확인해 Kickstarter 선착순 100명 얼리버드 혜택에 도전하세요. 번호 등록이 순서를 예약하거나 혜택을 보장하지는 않아요.",
  },
  "zh-CN": {
    eyebrow: "可选 · 上线短信提醒",
    title: "为前100名早鸟名额做好准备。",
    body: "除邮件外，再添加上线当天的短信提醒。WatchDive 在 Kickstarter 上线时，及时查看提醒并参与支持。",
    terms: "早鸟优惠属于 Kickstarter 上最先支持的100人。留下号码不会预留名额或保证获得优惠。",
    country: "国家 / 电话区号",
    search: "搜索国家或区号（如中国、+86）",
    empty: "未找到国家，请尝试国家名称或区号。",
    number: "手机号码",
    consent:
      "我同意接收 WatchDive Kickstarter 上线短信。此项可选，可随时退订。可能产生短信及流量费用。",
    button: "添加短信提醒",
    busy: "正在保存…",
    invalid: "请检查国家区号并输入完整手机号码。",
    consentRequired: "请先同意接收可选短信提醒。",
    error: "未能保存，请重试或重新打开邮箱确认链接。",
    accepted: "已收到请求，请完成邮箱确认。短信提醒不会预留早鸟名额。",
    saved: "号码及短信同意已保存，您仍可收到邮件更新。",
    emailHint:
      "确认邮箱后，可添加上线当天的短信提醒，以便及时参与 Kickstarter 前100名早鸟优惠。号码不会预留或保证名额。",
  },
  "zh-TW": {
    eyebrow: "選填 · 上線簡訊提醒",
    title: "為前100名早鳥名額做好準備。",
    body: "除了電子郵件，再加上上線當天的簡訊提醒。WatchDive 在 Kickstarter 上線時，及時查看提醒並參與支持。",
    terms: "早鳥優惠適用於 Kickstarter 最先贊助的100人。留下號碼不會保留名額或保證優惠。",
    country: "國家 / 電話區碼",
    search: "搜尋國家或區碼（如台灣、+886）",
    empty: "找不到國家，請嘗試國家名稱或區碼。",
    number: "手機號碼",
    consent:
      "我同意接收 WatchDive Kickstarter 上線簡訊。此項選填，可隨時取消。可能產生簡訊及數據費用。",
    button: "加上簡訊提醒",
    busy: "儲存中…",
    invalid: "請確認國家區碼並輸入完整手機號碼。",
    consentRequired: "請先同意接收選填簡訊提醒。",
    error: "無法儲存，請重試或重新開啟電子郵件確認連結。",
    accepted: "已收到申請，請完成電子郵件確認。簡訊提醒不會保留早鳥名額。",
    saved: "號碼與簡訊同意已儲存，您仍可收到電子郵件更新。",
    emailHint:
      "確認電子郵件後，可加上上線當天的簡訊提醒，及時參與 Kickstarter 前100名早鳥優惠。號碼不會保留或保證名額。",
  },
  ja: {
    eyebrow: "任意 · 公開時のSMS通知",
    title: "先着100名に向けて準備を。",
    body: "メールに加えて、公開当日のSMS通知も登録できます。WatchDive が Kickstarter で公開されたら、通知を確認してすぐに参加しましょう。",
    terms:
      "早期特典は Kickstarter で最初に支援した100名が対象です。番号の登録で枠の予約や特典の保証はされません。",
    country: "国 / 国番号",
    search: "国名・国番号で検索（日本、+81など）",
    empty: "該当する国がありません。国名か国番号をご確認ください。",
    number: "携帯電話番号",
    consent:
      "WatchDive の Kickstarter 公開通知をSMSで受け取ることに同意します。任意で、いつでも配信停止できます。通信料金がかかる場合があります。",
    button: "SMS通知も登録",
    busy: "保存中…",
    invalid: "国番号と携帯電話番号をご確認ください。",
    consentRequired: "SMS通知を希望する場合は同意にチェックしてください。",
    error: "保存できませんでした。再試行するか、メールの確認リンクを開き直してください。",
    accepted:
      "リクエストを受け付けました。メールの確認を完了してください。SMS登録で枠は予約されません。",
    saved: "番号とSMS通知への同意を保存しました。メール通知も引き続き受け取れます。",
    emailHint:
      "メール確認後に公開当日のSMS通知も登録できます。通知を確認して Kickstarter の先着100名の早期特典に挑戦しましょう。番号の登録で枠の予約や特典は保証されません。",
  },
  es: {
    eyebrow: "OPCIONAL · AVISO POR SMS",
    title: "Prepárate para los primeros 100.",
    body: "Añade un recordatorio por SMS el día del lanzamiento, además del correo, para ver el aviso y actuar rápido cuando WatchDive abra en Kickstarter.",
    terms:
      "La oferta early bird es para los primeros 100 patrocinadores en Kickstarter. Dejar tu número no reserva una plaza ni garantiza la oferta.",
    country: "País / prefijo",
    search: "Busca país o prefijo (España, +34)",
    empty: "No se encontró el país. Prueba su nombre o prefijo.",
    number: "Número de móvil",
    consent:
      "Acepto recibir un SMS del lanzamiento de WatchDive en Kickstarter. Es opcional y puedo darme de baja cuando quiera. Pueden aplicarse tarifas de mensajes y datos.",
    button: "Añadir aviso por SMS",
    busy: "Guardando…",
    invalid: "Revisa el prefijo y escribe el número de móvil completo.",
    consentRequired: "Acepta el aviso opcional por SMS para añadir tu número.",
    error: "No se pudo guardar. Inténtalo de nuevo o abre el enlace de confirmación del correo.",
    accepted:
      "Solicitud recibida. Confirma tu correo para completar el registro. El SMS no reserva una plaza early bird.",
    saved: "Número y consentimiento guardados. Seguirás recibiendo novedades por correo.",
    emailHint:
      "Tras confirmar tu correo puedes añadir un SMS el día del lanzamiento para actuar rápido por una de las primeras 100 plazas early bird en Kickstarter. El número no reserva ni garantiza una plaza.",
  },
  fr: {
    eyebrow: "FACULTATIF · ALERTE SMS",
    title: "Préparez-vous pour les 100 premières places.",
    body: "Ajoutez un rappel par SMS le jour du lancement, en plus de l’e-mail, pour voir l’alerte et réagir vite à l’ouverture de WatchDive sur Kickstarter.",
    terms:
      "L’offre early bird est réservée aux 100 premiers contributeurs sur Kickstarter. Ajouter un numéro ne réserve aucune place et ne garantit pas l’offre.",
    country: "Pays / indicatif",
    search: "Rechercher un pays ou indicatif (France, +33)",
    empty: "Aucun pays trouvé. Essayez son nom ou son indicatif.",
    number: "Numéro de mobile",
    consent:
      "J’accepte un SMS pour le lancement de WatchDive sur Kickstarter. Facultatif, désinscription à tout moment. Des frais de messagerie et de données peuvent s’appliquer.",
    button: "Ajouter le rappel SMS",
    busy: "Enregistrement…",
    invalid: "Vérifiez l’indicatif et saisissez votre numéro de mobile complet.",
    consentRequired: "Acceptez l’alerte SMS facultative pour ajouter votre numéro.",
    error: "Enregistrement impossible. Réessayez ou rouvrez le lien de confirmation de l’e-mail.",
    accepted:
      "Demande reçue. Confirmez votre e-mail pour terminer l’inscription. Le SMS ne réserve pas de place early bird.",
    saved: "Numéro et accord SMS enregistrés. Vous recevrez toujours les e-mails.",
    emailHint:
      "Après confirmation de l’e-mail, vous pouvez ajouter un rappel SMS le jour du lancement pour réagir vite aux 100 premières places early bird sur Kickstarter. Le numéro ne réserve ni ne garantit une place.",
  },
  de: {
    eyebrow: "OPTIONAL · SMS ZUM START",
    title: "Sei bereit für die ersten 100.",
    body: "Ergänze die E-Mail um eine SMS am Starttag, damit du den Hinweis bemerkst und beim Start von WatchDive auf Kickstarter schnell reagieren kannst.",
    terms:
      "Das Early-Bird-Angebot gilt für die ersten 100 Unterstützer auf Kickstarter. Eine Telefonnummer reserviert keinen Platz und garantiert das Angebot nicht.",
    country: "Land / Vorwahl",
    search: "Land oder Vorwahl suchen (Deutschland, +49)",
    empty: "Kein Land gefunden. Versuche den Namen oder die Vorwahl.",
    number: "Mobilnummer",
    consent:
      "Ich möchte eine SMS zum Kickstarter-Start von WatchDive. Freiwillig und jederzeit abbestellbar. Nachrichten- und Datengebühren können anfallen.",
    button: "SMS-Erinnerung hinzufügen",
    busy: "Wird gespeichert…",
    invalid: "Prüfe die Vorwahl und gib deine vollständige Mobilnummer ein.",
    consentRequired: "Bitte stimme der freiwilligen SMS zu, um deine Nummer hinzuzufügen.",
    error:
      "Speichern fehlgeschlagen. Versuche es erneut oder öffne den Bestätigungslink in der E-Mail.",
    accepted:
      "Anfrage erhalten. Bestätige bitte deine E-Mail. Die SMS reserviert keinen Early-Bird-Platz.",
    saved: "Nummer und SMS-Einwilligung gespeichert. E-Mail-Updates erhältst du weiterhin.",
    emailHint:
      "Nach der E-Mail-Bestätigung kannst du eine SMS am Starttag hinzufügen, um schnell auf die ersten 100 Early-Bird-Plätze auf Kickstarter zu reagieren. Deine Nummer reserviert oder garantiert keinen Platz.",
  },
  "pt-BR": {
    eyebrow: "OPCIONAL · ALERTA POR SMS",
    title: "Prepare-se para os primeiros 100.",
    body: "Adicione um lembrete por SMS no dia do lançamento, além do e-mail, para ver o aviso e agir rápido quando o WatchDive abrir no Kickstarter.",
    terms:
      "A oferta early bird é para os primeiros 100 apoiadores no Kickstarter. Informar o número não reserva uma vaga nem garante a oferta.",
    country: "País / código",
    search: "Busque país ou código (Brasil, +55)",
    empty: "País não encontrado. Tente o nome ou o código.",
    number: "Número de celular",
    consent:
      "Quero um SMS sobre o lançamento do WatchDive no Kickstarter. É opcional e posso cancelar a qualquer momento. Podem ser cobradas tarifas de mensagens e dados.",
    button: "Adicionar lembrete por SMS",
    busy: "Salvando…",
    invalid: "Confira o código do país e digite o número completo.",
    consentRequired: "Aceite o alerta opcional por SMS para adicionar seu número.",
    error: "Não foi possível salvar. Tente novamente ou abra o link de confirmação do e-mail.",
    accepted:
      "Solicitação recebida. Confirme seu e-mail para concluir. O SMS não reserva uma vaga early bird.",
    saved: "Número e consentimento salvos. Você continuará recebendo os e-mails.",
    emailHint:
      "Após confirmar seu e-mail, você pode adicionar um SMS no dia do lançamento para agir rápido por uma das primeiras 100 vagas early bird no Kickstarter. O número não reserva nem garante uma vaga.",
  },
  nl: {
    eyebrow: "OPTIONEEL · SMS BIJ DE START",
    title: "Wees er klaar voor de eerste 100.",
    body: "Voeg naast e-mail een sms-herinnering op de lanceringsdag toe, zodat je de alert ziet en snel kunt handelen wanneer WatchDive op Kickstarter opent.",
    terms:
      "De early-birdaanbieding is voor de eerste 100 backers op Kickstarter. Een nummer toevoegen legt geen plek vast en maakt de aanbieding niet zeker.",
    country: "Land / landcode",
    search: "Zoek land of code (bijv. NL, +31)",
    empty: "Geen land gevonden. Probeer de naam of de landcode.",
    number: "Mobiel nummer",
    consent:
      "Stuur me een WatchDive Kickstarter-startalert per sms. Optioneel; ik kan me altijd afmelden. Bericht- en datakosten kunnen gelden.",
    button: "Voeg mijn sms-herinnering toe",
    busy: "Opslaan…",
    invalid: "Controleer je landcode en vul een volledig mobiel nummer in.",
    consentRequired: "Ga akkoord met de optionele sms-alert om je nummer toe te voegen.",
    error: "We konden je nummer niet opslaan. Probeer opnieuw, of open je e-mailbevestigingslink opnieuw.",
    accepted:
      "Aanvraag ontvangen. Bevestig je e-mail om de registratie af te ronden. Een sms-herinnering legt geen early-birdplek vast.",
    saved: "Je nummer en sms-voorkeur zijn opgeslagen. Je kunt nog steeds e-mailupdates ontvangen.",
    emailHint:
      "Na het bevestigen van je e-mail kun je een optionele sms-herinnering op de lanceringsdag toevoegen, zodat je snel kunt handelen voor de eerste 100 early-birdplekken op Kickstarter. Een telefoonnummer legt geen plek vast.",
  },
};
