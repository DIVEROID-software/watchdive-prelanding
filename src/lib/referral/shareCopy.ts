// Share button label and prefilled share text for Buddy Invite (switch ON only).
//
// Legal review D9 (UK PECR / Korea 정보통신망법, 2026-10-22): when the
// program rewards a person for each friend who joins, the message that person
// sends must not read as our advertising sent on their behalf. So the button
// says "Share" (the person chooses where and to whom), and the prefilled text
// is a neutral product description with no reward, price or scarcity claim.
// en and ko are the reviewed strings handed down verbatim; the other locales are
// translations in the register each locale's landing already uses.
//
// With the switch OFF the landing keeps its frozen `m.referral.shareButton` /
// `m.referral.shareText` unchanged.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";

export type ReferralShareCopy = { button: string; text: string };

export const REFERRAL_SHARE_COPY: Record<Locale, ReferralShareCopy> = {
  en: {
    button: "Share my link",
    text: "WatchDive turns the Apple Watch or Galaxy Watch I already wear into a dive computer. Join the waitlist with my link.",
  },
  ko: {
    button: "내 링크 공유하기",
    text: "WatchDive는 지금 차고 있는 Apple Watch나 Galaxy Watch를 다이브 컴퓨터로 만들어 줘요. 내 링크로 출시 알림을 신청해 보세요.",
  },
  "zh-CN": {
    button: "分享我的链接",
    text: "WatchDive 能把我平时戴的 Apple Watch 或 Galaxy Watch 变成潜水电脑。用我的链接加入候补名单吧。",
  },
  "zh-TW": {
    button: "分享我的連結",
    text: "WatchDive 能把我平常戴的 Apple Watch 或 Galaxy Watch 變成潛水電腦。用我的連結加入候補名單吧。",
  },
  ja: {
    button: "自分のリンクをシェア",
    text: "WatchDive は、いつも着けている Apple Watch や Galaxy Watch をダイブコンピュータにしてくれます。私のリンクからウェイトリストに登録してみてください。",
  },
  es: {
    button: "Compartir mi enlace",
    text: "WatchDive convierte el Apple Watch o Galaxy Watch que ya llevo en un ordenador de buceo. Únete a la lista de espera con mi enlace.",
  },
  fr: {
    button: "Partager mon lien",
    text: "WatchDive transforme l’Apple Watch ou la Galaxy Watch que je porte déjà en ordinateur de plongée. Inscrivez-vous sur la liste d’attente avec mon lien.",
  },
  de: {
    button: "Meinen Link teilen",
    text: "WatchDive macht aus der Apple Watch oder Galaxy Watch, die ich ohnehin trage, einen Tauchcomputer. Trag dich über meinen Link in die Warteliste ein.",
  },
  "pt-BR": {
    button: "Compartilhar meu link",
    text: "O WatchDive transforma o Apple Watch ou Galaxy Watch que eu já uso em um computador de mergulho. Entra na lista de espera pelo meu link.",
  },
  nl: {
    button: "Deel mijn link",
    text: "WatchDive maakt van de Apple Watch of Galaxy Watch die ik al draag een duikcomputer. Schrijf je via mijn link in op de wachtlijst.",
  },
};

export function referralShareCopy(locale: Locale): ReferralShareCopy {
  return REFERRAL_SHARE_COPY[locale] ?? REFERRAL_SHARE_COPY.en;
}
