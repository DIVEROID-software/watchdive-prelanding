// Buddy Invite copy for every surface: landing card, leaderboard, status page,
// mails and the official rules. Numbers are interpolated from program.ts only
// ({placeholders}); never type a threshold, stock, price or hour count here.
//
// Placeholders: {count} {remaining} {tier} {hours} {price} {seats} {stock}
// {winners} {cap} {noticeDays} {nickname} {time} {closeDate}
//
// ko and en are the reviewed source. The other seven locales start as English
// and are replaced by reviewed translations; tests fail while any locale still
// equals English (see tests/referralCopy.test.ts).

import type { Locale } from "../i18n/locale.ts";
import type { ReferralTierId } from "./program.ts";

export type ReferralCopy = {
  programName: string;
  tiers: Record<ReferralTierId, { name: string; reward: string }>;
  top: { name: string; reward: string };
  countingNote: string;
  card: {
    title: string;
    body: string;
    progress: string;
    progressNone: string;
    progressMax: string;
    statusLink: string;
    rulesLink: string;
  };
  leaderboard: {
    title: string;
    subtitle: string;
    entry: string;
    privateDiver: string;
    empty: string;
    closed: string;
    rulesLink: string;
  };
  status: {
    title: string;
    countLabel: string;
    tierLabel: string;
    tierNone: string;
    rankLabel: string;
    rankNone: string;
    earlyNotice: string;
    lightEligible: string;
    lightGone: string;
    shareTitle: string;
    nicknameLabel: string;
    nicknameHelp: string;
    nicknameHiddenNote: string;
    leaderboardToggle: string;
    noticesToggle: string;
    save: string;
    saving: string;
    saved: string;
    invalidLink: string;
    errors: Record<
      "too_short" | "too_long" | "contact_info" | "link" | "reserved" | "invalid_chars" | "failed",
      string
    >;
  };
  mail: {
    welcomeSubject: string;
    welcomeHeading: string;
    welcomeIntro: string;
    welcomeTiersHeading: string;
    welcomeButton: string;
    welcomeFallback: string;
    welcomeStatus: string;
    welcomeRules: string;
    welcomeOutro: string;
    noticeSubject: string;
    noticeHeading: string;
    noticeBody: string;
    noticeTierReached: string;
    noticeNext: string;
    noticeMax: string;
    noticeButton: string;
    noticeFooter: string;
  };
  rules: {
    title: string;
    updated: string;
    sections: { heading: string; paragraphs: string[] }[];
  };
};

