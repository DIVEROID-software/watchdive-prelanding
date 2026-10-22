// Mail-only tone: the public site, official rules and program values stay shared
// and unchanged. In particular, never replace the five reviewed conditions.
import type { Locale } from "../i18n/locale.ts";
import { fill, referralCopy } from "./copy.ts";
import { referralEvent } from "./event.ts";
import { copyValues } from "./values.ts";

type Copy = ReturnType<typeof referralCopy>;
type MailTone = {
  mail: Pick<Copy["mail"],
    "welcomeHeading" | "welcomeOutro" | "welcomeIntro" | "shareHeading" |
    "noticeHeading" | "noticeBody">;
  event: Pick<Copy["event"], "label" | "headline" | "subline" | "benefits">;
};

const MAIL_TONE: Record<Locale, MailTone> = {
  ko: {
    mail: {
      welcomeHeading: "알림 신청이 완료되었어요!",
      welcomeOutro: "Kickstarter에 런칭하면 이메일로 알려드릴게요.",
      welcomeIntro: "아래 링크나 추천 코드를 아는 버디에게 공유해 주세요.",
      shareHeading: "버디와 함께해요",
      noticeHeading: "버디가 내 링크로 들어왔어요!",
      noticeBody: "지금까지 버디 {count}명이 내 링크로 참여해 이메일 인증까지 마쳤어요.",
    },
    event: {
      label: "추가 이벤트!",
      headline: "버디를 초대하면 혜택을 드려요",
      subline: "이메일 인증을 마친 친구가 늘수록 혜택이 커져요.",
      benefits: {
        first: "오픈 소식을 {hoursFirst}시간 먼저 받아요",
        buddy: "오픈 소식을 {hoursBuddy}시간 먼저 받아요",
        team: "얼리버드 {price} 그대로 후원해요",
        leader: "수중 라이트를 드려요 · 선착순 {stock}명",
        top: "WatchDive를 드려요",
      },
    },
  },
  en: {
    mail: {
      welcomeHeading: "You’re on the list!",
      welcomeOutro: "We’ll email you the moment WatchDive launches on Kickstarter.",
      welcomeIntro: "Share the link or referral code below with buddies you know.",
      shareHeading: "Bring your buddies along",
      noticeHeading: "A buddy joined through your link!",
      noticeBody: "So far, {count} buddies have joined through your link and confirmed their email.",
    },
    event: {
      label: "Bonus event!",
      headline: "Invite your buddies, unlock rewards",
      subline: "Rewards grow as more friends confirm their email.",
      benefits: {
        first: "Get the launch email {hoursFirst} hour early",
        buddy: "Get the launch email {hoursBuddy} hours early",
        team: "Pledge at the {price} early-bird price",
        leader: "Get an underwater light · first {stock}",
        top: "Get a WatchDive",
      },
    },
  },
  "zh-CN": {
    mail: {
      welcomeHeading: "上线提醒已订阅！",
      welcomeOutro: "WatchDive 在 Kickstarter 上线时，我们会发邮件告诉你。",
      welcomeIntro: "把下面的链接或推荐码分享给认识的潜伴吧。",
      shareHeading: "叫上潜伴一起来",
      noticeHeading: "潜伴通过你的链接加入啦！",
      noticeBody: "已有 {count} 位潜伴通过你的链接加入，并完成了邮箱验证。",
    },
    event: {
      label: "加码活动！",
      headline: "邀请潜伴，解锁好礼",
      subline: "完成邮箱验证的朋友越多，奖励越丰富。",
      benefits: {
        first: "提前 {hoursFirst} 小时收到上线通知",
        buddy: "提前 {hoursBuddy} 小时收到上线通知",
        team: "以 {price} 早鸟价支持众筹",
        leader: "送你水下灯 · 限前 {stock} 位",
        top: "送你 WatchDive",
      },
    },
  },
  "zh-TW": {
    mail: {
      welcomeHeading: "上線通知訂閱完成囉！",
      welcomeOutro: "WatchDive 在 Kickstarter 上線時，我們會寄信告訴你。",
      welcomeIntro: "把下面的連結或推薦碼分享給認識的潛伴吧。",
      shareHeading: "揪潛伴一起來",
      noticeHeading: "潛伴透過你的連結加入囉！",
      noticeBody: "已有 {count} 位潛伴透過你的連結加入，並完成了信箱驗證。",
    },
    event: {
      label: "加碼活動！",
      headline: "邀請潛伴，解鎖好禮",
      subline: "完成信箱驗證的朋友越多，獎勵越豐富。",
      benefits: {
        first: "提前 {hoursFirst} 小時收到上線通知",
        buddy: "提前 {hoursBuddy} 小時收到上線通知",
        team: "以 {price} 早鳥價贊助",
        leader: "送你水下燈 · 限前 {stock} 位",
        top: "送你 WatchDive",
      },
    },
  },
  ja: {
    mail: {
      welcomeHeading: "お知らせの登録ができました！",
      welcomeOutro: "WatchDive が Kickstarter で公開されたら、メールでお知らせします。",
      welcomeIntro: "下のリンクや紹介コードを、知り合いのバディにシェアしてみてください。",
      shareHeading: "バディも誘ってみませんか",
      noticeHeading: "あなたのリンクからバディが参加しました！",
      noticeBody: "これまでに{count}人のバディがあなたのリンクから参加し、メール認証を済ませてくれました。",
    },
    event: {
      label: "お楽しみ企画！",
      headline: "バディを誘って、特典を受け取ろう",
      subline: "メール認証を済ませた友だちが増えると、特典も増えていきます。",
      benefits: {
        first: "公開のお知らせが{hoursFirst}時間早く届きます",
        buddy: "公開のお知らせが{hoursBuddy}時間早く届きます",
        team: "早期割引の{price}で支援できます",
        leader: "水中ライトをプレゼント · 先着{stock}名",
        top: "WatchDive をプレゼント",
      },
    },
  },
  es: {
    mail: {
      welcomeHeading: "¡Ya estás en la lista!",
      welcomeOutro: "Te avisaremos por correo en cuanto WatchDive se lance en Kickstarter.",
      welcomeIntro: "Comparte el enlace o el código de abajo con compañeros que conozcas.",
      shareHeading: "Invita a tus compañeros",
      noticeHeading: "¡Un compañero se ha unido con tu enlace!",
      noticeBody: "Ya son {count} los compañeros que se han unido con tu enlace y han confirmado su correo.",
    },
    event: {
      label: "¡Una sorpresa más!",
      headline: "Invita a tus compañeros y consigue recompensas",
      subline: "Cuantos más amigos confirmen su correo, más recompensas tendrás.",
      benefits: {
        first: "Recibe el aviso {hoursFirst} hora antes",
        buddy: "Recibe el aviso {hoursBuddy} horas antes",
        team: "Apoya el proyecto al precio early bird de {price}",
        leader: "Recibe una linterna submarina · primeras {stock} personas",
        top: "Recibe un WatchDive",
      },
    },
  },
  fr: {
    mail: {
      welcomeHeading: "Vous voilà sur la liste !",
      welcomeOutro: "On vous écrit dès que WatchDive arrive sur Kickstarter.",
      welcomeIntro: "Partagez le lien ou le code ci-dessous avec des binômes que vous connaissez.",
      shareHeading: "Invitez vos binômes",
      noticeHeading: "Un binôme vous a rejoint via votre lien !",
      noticeBody: "Déjà {count} binômes ont rejoint la liste via votre lien et confirmé leur e-mail.",
    },
    event: {
      label: "Un petit bonus !",
      headline: "Invitez vos binômes et débloquez des récompenses",
      subline: "Plus vos amis confirment leur e-mail, plus les récompenses grandissent.",
      benefits: {
        first: "Recevez l’annonce {hoursFirst} heure avant",
        buddy: "Recevez l’annonce {hoursBuddy} heures avant",
        team: "Profitez du tarif early bird de {price} pour contribuer",
        leader: "Recevez une lampe de plongée · les {stock} premiers",
        top: "Recevez un WatchDive",
      },
    },
  },
  de: {
    mail: {
      welcomeHeading: "Du bist dabei!",
      welcomeOutro: "Wir mailen dir, sobald WatchDive auf Kickstarter startet.",
      welcomeIntro: "Teile den Link oder Empfehlungscode unten mit Buddys, die du kennst.",
      shareHeading: "Hol deine Buddys dazu",
      noticeHeading: "Ein Buddy ist über deinen Link dabei!",
      noticeBody: "Schon {count} Buddys haben sich über deinen Link angemeldet und ihre E-Mail-Adresse bestätigt.",
    },
    event: {
      label: "Noch ein Extra!",
      headline: "Lade deine Buddys ein und sichere dir Belohnungen",
      subline: "Je mehr Freunde ihre E-Mail bestätigen, desto mehr Vorteile warten auf dich.",
      benefits: {
        first: "Erhalte die Start-E-Mail {hoursFirst} Stunde früher",
        buddy: "Erhalte die Start-E-Mail {hoursBuddy} Stunden früher",
        team: "Unterstütze das Projekt zum Early-Bird-Preis von {price}",
        leader: "Erhalte eine Tauchlampe · für die ersten {stock}",
        top: "Erhalte ein WatchDive",
      },
    },
  },
  "pt-BR": {
    mail: {
      welcomeHeading: "Você já está na lista!",
      welcomeOutro: "A gente avisa por e-mail assim que o WatchDive chegar ao Kickstarter.",
      welcomeIntro: "Compartilhe o link ou o código abaixo com parceiros de mergulho que você conhece.",
      shareHeading: "Chame seus parceiros",
      noticeHeading: "Um parceiro entrou pelo seu link!",
      noticeBody: "Já são {count} parceiros que entraram pelo seu link e confirmaram o e-mail.",
    },
    event: {
      label: "Tem mais!",
      headline: "Convide seus parceiros e desbloqueie recompensas",
      subline: "Quanto mais amigos confirmarem o e-mail, mais recompensas você recebe.",
      benefits: {
        first: "Receba o aviso {hoursFirst} hora antes",
        buddy: "Receba o aviso {hoursBuddy} horas antes",
        team: "Apoie pelo preço early bird de {price}",
        leader: "Ganhe uma lanterna subaquática · primeiros {stock}",
        top: "Ganhe um WatchDive",
      },
    },
  },
};

export function buddyMailCopy(locale: Locale) {
  const copy = referralCopy(locale);
  const tone = MAIL_TONE[locale];
  return { ...copy, mail: { ...copy.mail, ...tone.mail }, event: { ...copy.event, ...tone.event } };
}

export function buddyMailEvent(locale: Locale, credited: number | null = null) {
  const event = referralEvent(locale, credited);
  const tone = MAIL_TONE[locale].event;
  const values = copyValues(locale);
  return {
    ...event,
    label: tone.label,
    headline: tone.headline,
    subline: tone.subline,
    steps: event.steps.map((step) => ({ ...step, benefit: fill(tone.benefits[step.id], values) })),
  };
}
