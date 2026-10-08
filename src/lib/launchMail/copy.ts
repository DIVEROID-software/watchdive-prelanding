// Launch-mail copy, written per language rather than translated from English.
//
// Facts allowed here, and nothing else (src/lib/i18n/frozen-landing-en.ts):
//   - WatchDive opens on Kickstarter; the launch time and URL are run inputs.
//   - The first 100 backers get it for $149; the public price is $299.
//   - The page promised one note the day before, one an hour before, and the
//     link the moment the campaign opens — these three mails keep that promise.
// No date, discount percentage, stock figure or product claim is introduced.
// What backer 101 pays is not stated anywhere live, so no mail says it.
//
// Prices are the USD amounts the English page anchors on. The localized pages
// show non-binding local-currency estimates instead; a mail that sends people
// to a checkout states the checkout's own amounts, marked US$ outside English.
//
// `{time}` is the launch moment, formatted for the reader's language.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";
import type { LaunchWave } from "./audience.ts";

export type WaveCopy = {
  subject: string;
  /** Inbox preview line, hidden in the body. */
  preheader: string;
  heading: string;
  body: string;
  price: string;
  button: string;
};

export type LaunchCopy = {
  waves: Record<LaunchWave, WaveCopy>;
  /** Small label above the time line. */
  timeLabel: string;
  reason: string;
  unsubscribe: string;
  help: string;
  /** The /unsubscribe page. */
  page: {
    title: string;
    confirmHeading: string;
    confirmBody: string;
    confirmButton: string;
    doneHeading: string;
    doneBody: string;
    invalidHeading: string;
    invalidBody: string;
    unavailableHeading: string;
    unavailableBody: string;
  };
};

/**
 * Where each language's launch time is shown, and how that zone is named in
 * that language. The UTC line underneath covers everyone outside it.
 */
export const LAUNCH_TIME_ZONE: Record<Locale, { zone: string; label: string }> = {
  en: { zone: "America/New_York", label: "ET" },
  ko: { zone: "Asia/Seoul", label: "한국 시간" },
  "zh-CN": { zone: "Asia/Shanghai", label: "北京时间" },
  "zh-TW": { zone: "Asia/Taipei", label: "台灣時間" },
  ja: { zone: "Asia/Tokyo", label: "日本時間" },
  es: { zone: "Europe/Madrid", label: "hora peninsular española" },
  fr: { zone: "Europe/Paris", label: "heure de Paris" },
  de: { zone: "Europe/Berlin", label: "deutsche Zeit" },
  "pt-BR": { zone: "America/Sao_Paulo", label: "horário de Brasília" },
};

/** The separator after a label in the plain-text part ("Launch time: …"). */
export const LABEL_SEPARATOR: Record<Locale, string> = {
  en: ": ",
  ko: ": ",
  "zh-CN": "：",
  "zh-TW": "：",
  ja: "：",
  es: ": ",
  fr: " : ",
  de: ": ",
  "pt-BR": ": ",
};