const en: ReferralCopy = {
  programName: "Buddy Invite",
  tiers: {
    first: {
      name: "First invite · 1 friend",
      reward: "Get the Kickstarter launch email {hours} hour before the general list.",
    },
    buddy: {
      name: "Buddy · 3 friends",
      reward: "Get the Kickstarter launch email {hours} hours before the general list.",
    },
    team: {
      name: "Dive Team · 5 friends",
      reward:
        "Keep the {price} early-bird price with a private Kickstarter reward link, even after the first {seats} backers are gone.",
    },
    leader: {
      name: "Dive Leader · 10 friends",
      reward:
        "Get a free underwater light. {stock} in stock, awarded in the order people reach 10. Shipping and taxes are paid by the recipient.",
    },
  },
  top: {
    name: "Top {winners} inviters",
    reward:
      "The {winners} people with the most verified friends when the Kickstarter campaign goes live each get one WatchDive. Shipping and taxes are paid by the recipient.",
  },
  countingNote: "Only friends who confirm their email count.",
  card: {
    title: "Invite your dive buddies",
    body: "Send your link. Rewards grow with every friend who confirms their email.",
    progress: "{count} joined · {remaining} more for {tier}",
    progressNone: "No friends yet · {remaining} more for {tier}",
    progressMax: "{count} joined · every tier reached. Go for the top {winners}.",
    statusLink: "See my invites",
    rulesLink: "Official rules",
  },
  leaderboard: {
    title: "Buddy Invite top {winners}",
    subtitle: "Verified friends only · as of {time}",
    entry: "{count} friends",
    privateDiver: "Private diver",
    empty: "No one is on the board yet. Your first invite could put you here.",
    closed: "The Buddy Invite contest has closed. Winners are being reviewed.",
    rulesLink: "Official rules",
  },
  status: {
    title: "My Buddy Invite",
    countLabel: "Friends who joined",
    tierLabel: "Current tier",
    tierNone: "None yet",
    rankLabel: "Leaderboard rank",
    rankNone: "Not ranked yet",
    earlyNotice: "You will get the Kickstarter launch email {hours} hour(s) early.",
    lightEligible: "You are among the first {stock} Dive Leaders. We will contact you about your underwater light.",
    lightGone: "All {stock} underwater lights have been claimed.",
    shareTitle: "Your invite link",
    nicknameLabel: "Nickname for the leaderboard",
    nicknameHelp: "{min}–{max} characters. No email addresses, phone numbers or links.",
    nicknameHiddenNote: "This nickname was hidden by our team. Please choose another.",
    leaderboardToggle: "Show my nickname on the top {winners} leaderboard",
    noticesToggle: "Email me when a friend joins",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    invalidLink: "This link is not valid. Open the latest link from your WatchDive email.",
    errors: {
      too_short: "Use at least {min} characters.",
      too_long: "Use at most {max} characters.",
      contact_info: "A nickname cannot contain an email address or phone number.",
      link: "A nickname cannot contain a link.",
      reserved: "Please choose a different nickname.",
      invalid_chars: "Use letters, numbers, spaces, dots, hyphens or underscores.",
      failed: "Could not save. Please try again.",
    },
  },
  mail: {
    welcomeSubject: "You’re on the WatchDive waitlist — invite your buddies",
    welcomeHeading: "You’re on the WatchDive waitlist",
    welcomeIntro:
      "Your email is confirmed. Send your personal invite link to the divers you dive with. Rewards grow with every friend who confirms their email.",
    welcomeTiersHeading: "Buddy Invite rewards",
    welcomeButton: "Share my invite link",
    welcomeFallback: "Or copy this link:",
    welcomeStatus: "Check your invites and set a leaderboard nickname:",
    welcomeRules: "Official rules:",
    welcomeOutro: "We will email you when WatchDive goes live on Kickstarter.",
    noticeSubject: "A buddy joined through your link ({count} so far)",
    noticeHeading: "A buddy joined through your link",
    noticeBody: "{count} friends have joined through your link and confirmed their email.",
    noticeTierReached: "You reached {tier}: {reward}",
    noticeNext: "{remaining} more for {tier}.",
    noticeMax: "Every tier reached. Keep going for the top {winners}.",
    noticeButton: "See my invites",
    noticeFooter: "You can turn these emails off on your invite page.",
  },
  rules: {
    title: "Buddy Invite official rules",
    updated: "Last updated: 22 October 2026",
    sections: [
      {
        heading: "Organizer",
        paragraphs: [
          "Buddy Invite is run by DIVEROID LTD (United Kingdom), the maker of WatchDive. Questions: help@diveroid.com.",
        ],
      },
      {
        heading: "Period",
        paragraphs: [
          "The program starts on 22 October 2026 and closes immediately before the WatchDive Kickstarter campaign goes live. The campaign is planned for December 2026. We will announce the exact closing time on this page and by email at least {noticeDays} days in advance.",
        ],
      },
      {
        heading: "How to take part",
        paragraphs: [
          "Join the WatchDive waitlist and confirm your email. You then get a personal invite link. A friend counts for you when they open your link, join the waitlist and confirm their email.",
          "No purchase or Kickstarter pledge is needed to take part or to win. The early-bird price link is used when you choose to back the campaign.",
        ],
      },
      {
        heading: "What counts",
        paragraphs: [
          "Only friends who confirm their email count. Your own addresses, repeat sign-ups by the same person, disposable email addresses and sign-ups flagged as abusive do not count.",
          "At most {cap} friends are counted for one person per day (Korea Standard Time). Friends who confirm after the closing time do not count.",
        ],
      },
      {
        heading: "Rewards",
        paragraphs: [
          "1 friend: the Kickstarter launch email {hoursFirst} hour before the general list.",
          "3 friends (Buddy): the launch email {hoursBuddy} hours before the general list.",
          "5 friends (Dive Team): a private Kickstarter reward link at the {price} early-bird price, available even after the first {seats} backers are gone.",
          "10 friends (Dive Leader): one free underwater light. We have {stock}. They go to the first {stock} people to reach 10 friends, in the order they reach it. When they are gone, we will say so on this page.",
          "Top {winners}: the {winners} people with the most counted friends at the closing time each get one WatchDive. If two people have the same count, the one who reached it first ranks higher.",
        ],
      },
      {
        heading: "Review and disqualification",
        paragraphs: [
          "Before any light or WatchDive is sent, we review the counted friends. We may remove friends that break these rules and disqualify anyone who uses fake or automated sign-ups. We contact winners by email. If a winner does not reply within 14 days, the reward passes to the next person in order.",
        ],
      },
      {
        heading: "Delivery, shipping and taxes",
        paragraphs: [
          "Recipients pay shipping and any taxes or duties, including Korean withholding tax on prizes where it applies. We ship only to countries the WatchDive Kickstarter campaign ships to. Underwater lights are sent after review. A WatchDive prize is sent when WatchDive ships to backers.",
        ],
      },
      {
        heading: "Leaderboard and privacy",
        paragraphs: [
          "The leaderboard shows only a nickname you set and choose to show. Your email address is never shown. People who do not choose to show a nickname appear as “Private diver”. We may hide a nickname that is offensive or impersonates someone.",
          "We never tell you who your friends are, only how many joined. See our privacy policy for how we handle waitlist data.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If we must change or end the program, we will announce it here and by email first. Rewards already reached before a change are kept.",
        ],
      },
    ],
  },
};

const ko: ReferralCopy = {
  programName: "버디 초대",
  tiers: {
    first: {
      name: "첫 초대 · 1명",
      reward: "킥스타터 오픈 소식을 일반 명단보다 {hours}시간 먼저 이메일로 받아요.",
    },
    buddy: {
      name: "버디 · 3명",
      reward: "킥스타터 오픈 소식을 일반 명단보다 {hours}시간 먼저 이메일로 받아요.",
    },
    team: {
      name: "다이브 팀 · 5명",
      reward:
        "선착순 {seats}명이 마감돼도 얼리버드 가격 {price}로 후원할 수 있는 킥스타터 전용 리워드 링크를 드려요.",
    },
    leader: {
      name: "다이브 리더 · 10명",
      reward:
        "수중 라이트 1개를 드려요. 준비된 수량은 {stock}개이며, 10명을 먼저 달성한 순서대로 드립니다. 배송비와 제세공과금은 받는 분이 부담합니다.",
    },
  },
  top: {
    name: "초대 랭킹 Top {winners}",
    reward:
      "킥스타터 캠페인 오픈 직전 기준으로 인증을 마친 친구를 가장 많이 초대한 {winners}명에게 WatchDive를 1개씩 드려요. 배송비와 제세공과금은 받는 분이 부담합니다.",
  },
  countingNote: "이메일 인증을 마친 친구만 집계됩니다.",
  card: {
    title: "다이빙 버디를 초대하세요",
    body: "내 링크를 보내 주세요. 이메일 인증을 마친 친구가 늘어날수록 혜택이 커집니다.",
    progress: "{count}명 참여 · {tier}까지 {remaining}명 남았어요",
    progressNone: "아직 참여한 친구가 없어요 · {tier}까지 {remaining}명",
    progressMax: "{count}명 참여 · 모든 단계를 달성했어요. 랭킹 Top {winners}에 도전해 보세요.",
    statusLink: "내 초대 현황 보기",
    rulesLink: "공식 규칙",
  },
  leaderboard: {
    title: "버디 초대 랭킹 Top {winners}",
    subtitle: "인증을 마친 친구만 집계 · {time} 기준",
    entry: "{count}명",
    privateDiver: "비공개 다이버",
    empty: "아직 랭킹에 오른 분이 없어요. 첫 초대로 이 자리에 올라 보세요.",
    closed: "버디 초대 이벤트가 마감되었습니다. 당첨자를 검수하고 있어요.",
    rulesLink: "공식 규칙",
  },
  status: {
    title: "내 버디 초대 현황",
    countLabel: "참여한 친구",
    tierLabel: "현재 단계",
    tierNone: "아직 없음",
    rankLabel: "랭킹 순위",
    rankNone: "아직 순위 없음",
    earlyNotice: "킥스타터 오픈 소식을 {hours}시간 먼저 이메일로 받습니다.",
    lightEligible: "수중 라이트 {stock}개 대상에 들었어요. 검수 후 이메일로 연락드릴게요.",
    lightGone: "수중 라이트 {stock}개가 모두 소진되었습니다.",
    shareTitle: "내 초대 링크",
    nicknameLabel: "랭킹에 표시할 닉네임",
    nicknameHelp: "{min}~{max}자. 이메일 주소, 전화번호, 링크는 쓸 수 없어요.",
    nicknameHiddenNote: "운영팀이 이 닉네임을 숨겼어요. 다른 닉네임을 정해 주세요.",
    leaderboardToggle: "랭킹 Top {winners}에 내 닉네임 표시하기",
    noticesToggle: "친구가 참여하면 이메일로 알림 받기",
    save: "저장",
    saving: "저장 중…",
    saved: "저장했어요",
    invalidLink: "올바른 링크가 아니에요. WatchDive 이메일에 있는 최신 링크로 열어 주세요.",
    errors: {
      too_short: "{min}자 이상 입력해 주세요.",
      too_long: "{max}자 이하로 입력해 주세요.",
      contact_info: "닉네임에 이메일 주소나 전화번호를 넣을 수 없어요.",
      link: "닉네임에 링크를 넣을 수 없어요.",
      reserved: "다른 닉네임을 정해 주세요.",
      invalid_chars: "글자, 숫자, 공백, 점(.), 하이픈(-), 밑줄(_)만 쓸 수 있어요.",
      failed: "저장하지 못했어요. 다시 시도해 주세요.",
    },
  },
  mail: {
    welcomeSubject: "WatchDive 출시 알림 신청 완료 · 버디를 초대하세요",
    welcomeHeading: "WatchDive 출시 알림 신청이 완료되었습니다.",
    welcomeIntro:
      "이메일 인증이 완료되었습니다. 아래 내 초대 링크를 함께 다이빙하는 버디에게 보내 주세요. 이메일 인증을 마친 친구가 늘어날수록 혜택이 커집니다.",
    welcomeTiersHeading: "버디 초대 혜택",
    welcomeButton: "내 초대 링크 공유하기",
    welcomeFallback: "링크를 직접 복사하려면:",
    welcomeStatus: "초대 현황 확인과 랭킹 닉네임 설정:",
    welcomeRules: "공식 규칙:",
    welcomeOutro: "WatchDive가 Kickstarter에 공개되면 이메일로 알려드리겠습니다.",
    noticeSubject: "내 링크로 버디가 참여했어요 (지금까지 {count}명)",
    noticeHeading: "내 링크로 버디가 참여했어요",
    noticeBody: "지금까지 {count}명이 내 링크로 참여해 이메일 인증까지 마쳤어요.",
    noticeTierReached: "{tier} 달성! {reward}",
    noticeNext: "{tier}까지 {remaining}명 남았어요.",
    noticeMax: "모든 단계를 달성했어요. 랭킹 Top {winners}에 계속 도전해 보세요.",
    noticeButton: "내 초대 현황 보기",
    noticeFooter: "이 알림은 초대 현황 페이지에서 끌 수 있어요.",
  },
  rules: {
    title: "버디 초대 공식 규칙",
    updated: "최종 수정: 2026년 10월 22일",
    sections: [
      {
        heading: "주최",
        paragraphs: [
          "버디 초대는 WatchDive를 만드는 DIVEROID LTD(영국)가 운영합니다. 문의: help@diveroid.com",
        ],
      },
      {
        heading: "기간",
        paragraphs: [
          "2026년 10월 22일에 시작해 WatchDive 킥스타터 캠페인이 공개되기 직전에 마감합니다. 캠페인은 2026년 12월에 공개할 예정이며, 정확한 마감 시각은 최소 {noticeDays}일 전에 이 페이지와 이메일로 알려드립니다.",
        ],
      },
      {
        heading: "참여 방법",
        paragraphs: [
          "WatchDive 출시 알림을 신청하고 이메일을 인증하면 내 초대 링크가 생깁니다. 친구가 내 링크로 들어와 알림을 신청하고 이메일 인증까지 마치면 1명으로 집계됩니다.",
          "참여와 당첨에 구매나 킥스타터 후원 조건은 없습니다. 얼리버드 가격 링크는 캠페인을 후원하기로 했을 때 사용합니다.",
        ],
      },
      {
        heading: "집계 기준",
        paragraphs: [
          "이메일 인증을 마친 친구만 집계합니다. 본인의 다른 주소, 같은 사람의 중복 가입, 일회용 이메일, 부정 가입으로 표시된 가입은 집계하지 않습니다.",
          "한 사람당 하루 최대 {cap}명까지 집계합니다(한국 시간 기준). 마감 시각 이후에 인증한 친구는 집계하지 않습니다.",
        ],
      },
      {
        heading: "혜택",
        paragraphs: [
          "1명: 킥스타터 오픈 소식을 일반 명단보다 {hoursFirst}시간 먼저 이메일로 받습니다.",
          "3명(버디): 오픈 소식을 일반 명단보다 {hoursBuddy}시간 먼저 받습니다.",
          "5명(다이브 팀): 선착순 {seats}명이 마감된 뒤에도 얼리버드 가격 {price}로 후원할 수 있는 킥스타터 전용 리워드 링크를 받습니다.",
          "10명(다이브 리더): 수중 라이트 1개를 받습니다. 준비된 수량은 {stock}개이며, 10명을 먼저 달성한 {stock}명에게 달성 순서대로 드립니다. 모두 소진되면 이 페이지에 알립니다.",
          "Top {winners}: 마감 시각 기준 집계된 친구가 가장 많은 {winners}명에게 WatchDive를 1개씩 드립니다. 집계 수가 같으면 그 수에 먼저 도달한 분이 앞섭니다.",
        ],
      },
      {
        heading: "검수와 실격",
        paragraphs: [
          "수중 라이트와 WatchDive를 보내기 전에 집계된 친구를 검수합니다. 규칙에 맞지 않는 가입은 집계에서 빼고, 가짜 또는 자동화된 가입을 이용한 경우 실격 처리할 수 있습니다. 당첨자에게는 이메일로 연락드리며, 14일 안에 회신이 없으면 다음 순서의 분에게 혜택이 넘어갑니다.",
        ],
      },
      {
        heading: "배송과 제세공과금",
        paragraphs: [
          "배송비와 세금·관세 등 제세공과금은 받는 분이 부담합니다. 한국에서는 경품에 대한 기타소득세 원천징수가 적용될 수 있습니다. 배송은 WatchDive 킥스타터 캠페인의 배송 대상 국가로만 가능합니다. 수중 라이트는 검수 후 발송하며, WatchDive 경품은 후원자 배송 시점에 함께 발송합니다.",
        ],
      },
      {
        heading: "랭킹과 개인정보",
        paragraphs: [
          "랭킹에는 본인이 정하고 공개를 선택한 닉네임만 표시합니다. 이메일 주소는 절대 공개하지 않습니다. 닉네임 공개를 선택하지 않은 분은 ‘비공개 다이버’로 표시됩니다. 불쾌하거나 타인을 사칭하는 닉네임은 숨길 수 있습니다.",
          "초대한 친구가 누구인지는 알려드리지 않고, 참여한 인원수만 알려드립니다. 대기 명단 정보 처리는 개인정보 처리방침을 따릅니다.",
        ],
      },
      {
        heading: "변경",
        paragraphs: [
          "프로그램을 변경하거나 종료해야 하는 경우 이 페이지와 이메일로 먼저 알려드립니다. 변경 전에 이미 달성한 혜택은 유지됩니다.",
        ],
      },
    ],
  },
};

/** Locales still English are replaced by the translation task. */
export const REFERRAL_COPY: Record<Locale, ReferralCopy> = {
  en,
  ko,
  "zh-CN": en,
  "zh-TW": en,
  ja: en,
  es: en,
  fr: en,
  de: en,
  "pt-BR": en,
};

export function referralCopy(locale: Locale): ReferralCopy {
  return REFERRAL_COPY[locale] ?? en;
}

/** Fill {placeholders}; unknown keys are left visible so tests catch them. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