export const LAUNCH_COPY = {
  en: {
    waves: {
      "t-1d": {
        subject: "WatchDive opens on Kickstarter tomorrow",
        preheader: "One more note an hour before, then the link the moment it opens.",
        heading: "Tomorrow, WatchDive opens on Kickstarter",
        body: "The campaign goes live on {time}. We’ll write once more an hour before, then send the link the moment it opens.",
        price: "The first 100 backers get WatchDive for $149. The public price is $299.",
        button: "View the Kickstarter page",
      },
      "t-1h": {
        subject: "One hour until WatchDive opens on Kickstarter",
        preheader: "$149 is for the first 100 backers only.",
        heading: "One hour to go",
        body: "WatchDive opens on Kickstarter at {time}. The link reaches you the moment the campaign is live.",
        price: "$149 is for the first 100 backers only. The public price is $299.",
        button: "View the Kickstarter page",
      },
      "t-0": {
        subject: "WatchDive is live on Kickstarter",
        preheader: "The first 100 backers get $149.",
        heading: "WatchDive is live on Kickstarter",
        body: "The campaign just opened. Back it now for a chance to be one of the first 100 backers.",
        price: "The first 100 backers get WatchDive for $149. The public price is $299.",
        button: "Back WatchDive on Kickstarter",
      },
    },
    timeLabel: "Launch time",
    reason: "You’re getting this because you confirmed your email for the WatchDive waitlist.",
    unsubscribe: "Unsubscribe from launch emails",
    help: "Questions? help@diveroid.com",
    page: {
      title: "Launch emails — WatchDive",
      confirmHeading: "Stop WatchDive launch emails?",
      confirmBody: "You won’t get the remaining launch notes for this address.",
      confirmButton: "Unsubscribe",
      doneHeading: "You’re unsubscribed",
      doneBody: "We won’t send this address any more WatchDive launch emails.",
      invalidHeading: "This link doesn’t work",
      invalidBody: "Email help@diveroid.com and we’ll take you off the list by hand.",
      unavailableHeading: "We couldn’t save that just now",
      unavailableBody: "Please try again in a minute, or email help@diveroid.com.",
    },
  },
  ko: {
    waves: {
      "t-1d": {
        subject: "내일, WatchDive가 Kickstarter에서 공개됩니다",
        preheader: "시작 1시간 전에 한 번 더, 열리는 순간 바로 링크를 보내드려요.",
        heading: "내일, Kickstarter에서 만나요",
        body: "WatchDive 캠페인은 {time}에 시작합니다. 시작 1시간 전에 한 번 더 알려드리고, 캠페인이 열리는 순간 바로 링크를 보내드릴게요.",
        price: "선착순 후원자 100명은 US$149에 만날 수 있어요. 일반가는 US$299입니다.",
        button: "Kickstarter 페이지 보기",
      },
      "t-1h": {
        subject: "1시간 뒤, WatchDive Kickstarter가 열립니다",
        preheader: "US$149는 선착순 후원자 100명에게만 적용돼요.",
        heading: "이제 1시간 남았어요",
        body: "WatchDive는 {time}에 Kickstarter에서 공개됩니다. 캠페인이 열리면 곧바로 링크를 보내드릴게요.",
        price: "US$149는 선착순 후원자 100명에게만 적용됩니다. 일반가는 US$299입니다.",
        button: "Kickstarter 페이지 보기",
      },
      "t-0": {
        subject: "지금 WatchDive가 Kickstarter에서 시작했어요",
        preheader: "선착순 후원자 100명은 US$149.",
        heading: "지금 Kickstarter에서 만나 보세요",
        body: "방금 캠페인이 열렸습니다. 지금 후원하고 선착순 100명에 도전해 보세요.",
        price: "선착순 후원자 100명은 US$149, 일반가는 US$299입니다.",
        button: "Kickstarter에서 후원하기",
      },
    },
    timeLabel: "공개 시각",
    reason: "WatchDive 대기 명단에서 이메일 인증을 마치셔서 이 메일을 보내드렸습니다.",
    unsubscribe: "출시 알림 메일 그만 받기",
    help: "문의: help@diveroid.com",
    page: {
      title: "출시 알림 메일 — WatchDive",
      confirmHeading: "WatchDive 출시 알림 메일을 그만 받으시겠어요?",
      confirmBody: "이 주소로는 남은 출시 알림을 보내지 않습니다.",
      confirmButton: "수신 거부",
      doneHeading: "수신 거부가 완료되었습니다",
      doneBody: "이 주소로는 더 이상 WatchDive 출시 알림 메일을 보내지 않습니다.",
      invalidHeading: "이 링크는 사용할 수 없어요",
      invalidBody: "help@diveroid.com으로 메일을 주시면 직접 명단에서 빼드릴게요.",
      unavailableHeading: "지금은 처리하지 못했어요",
      unavailableBody: "잠시 후 다시 시도하시거나 help@diveroid.com으로 알려 주세요.",
    },
  },
  "zh-CN": {
    waves: {
      "t-1d": {
        subject: "WatchDive 明天登陆 Kickstarter",
        preheader: "开始前一小时再提醒一次，上线那一刻立刻发链接给你。",
        heading: "明天，Kickstarter 见",
        body: "WatchDive 众筹将于{time}开始。开始前一小时我们会再提醒你一次，众筹上线的那一刻立刻把链接发给你。",
        price: "前 100 位支持者可享 US$149，公开价格为 US$299。",
        button: "查看 Kickstarter 页面",
      },
      "t-1h": {
        subject: "还有 1 小时，WatchDive 即将登陆 Kickstarter",
        preheader: "US$149 仅限前 100 位支持者。",
        heading: "还有 1 小时",
        body: "WatchDive 将于{time}在 Kickstarter 上线。上线后我们会第一时间把链接发给你。",
        price: "US$149 仅限前 100 位支持者，公开价格为 US$299。",
        button: "查看 Kickstarter 页面",
      },
      "t-0": {
        subject: "WatchDive 已在 Kickstarter 上线",
        preheader: "前 100 位支持者 US$149。",
        heading: "WatchDive 已在 Kickstarter 上线",
        body: "众筹刚刚开始。现在就去支持，争取成为前 100 位支持者。",
        price: "前 100 位支持者 US$149，公开价格 US$299。",
        button: "去 Kickstarter 支持",
      },
    },
    timeLabel: "上线时间",
    reason: "你收到这封邮件，是因为你已在 WatchDive 候补名单中确认了邮箱。",
    unsubscribe: "退订上线通知邮件",
    help: "有疑问？help@diveroid.com",
    page: {
      title: "上线通知邮件 — WatchDive",
      confirmHeading: "不再接收 WatchDive 上线通知？",
      confirmBody: "我们将不再向这个邮箱发送剩余的上线通知。",
      confirmButton: "退订",
      doneHeading: "已退订",
      doneBody: "我们不会再向这个邮箱发送 WatchDive 上线通知邮件。",
      invalidHeading: "这个链接无法使用",
      invalidBody: "请发邮件至 help@diveroid.com，我们会手动为你退订。",
      unavailableHeading: "暂时没能保存",
      unavailableBody: "请稍后再试，或发邮件至 help@diveroid.com。",
    },
  },
  "zh-TW": {
    waves: {
      "t-1d": {
        subject: "WatchDive 明天在 Kickstarter 上線",
        preheader: "開始前一小時再提醒一次，上線那一刻馬上寄連結給你。",
        heading: "明天，Kickstarter 見",
        body: "WatchDive 募資活動將於{time}開跑。開跑前一小時我們會再提醒你一次，活動上線的那一刻馬上把連結寄給你。",
        price: "前 100 位贊助者可享 US$149，公開售價為 US$299。",
        button: "查看 Kickstarter 頁面",
      },
      "t-1h": {
        subject: "倒數 1 小時，WatchDive 即將在 Kickstarter 上線",
        preheader: "US$149 僅限前 100 位贊助者。",
        heading: "倒數 1 小時",
        body: "WatchDive 將於{time}在 Kickstarter 上線。一上線我們就會把連結寄給你。",
        price: "US$149 僅限前 100 位贊助者，公開售價為 US$299。",
        button: "查看 Kickstarter 頁面",
      },
      "t-0": {
        subject: "WatchDive 已在 Kickstarter 上線",
        preheader: "前 100 位贊助者 US$149。",
        heading: "WatchDive 已在 Kickstarter 上線",
        body: "募資活動剛剛開跑。現在贊助，搶當前 100 位贊助者。",
        price: "前 100 位贊助者 US$149，公開售價 US$299。",
        button: "前往 Kickstarter 贊助",
      },
    },
    timeLabel: "上線時間",
    reason: "你會收到這封信，是因為你已在 WatchDive 等候名單確認了電子郵件。",
    unsubscribe: "取消訂閱上線通知信",
    help: "有問題嗎？help@diveroid.com",
    page: {
      title: "上線通知信 — WatchDive",
      confirmHeading: "不再收到 WatchDive 上線通知？",
      confirmBody: "我們將不再寄送剩下的上線通知到這個信箱。",
      confirmButton: "取消訂閱",
      doneHeading: "已取消訂閱",
      doneBody: "我們不會再寄 WatchDive 上線通知信到這個信箱。",
      invalidHeading: "這個連結無法使用",
      invalidBody: "請寄信到 help@diveroid.com，我們會手動幫你取消。",
      unavailableHeading: "目前無法儲存",
      unavailableBody: "請稍後再試，或寄信到 help@diveroid.com。",
    },
  },
  ja: {
    waves: {
      "t-1d": {
        subject: "WatchDive、明日Kickstarterで公開",
        preheader: "開始1時間前にもう一度、公開と同時にリンクをお届けします。",
        heading: "明日、Kickstarterで公開します",
        body: "WatchDiveのキャンペーンは{time}に始まります。開始1時間前にもう一度お知らせし、公開と同時にリンクをお送りします。",
        price: "先着100名のバッカーはUS$149。一般価格はUS$299です。",
        button: "Kickstarterページを見る",
      },
      "t-1h": {
        subject: "あと1時間、WatchDiveがKickstarterで公開",
        preheader: "US$149は先着100名のバッカー限定です。",
        heading: "公開まで、あと1時間",
        body: "WatchDiveは{time}にKickstarterで公開されます。公開と同時にリンクをお送りします。",
        price: "US$149は先着100名のバッカー限定です。一般価格はUS$299です。",
        button: "Kickstarterページを見る",
      },
      "t-0": {
        subject: "WatchDive、Kickstarterで公開しました",
        preheader: "先着100名のバッカーはUS$149。",
        heading: "Kickstarterで公開しました",
        body: "キャンペーンが始まりました。先着100名を狙うなら、今がチャンスです。",
        price: "先着100名のバッカーはUS$149、一般価格はUS$299です。",
        button: "Kickstarterで支援する",
      },
    },
    timeLabel: "公開日時",
    reason:
      "WatchDiveウェイトリストでメールアドレスを確認いただいたため、このメールをお送りしています。",
    unsubscribe: "ローンチのお知らせメールを停止する",
    help: "お問い合わせ：help@diveroid.com",
    page: {
      title: "ローンチのお知らせメール — WatchDive",
      confirmHeading: "WatchDiveのローンチのお知らせを停止しますか？",
      confirmBody: "このアドレスには、残りのお知らせをお送りしません。",
      confirmButton: "配信を停止する",
      doneHeading: "配信を停止しました",
      doneBody: "このアドレスにWatchDiveのローンチのお知らせをお送りすることはありません。",
      invalidHeading: "このリンクは使用できません",
      invalidBody: "help@diveroid.comまでご連絡いただければ、こちらで配信を停止します。",
      unavailableHeading: "ただいま処理できませんでした",
      unavailableBody:
        "しばらくしてからもう一度お試しいただくか、help@diveroid.comまでご連絡ください。",
    },
  },
  es: {
    waves: {
      "t-1d": {
        subject: "WatchDive llega mañana a Kickstarter",
        preheader: "Te escribimos otra vez una hora antes y te mandamos el enlace en cuanto abra.",
        heading: "Mañana abrimos en Kickstarter",
        body: "La campaña de WatchDive empieza el {time}. Te escribiremos una vez más una hora antes y te mandaremos el enlace en cuanto se abra.",
        price:
          "Los primeros 100 mecenas se llevan WatchDive por 149 US$. El precio público es de 299 US$.",
        button: "Ver la página de Kickstarter",
      },
      "t-1h": {
        subject: "Falta una hora para WatchDive en Kickstarter",
        preheader: "Los 149 US$ son solo para los primeros 100 mecenas.",
        heading: "Falta una hora",
        body: "WatchDive abre en Kickstarter el {time}. Te mandamos el enlace en cuanto la campaña esté activa.",
        price:
          "Los 149 US$ son solo para los primeros 100 mecenas. El precio público es de 299 US$.",
        button: "Ver la página de Kickstarter",
      },
      "t-0": {
        subject: "WatchDive ya está en Kickstarter",
        preheader: "Los primeros 100 mecenas: 149 US$.",
        heading: "WatchDive ya está en Kickstarter",
        body: "La campaña acaba de abrir. Entra ahora y prueba a estar entre los primeros 100 mecenas.",
        price:
          "Los primeros 100 mecenas se llevan WatchDive por 149 US$. El precio público es de 299 US$.",
        button: "Apoyar WatchDive en Kickstarter",
      },
    },
    timeLabel: "Hora de lanzamiento",
    reason:
      "Recibes este correo porque confirmaste tu dirección en la lista de espera de WatchDive.",
    unsubscribe: "Darme de baja de los avisos de lanzamiento",
    help: "¿Dudas? help@diveroid.com",
    page: {
      title: "Avisos de lanzamiento — WatchDive",
      confirmHeading: "¿Dejar de recibir los avisos de lanzamiento de WatchDive?",
      confirmBody: "No enviaremos a esta dirección los avisos que quedan.",
      confirmButton: "Darme de baja",
      doneHeading: "Te has dado de baja",
      doneBody: "No volveremos a enviar avisos de lanzamiento de WatchDive a esta dirección.",
      invalidHeading: "Este enlace no funciona",
      invalidBody: "Escríbenos a help@diveroid.com y te daremos de baja a mano.",
      unavailableHeading: "No hemos podido guardarlo ahora",
      unavailableBody: "Vuelve a intentarlo en un minuto o escríbenos a help@diveroid.com.",
    },
  },
  fr: {
    waves: {
      "t-1d": {
        subject: "WatchDive arrive demain sur Kickstarter",
        preheader: "Un dernier mot une heure avant, puis le lien dès l’ouverture.",
        heading: "Rendez-vous demain sur Kickstarter",
        body: "La campagne WatchDive démarre le {time}. Nous vous écrirons une dernière fois une heure avant, puis nous vous enverrons le lien dès l’ouverture.",
        price:
          "Les 100 premiers contributeurs obtiennent WatchDive à 149 $ US. Le prix public est de 299 $ US.",
        button: "Voir la page Kickstarter",
      },
      "t-1h": {
        subject: "Plus qu’une heure avant WatchDive sur Kickstarter",
        preheader: "Le prix de 149 $ US est réservé aux 100 premiers contributeurs.",
        heading: "Plus qu’une heure",
        body: "WatchDive ouvre sur Kickstarter le {time}. Vous recevrez le lien dès que la campagne sera en ligne.",
        price:
          "Le prix de 149 $ US est réservé aux 100 premiers contributeurs. Le prix public est de 299 $ US.",
        button: "Voir la page Kickstarter",
      },
      "t-0": {
        subject: "WatchDive est en ligne sur Kickstarter",
        preheader: "Les 100 premiers contributeurs : 149 $ US.",
        heading: "WatchDive est en ligne sur Kickstarter",
        body: "La campagne vient d’ouvrir. Soutenez-la maintenant pour tenter d’être parmi les 100 premiers contributeurs.",
        price:
          "Les 100 premiers contributeurs obtiennent WatchDive à 149 $ US. Le prix public est de 299 $ US.",
        button: "Soutenir WatchDive sur Kickstarter",
      },
    },
    timeLabel: "Heure de lancement",
    reason:
      "Vous recevez cet e-mail car vous avez confirmé votre adresse sur la liste d’attente WatchDive.",
    unsubscribe: "Ne plus recevoir les e-mails de lancement",
    help: "Une question ? help@diveroid.com",
    page: {
      title: "E-mails de lancement — WatchDive",
      confirmHeading: "Ne plus recevoir les e-mails de lancement WatchDive ?",
      confirmBody: "Nous n’enverrons plus les messages de lancement restants à cette adresse.",
      confirmButton: "Me désabonner",
      doneHeading: "Vous êtes désabonné",
      doneBody: "Nous n’enverrons plus d’e-mails de lancement WatchDive à cette adresse.",
      invalidHeading: "Ce lien ne fonctionne pas",
      invalidBody: "Écrivez à help@diveroid.com et nous vous retirerons de la liste nous-mêmes.",
      unavailableHeading: "Impossible d’enregistrer pour le moment",
      unavailableBody: "Réessayez dans une minute ou écrivez à help@diveroid.com.",
    },
  },
  de: {
    waves: {
      "t-1d": {
        subject: "Morgen startet WatchDive auf Kickstarter",
        preheader: "Eine Stunde vorher melden wir uns noch einmal, dann kommt der Link.",
        heading: "Morgen geht’s los auf Kickstarter",
        body: "Die WatchDive-Kampagne startet am {time}. Eine Stunde vorher melden wir uns noch einmal, und sobald sie live ist, schicken wir dir den Link.",
        price:
          "Die ersten 100 Unterstützer bekommen WatchDive für 149 US$. Der reguläre Preis liegt bei 299 US$.",
        button: "Zur Kickstarter-Seite",
      },
      "t-1h": {
        subject: "Noch eine Stunde bis WatchDive auf Kickstarter",
        preheader: "149 US$ gelten nur für die ersten 100 Unterstützer.",
        heading: "Noch eine Stunde",
        body: "WatchDive startet am {time} auf Kickstarter. Den Link bekommst du, sobald die Kampagne live ist.",
        price:
          "149 US$ gelten nur für die ersten 100 Unterstützer. Der reguläre Preis liegt bei 299 US$.",
        button: "Zur Kickstarter-Seite",
      },
      "t-0": {
        subject: "WatchDive ist jetzt live auf Kickstarter",
        preheader: "Die ersten 100 Unterstützer: 149 US$.",
        heading: "WatchDive ist live auf Kickstarter",
        body: "Die Kampagne ist gerade gestartet. Sei jetzt dabei und hol dir die Chance auf einen der ersten 100 Plätze.",
        price:
          "Die ersten 100 Unterstützer bekommen WatchDive für 149 US$. Der reguläre Preis liegt bei 299 US$.",
        button: "WatchDive auf Kickstarter unterstützen",
      },
    },
    timeLabel: "Startzeit",
    reason:
      "Du bekommst diese E-Mail, weil du deine Adresse für die WatchDive-Warteliste bestätigt hast.",
    unsubscribe: "Launch-E-Mails abbestellen",
    help: "Fragen? help@diveroid.com",
    page: {
      title: "Launch-E-Mails — WatchDive",
      confirmHeading: "WatchDive-Launch-E-Mails abbestellen?",
      confirmBody: "An diese Adresse schicken wir dann keine der restlichen Launch-E-Mails mehr.",
      confirmButton: "Abbestellen",
      doneHeading: "Du hast dich abgemeldet",
      doneBody: "An diese Adresse schicken wir keine WatchDive-Launch-E-Mails mehr.",
      invalidHeading: "Dieser Link funktioniert nicht",
      invalidBody: "Schreib an help@diveroid.com, dann tragen wir dich von Hand aus.",
      unavailableHeading: "Das hat gerade nicht geklappt",
      unavailableBody: "Versuch es in einer Minute noch einmal oder schreib an help@diveroid.com.",
    },
  },
  "pt-BR": {
    waves: {
      "t-1d": {
        subject: "WatchDive chega amanhã ao Kickstarter",
        preheader: "Mais um aviso uma hora antes e o link assim que abrir.",
        heading: "Amanhã no Kickstarter",
        body: "O WatchDive entra no Kickstarter amanhã: {time}. Vamos escrever mais uma vez uma hora antes e mandar o link assim que a campanha abrir.",
        price:
          "Os 100 primeiros apoiadores levam o WatchDive por US$ 149. O preço público é US$ 299.",
        button: "Ver a página no Kickstarter",
      },
      "t-1h": {
        subject: "Falta uma hora para o WatchDive no Kickstarter",
        preheader: "US$ 149 vale só para os 100 primeiros apoiadores.",
        heading: "Falta uma hora",
        body: "O WatchDive abre no Kickstarter daqui a uma hora: {time}. Você recebe o link assim que a campanha estiver no ar.",
        price:
          "O preço de US$ 149 vale só para os 100 primeiros apoiadores. O preço público é US$ 299.",
        button: "Ver a página no Kickstarter",
      },
      "t-0": {
        subject: "O WatchDive está no ar no Kickstarter",
        preheader: "Os 100 primeiros apoiadores: US$ 149.",
        heading: "O WatchDive está no ar no Kickstarter",
        body: "A campanha acabou de abrir. Apoie agora e tente ficar entre os 100 primeiros apoiadores.",
        price:
          "Os 100 primeiros apoiadores levam o WatchDive por US$ 149. O preço público é US$ 299.",
        button: "Apoiar o WatchDive no Kickstarter",
      },
    },
    timeLabel: "Horário de lançamento",
    reason:
      "Você recebe este e-mail porque confirmou seu endereço na lista de espera do WatchDive.",
    unsubscribe: "Cancelar os e-mails de lançamento",
    help: "Dúvidas? help@diveroid.com",
    page: {
      title: "E-mails de lançamento — WatchDive",
      confirmHeading: "Parar de receber os e-mails de lançamento do WatchDive?",
      confirmBody: "Não vamos mais mandar os avisos de lançamento restantes para este endereço.",
      confirmButton: "Cancelar inscrição",
      doneHeading: "Inscrição cancelada",
      doneBody: "Não vamos mais mandar e-mails de lançamento do WatchDive para este endereço.",
      invalidHeading: "Este link não funciona",
      invalidBody: "Escreva para help@diveroid.com e tiramos você da lista manualmente.",
      unavailableHeading: "Não conseguimos salvar agora",
      unavailableBody: "Tente de novo em um minuto ou escreva para help@diveroid.com.",
    },
  },
} as const satisfies Record<Locale, LaunchCopy>;
