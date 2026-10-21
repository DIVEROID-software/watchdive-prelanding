// Buddy Invite copy for every surface: landing card, leaderboard, status page,
// mails and the official rules. Numbers are interpolated from program.ts only
// ({placeholders}); never type a threshold, stock, price or hour count here.
//
// Placeholders: {count} {remaining} {tier} {hours} {price} {seats} {stock}
// {winners} {cap} {noticeDays} {min} {max} {hoursFirst} {hoursBuddy} {nickname}
// {time} {reward} {closeDate}
//
// ko and en are the reviewed source; the other seven locales are translations
// of them (tests/referralCopy.test.ts checks keys, placeholders and claim words).

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
    lightEligible:
      "You are among the first {stock} Dive Leaders. We will contact you about your underwater light.",
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
    noticeBody: "Friends who joined through your link and confirmed their email: {count}.",
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

const zhCN: ReferralCopy = {
  programName: "潜伴邀请",
  tiers: {
    first: {
      name: "首次邀请 · 1 位朋友",
      reward: "比普通名单提前 {hours} 小时收到 Kickstarter 上线邮件。",
    },
    buddy: {
      name: "潜伴 · 3 位朋友",
      reward: "比普通名单提前 {hours} 小时收到 Kickstarter 上线邮件。",
    },
    team: {
      name: "潜水小队 · 5 位朋友",
      reward:
        "保留 {price} 的早鸟价：获得 Kickstarter 专属奖励链接，即使前 {seats} 名支持者的名额已满，也能用它支持。",
    },
    leader: {
      name: "潜水队长 · 10 位朋友",
      reward:
        "免费获赠 1 个水下灯。库存 {stock} 个，按达到 10 位朋友的先后顺序发放。运费和税费由收件人承担。",
    },
  },
  top: {
    name: "邀请榜前 {winners} 名",
    reward:
      "Kickstarter 众筹上线时，已验证朋友最多的 {winners} 位，各获赠一台 WatchDive。运费和税费由收件人承担。",
  },
  countingNote: "只有确认了邮箱的朋友才会计入。",
  card: {
    title: "邀请你的潜伴",
    body: "把你的链接发出去。每多一位确认邮箱的朋友，奖励就更进一步。",
    progress: "已有 {count} 位加入 · 再邀请 {remaining} 位达到“{tier}”",
    progressNone: "还没有朋友加入 · 再邀请 {remaining} 位达到“{tier}”",
    progressMax: "已有 {count} 位加入 · 所有等级都已达成。冲击前 {winners} 名吧。",
    statusLink: "查看我的邀请",
    rulesLink: "官方规则",
  },
  leaderboard: {
    title: "潜伴邀请前 {winners} 名",
    subtitle: "仅统计已验证的朋友 · 截至 {time}",
    entry: "{count} 位朋友",
    privateDiver: "匿名潜水员",
    empty: "榜单上还没有人。你的第一次邀请，说不定就能让你上榜。",
    closed: "潜伴邀请活动已结束，正在审核获奖者。",
    rulesLink: "官方规则",
  },
  status: {
    title: "我的潜伴邀请",
    countLabel: "已加入的朋友",
    tierLabel: "当前等级",
    tierNone: "暂无",
    rankLabel: "排行榜名次",
    rankNone: "暂未上榜",
    earlyNotice: "你将提前 {hours} 小时收到 Kickstarter 上线邮件。",
    lightEligible: "你已位列前 {stock} 位潜水队长之中，我们会就水下灯与你联系。",
    lightGone: "{stock} 个水下灯已全部送出。",
    shareTitle: "你的邀请链接",
    nicknameLabel: "排行榜昵称",
    nicknameHelp: "{min}–{max} 个字符。不能包含邮箱地址、电话号码或链接。",
    nicknameHiddenNote: "这个昵称已被我们的团队隐藏，请另选一个。",
    leaderboardToggle: "在前 {winners} 名排行榜上显示我的昵称",
    noticesToggle: "有朋友加入时，用邮件通知我",
    save: "保存",
    saving: "保存中…",
    saved: "已保存",
    invalidLink: "这个链接无效。请打开 WatchDive 邮件中最新的链接。",
    errors: {
      too_short: "至少需要 {min} 个字符。",
      too_long: "最多 {max} 个字符。",
      contact_info: "昵称不能包含邮箱地址或电话号码。",
      link: "昵称不能包含链接。",
      reserved: "请换一个昵称。",
      invalid_chars: "只能使用字母、数字、空格、点、连字符或下划线。",
      failed: "保存失败，请再试一次。",
    },
  },
  mail: {
    welcomeSubject: "您已加入 WatchDive 候补名单 — 邀请您的潜伴",
    welcomeHeading: "您已加入 WatchDive 候补名单",
    welcomeIntro:
      "邮箱已确认。请把您的专属邀请链接发给一起潜水的朋友。每多一位确认邮箱的朋友，奖励就更进一步。",
    welcomeTiersHeading: "潜伴邀请奖励",
    welcomeButton: "分享我的邀请链接",
    welcomeFallback: "也可以复制此链接：",
    welcomeStatus: "查看邀请进度，并设置排行榜昵称：",
    welcomeRules: "官方规则：",
    welcomeOutro: "WatchDive 在 Kickstarter 上线时，我们会通过邮件通知您。",
    noticeSubject: "有潜伴通过您的链接加入了（目前共 {count} 位）",
    noticeHeading: "有潜伴通过您的链接加入了",
    noticeBody: "已有 {count} 位朋友通过您的链接加入，并确认了邮箱。",
    noticeTierReached: "您已达成“{tier}”：{reward}",
    noticeNext: "再邀请 {remaining} 位，即可达到“{tier}”。",
    noticeMax: "所有等级都已达成。继续冲击前 {winners} 名吧。",
    noticeButton: "查看我的邀请",
    noticeFooter: "您可以在邀请页面关闭这些邮件。",
  },
  rules: {
    title: "潜伴邀请官方规则",
    updated: "最后更新：2026 年 10 月 22 日",
    sections: [
      {
        heading: "主办方",
        paragraphs: [
          "潜伴邀请由 WatchDive 的制造商 DIVEROID LTD（英国）运营。咨询请联系：help@diveroid.com。",
        ],
      },
      {
        heading: "活动期间",
        paragraphs: [
          "活动自 2026 年 10 月 22 日开始，在 WatchDive 的 Kickstarter 众筹上线前一刻结束。众筹计划于 2026 年 12 月上线。我们会至少提前 {noticeDays} 天，在本页面并通过邮件公布确切的截止时间。",
        ],
      },
      {
        heading: "参与方式",
        paragraphs: [
          "加入 WatchDive 候补名单并确认邮箱，即可获得您的专属邀请链接。朋友打开您的链接、加入候补名单并确认邮箱后，就会计入您的邀请数。",
          "参与或获奖都无需购买，也无需在 Kickstarter 上支持。早鸟价链接只在您自己决定支持众筹时使用。",
        ],
      },
      {
        heading: "计入规则",
        paragraphs: [
          "只有确认了邮箱的朋友才会计入。您自己的其他邮箱、同一个人的重复报名、一次性邮箱，以及被标记为滥用的报名，均不计入。",
          "每人每天最多计入 {cap} 位朋友（以韩国标准时间为准）。在截止时间之后才确认的朋友不计入。",
        ],
      },
      {
        heading: "奖励",
        paragraphs: [
          "1 位朋友：比普通名单提前 {hoursFirst} 小时收到 Kickstarter 上线邮件。",
          "3 位朋友（潜伴）：比普通名单提前 {hoursBuddy} 小时收到上线邮件。",
          "5 位朋友（潜水小队）：获得一个 Kickstarter 专属奖励链接，保留 {price} 的早鸟价，即使前 {seats} 名支持者的名额已满也可使用。",
          "10 位朋友（潜水队长）：免费获赠 1 个水下灯。共 {stock} 个，发给最先达到 10 位朋友的前 {stock} 人，并按达到的先后顺序发放。发完后，我们会在本页面说明。",
          "前 {winners} 名：截止时间时计入朋友数最多的 {winners} 位，各获赠一台 WatchDive。若人数相同，先达到该人数者排名靠前。",
        ],
      },
      {
        heading: "审核与取消资格",
        paragraphs: [
          "在寄出任何水下灯或 WatchDive 之前，我们都会审核计入的朋友。我们可能剔除违反本规则的朋友，并取消使用虚假或自动化报名者的资格。我们会通过邮件联系获奖者。如果获奖者在 14 天内没有回复，奖励将顺延给排在后面的下一位。",
        ],
      },
      {
        heading: "配送、运费与税费",
        paragraphs: [
          "收件人需承担运费以及任何税费或关税，其中包括适用情况下韩国对奖品征收的预扣税。我们只寄送到 WatchDive Kickstarter 众筹支持寄送的国家和地区。水下灯在审核后寄出。WatchDive 奖品会在 WatchDive 向支持者发货时寄出。",
        ],
      },
      {
        heading: "排行榜与隐私",
        paragraphs: [
          "排行榜只显示您自己设置并选择公开的昵称，绝不会显示您的邮箱地址。没有选择公开昵称的人，会显示为“匿名潜水员”。对于带有冒犯性或冒充他人的昵称，我们可能会将其隐藏。",
          "我们不会告诉您朋友是谁，只告知有多少位加入。我们如何处理候补名单数据，请参阅隐私政策。",
        ],
      },
      {
        heading: "变更",
        paragraphs: [
          "如果我们必须变更或终止本活动，会先在本页面并通过邮件公布。变更之前已经达成的奖励予以保留。",
        ],
      },
    ],
  },
};

const zhTW: ReferralCopy = {
  programName: "潛伴邀請",
  tiers: {
    first: {
      name: "首次邀請 · 1 位朋友",
      reward: "比一般名單提前 {hours} 小時收到 Kickstarter 開跑通知信。",
    },
    buddy: {
      name: "潛伴 · 3 位朋友",
      reward: "比一般名單提前 {hours} 小時收到 Kickstarter 開跑通知信。",
    },
    team: {
      name: "潛水小隊 · 5 位朋友",
      reward:
        "保留 {price} 的早鳥價：取得 Kickstarter 專屬回饋連結，即使前 {seats} 名贊助者的名額已滿，也能用它贊助。",
    },
    leader: {
      name: "潛水隊長 · 10 位朋友",
      reward:
        "免費獲贈 1 盞水下燈。庫存 {stock} 盞，依達到 10 位朋友的先後順序發送。運費與稅費由收件人負擔。",
    },
  },
  top: {
    name: "邀請榜前 {winners} 名",
    reward:
      "Kickstarter 募資開跑時，已驗證朋友最多的 {winners} 位，各獲贈一支 WatchDive。運費與稅費由收件人負擔。",
  },
  countingNote: "只有確認了信箱的朋友才會計入。",
  card: {
    title: "邀請你的潛伴",
    body: "把你的連結傳出去。每多一位確認信箱的朋友，獎勵就更進一步。",
    progress: "已有 {count} 位加入 · 再邀請 {remaining} 位達到「{tier}」",
    progressNone: "還沒有朋友加入 · 再邀請 {remaining} 位達到「{tier}」",
    progressMax: "已有 {count} 位加入 · 所有等級都已達成。衝刺前 {winners} 名吧。",
    statusLink: "查看我的邀請",
    rulesLink: "官方規則",
  },
  leaderboard: {
    title: "潛伴邀請前 {winners} 名",
    subtitle: "僅統計已驗證的朋友 · 截至 {time}",
    entry: "{count} 位朋友",
    privateDiver: "匿名潛水員",
    empty: "排行榜上還沒有人。你的第一次邀請，說不定就能讓你上榜。",
    closed: "潛伴邀請活動已結束，正在審核得獎者。",
    rulesLink: "官方規則",
  },
  status: {
    title: "我的潛伴邀請",
    countLabel: "已加入的朋友",
    tierLabel: "目前等級",
    tierNone: "尚無",
    rankLabel: "排行榜名次",
    rankNone: "尚未上榜",
    earlyNotice: "你將提前 {hours} 小時收到 Kickstarter 開跑通知信。",
    lightEligible: "你已名列前 {stock} 位潛水隊長之中，我們會就水下燈與你聯絡。",
    lightGone: "{stock} 盞水下燈已全數送出。",
    shareTitle: "你的邀請連結",
    nicknameLabel: "排行榜暱稱",
    nicknameHelp: "{min}–{max} 個字元。不能包含電子郵件地址、電話號碼或連結。",
    nicknameHiddenNote: "這個暱稱已被我們的團隊隱藏，請另選一個。",
    leaderboardToggle: "在前 {winners} 名排行榜上顯示我的暱稱",
    noticesToggle: "有朋友加入時，用電子郵件通知我",
    save: "儲存",
    saving: "儲存中…",
    saved: "已儲存",
    invalidLink: "這個連結無效。請開啟 WatchDive 信件中最新的連結。",
    errors: {
      too_short: "至少需要 {min} 個字元。",
      too_long: "最多 {max} 個字元。",
      contact_info: "暱稱不能包含電子郵件地址或電話號碼。",
      link: "暱稱不能包含連結。",
      reserved: "請換一個暱稱。",
      invalid_chars: "只能使用字母、數字、空格、句點、連字號或底線。",
      failed: "儲存失敗，請再試一次。",
    },
  },
  mail: {
    welcomeSubject: "您已加入 WatchDive 等候名單 — 邀請您的潛伴",
    welcomeHeading: "您已加入 WatchDive 等候名單",
    welcomeIntro:
      "電子郵件已確認。請把您的專屬邀請連結傳給一起潛水的朋友。每多一位確認信箱的朋友，獎勵就更進一步。",
    welcomeTiersHeading: "潛伴邀請獎勵",
    welcomeButton: "分享我的邀請連結",
    welcomeFallback: "也可以複製此連結：",
    welcomeStatus: "查看邀請進度，並設定排行榜暱稱：",
    welcomeRules: "官方規則：",
    welcomeOutro: "WatchDive 在 Kickstarter 上線時，我們會寄信通知您。",
    noticeSubject: "有潛伴透過您的連結加入了（目前共 {count} 位）",
    noticeHeading: "有潛伴透過您的連結加入了",
    noticeBody: "已有 {count} 位朋友透過您的連結加入，並確認了信箱。",
    noticeTierReached: "您已達成「{tier}」：{reward}",
    noticeNext: "再邀請 {remaining} 位，即可達到「{tier}」。",
    noticeMax: "所有等級都已達成。繼續衝刺前 {winners} 名吧。",
    noticeButton: "查看我的邀請",
    noticeFooter: "您可以在邀請頁面關閉這些通知信。",
  },
  rules: {
    title: "潛伴邀請官方規則",
    updated: "最後更新：2026 年 10 月 22 日",
    sections: [
      {
        heading: "主辦單位",
        paragraphs: [
          "潛伴邀請由 WatchDive 的製造商 DIVEROID LTD（英國）營運。洽詢請聯絡：help@diveroid.com。",
        ],
      },
      {
        heading: "活動期間",
        paragraphs: [
          "活動自 2026 年 10 月 22 日開始，在 WatchDive 的 Kickstarter 募資上線前一刻結束。募資預計於 2026 年 12 月上線。我們會至少提前 {noticeDays} 天，在本頁面並透過電子郵件公布確切的截止時間。",
        ],
      },
      {
        heading: "參加方式",
        paragraphs: [
          "加入 WatchDive 等候名單並確認信箱，即可取得您的專屬邀請連結。朋友開啟您的連結、加入等候名單並確認信箱後，就會計入您的邀請數。",
          "參加或得獎都不需要購買，也不需要在 Kickstarter 上贊助。早鳥價連結只在您自己決定贊助募資時使用。",
        ],
      },
      {
        heading: "計入規則",
        paragraphs: [
          "只有確認了信箱的朋友才會計入。您自己的其他信箱、同一個人的重複登記、拋棄式電子郵件，以及被標記為濫用的登記，均不計入。",
          "每人每天最多計入 {cap} 位朋友（以韓國標準時間為準）。在截止時間之後才確認的朋友不計入。",
        ],
      },
      {
        heading: "獎勵",
        paragraphs: [
          "1 位朋友：比一般名單提前 {hoursFirst} 小時收到 Kickstarter 開跑通知信。",
          "3 位朋友（潛伴）：比一般名單提前 {hoursBuddy} 小時收到開跑通知信。",
          "5 位朋友（潛水小隊）：取得一個 Kickstarter 專屬回饋連結，保留 {price} 的早鳥價，即使前 {seats} 名贊助者的名額已滿也可使用。",
          "10 位朋友（潛水隊長）：免費獲贈 1 盞水下燈。共 {stock} 盞，送給最先達到 10 位朋友的前 {stock} 人，並依達到的先後順序發送。送完後，我們會在本頁面說明。",
          "前 {winners} 名：截止時間時計入朋友數最多的 {winners} 位，各獲贈一支 WatchDive。若人數相同，先達到該人數者排名在前。",
        ],
      },
      {
        heading: "審核與取消資格",
        paragraphs: [
          "在寄出任何水下燈或 WatchDive 之前，我們都會審核計入的朋友。我們可能剔除違反本規則的朋友，並取消使用虛假或自動化登記者的資格。我們會透過電子郵件聯絡得獎者。如果得獎者在 14 天內沒有回覆，獎勵將順延給排在後面的下一位。",
        ],
      },
      {
        heading: "配送、運費與稅費",
        paragraphs: [
          "收件人須負擔運費以及任何稅費或關稅，其中包括適用情況下韓國對獎品課徵的預扣稅。我們只寄送到 WatchDive Kickstarter 募資支援寄送的國家和地區。水下燈在審核後寄出。WatchDive 獎品會在 WatchDive 向贊助者出貨時寄出。",
        ],
      },
      {
        heading: "排行榜與隱私",
        paragraphs: [
          "排行榜只顯示您自己設定並選擇公開的暱稱，絕不會顯示您的電子郵件地址。沒有選擇公開暱稱的人，會顯示為「匿名潛水員」。對於帶有冒犯性或冒充他人的暱稱，我們可能會將其隱藏。",
          "我們不會告訴您朋友是誰，只告知有多少位加入。我們如何處理等候名單資料，請參閱隱私權政策。",
        ],
      },
      {
        heading: "變更",
        paragraphs: [
          "如果我們必須變更或終止本活動，會先在本頁面並透過電子郵件公布。變更之前已經達成的獎勵予以保留。",
        ],
      },
    ],
  },
};

const ja: ReferralCopy = {
  programName: "バディ招待",
  tiers: {
    first: {
      name: "はじめての招待 · 友だち1人",
      reward: "Kickstarter ローンチのお知らせメールを、一般リストより{hours}時間早く受け取れます。",
    },
    buddy: {
      name: "バディ · 友だち3人",
      reward: "Kickstarter ローンチのお知らせメールを、一般リストより{hours}時間早く受け取れます。",
    },
    team: {
      name: "ダイブチーム · 友だち5人",
      reward:
        "{price}の早割価格をそのまま維持。先着{seats}名の支援枠が終了したあとも、Kickstarter の専用リワードリンクから支援できます。",
    },
    leader: {
      name: "ダイブリーダー · 友だち10人",
      reward:
        "水中ライトを1個プレゼント。在庫は{stock}個で、10人に到達した順にお渡しします。送料と税金は受取人の負担です。",
    },
  },
  top: {
    name: "招待ランキング上位{winners}名",
    reward:
      "Kickstarter キャンペーン公開時点で、確認済みの友だちが最も多い{winners}名に、WatchDive を1台ずつプレゼントします。送料と税金は受取人の負担です。",
  },
  countingNote: "メールアドレスを確認した友だちだけがカウントされます。",
  card: {
    title: "ダイビングバディを招待しよう",
    body: "あなたのリンクを送ってください。メールアドレスを確認した友だちが増えるほど、特典が広がります。",
    progress: "{count}人が参加 · 「{tier}」まであと{remaining}人",
    progressNone: "まだ友だちはいません · 「{tier}」まであと{remaining}人",
    progressMax: "{count}人が参加 · すべての段階に到達しました。上位{winners}名を目指しましょう。",
    statusLink: "招待状況を見る",
    rulesLink: "公式ルール",
  },
  leaderboard: {
    title: "バディ招待 上位{winners}名",
    subtitle: "確認済みの友だちのみ · {time}時点",
    entry: "{count}人",
    privateDiver: "非公開ダイバー",
    empty: "まだランキングに誰もいません。最初の招待で、あなたがここに載るかもしれません。",
    closed: "バディ招待は終了しました。当選者を確認しています。",
    rulesLink: "公式ルール",
  },
  status: {
    title: "バディ招待の状況",
    countLabel: "参加した友だち",
    tierLabel: "現在の段階",
    tierNone: "まだありません",
    rankLabel: "ランキング順位",
    rankNone: "まだランク外です",
    earlyNotice: "Kickstarter ローンチのお知らせメールを{hours}時間早くお届けします。",
    lightEligible:
      "ダイブリーダーの先着{stock}名に入っています。水中ライトについて、改めてご連絡します。",
    lightGone: "水中ライト{stock}個は、すべてお渡し済みです。",
    shareTitle: "あなたの招待リンク",
    nicknameLabel: "ランキングに表示するニックネーム",
    nicknameHelp: "{min}〜{max}文字。メールアドレス、電話番号、リンクは使えません。",
    nicknameHiddenNote:
      "運営がこのニックネームを非表示にしました。別のニックネームを選んでください。",
    leaderboardToggle: "上位{winners}名のランキングにニックネームを表示する",
    noticesToggle: "友だちが参加したらメールで知らせる",
    save: "保存",
    saving: "保存中…",
    saved: "保存しました",
    invalidLink: "このリンクは無効です。WatchDive からの最新のメールのリンクを開いてください。",
    errors: {
      too_short: "{min}文字以上で入力してください。",
      too_long: "{max}文字以内で入力してください。",
      contact_info: "ニックネームにメールアドレスや電話番号は使えません。",
      link: "ニックネームにリンクは使えません。",
      reserved: "別のニックネームを選んでください。",
      invalid_chars: "使えるのは、文字、数字、スペース、ドット、ハイフン、アンダースコアです。",
      failed: "保存できませんでした。もう一度お試しください。",
    },
  },
  mail: {
    welcomeSubject: "WatchDiveウェイトリストに登録されました — バディを招待しましょう",
    welcomeHeading: "WatchDiveウェイトリストに登録されました",
    welcomeIntro:
      "メールアドレスの確認が完了しました。あなた専用の招待リンクを、一緒に潜るダイバーに送ってください。メールアドレスを確認した友だちが増えるほど、特典が広がります。",
    welcomeTiersHeading: "バディ招待の特典",
    welcomeButton: "招待リンクをシェアする",
    welcomeFallback: "リンクをコピーする場合：",
    welcomeStatus: "招待状況の確認と、ランキング用ニックネームの設定：",
    welcomeRules: "公式ルール：",
    welcomeOutro: "WatchDiveがKickstarterで公開される際に、メールでお知らせします。",
    noticeSubject: "バディがあなたのリンクから参加しました（これまでに{count}人）",
    noticeHeading: "バディがあなたのリンクから参加しました",
    noticeBody: "あなたのリンクから{count}人の友だちが参加し、メールアドレスを確認しました。",
    noticeTierReached: "「{tier}」に到達しました：{reward}",
    noticeNext: "「{tier}」まであと{remaining}人です。",
    noticeMax: "すべての段階に到達しました。上位{winners}名を目指して続けましょう。",
    noticeButton: "招待状況を見る",
    noticeFooter: "このメールは、招待ページでオフにできます。",
  },
  rules: {
    title: "バディ招待 公式ルール",
    updated: "最終更新：2026年10月22日",
    sections: [
      {
        heading: "主催者",
        paragraphs: [
          "バディ招待は、WatchDive を開発する DIVEROID LTD（英国）が運営しています。お問い合わせ：help@diveroid.com",
        ],
      },
      {
        heading: "期間",
        paragraphs: [
          "プログラムは2026年10月22日に始まり、WatchDive の Kickstarter キャンペーンが公開される直前に終了します。キャンペーンは2026年12月の公開を予定しています。正確な終了時刻は、少なくとも{noticeDays}日前までに、このページとメールでお知らせします。",
        ],
      },
      {
        heading: "参加方法",
        paragraphs: [
          "WatchDive のウェイトリストに登録し、メールアドレスを確認すると、あなた専用の招待リンクが発行されます。友だちがあなたのリンクを開き、ウェイトリストに登録してメールアドレスを確認すると、あなたの招待数に加わります。",
          "参加や当選に、購入や Kickstarter での支援は必要ありません。早割価格のリンクは、キャンペーンを支援すると決めたときにお使いいただくものです。",
        ],
      },
      {
        heading: "カウント対象",
        paragraphs: [
          "メールアドレスを確認した友だちだけがカウントされます。ご自身の別のアドレス、同一人物による重複登録、使い捨てメールアドレス、不正と判断された登録はカウントされません。",
          "1人につき1日あたり最大{cap}人までカウントされます（韓国標準時）。終了時刻より後に確認した友だちはカウントされません。",
        ],
      },
      {
        heading: "特典",
        paragraphs: [
          "友だち1人：Kickstarter ローンチのお知らせメールを、一般リストより{hoursFirst}時間早く受け取れます。",
          "友だち3人（バディ）：ローンチのお知らせメールを、一般リストより{hoursBuddy}時間早く受け取れます。",
          "友だち5人（ダイブチーム）：先着{seats}名の支援枠が終了したあとも、{price}の早割価格で支援できる Kickstarter の専用リワードリンクを受け取れます。",
          "友だち10人（ダイブリーダー）：水中ライトを1個プレゼントします。在庫は{stock}個で、10人に最初に到達した{stock}名に、到達した順にお渡しします。なくなった場合は、このページでお知らせします。",
          "上位{winners}名：終了時刻の時点でカウントされた友だちが最も多い{winners}名に、WatchDive を1台ずつプレゼントします。人数が同じ場合は、先にその人数に到達した方が上位になります。",
        ],
      },
      {
        heading: "審査と失格",
        paragraphs: [
          "水中ライトや WatchDive を発送する前に、カウントされた友だちを審査します。ルールに反する友だちはカウントから外すことがあり、偽の登録や自動化された登録を使った方は失格となる場合があります。当選者にはメールでご連絡します。14日以内にご返信がない場合、特典は順位が次の方に移ります。",
        ],
      },
      {
        heading: "配送・送料・税金",
        paragraphs: [
          "送料と、関税を含む各種税金は受取人の負担です。韓国では、賞品に対する源泉徴収税が適用される場合があります。発送先は、WatchDive の Kickstarter キャンペーンが発送に対応している国に限ります。水中ライトは審査後に発送します。賞品の WatchDive は、支援者への発送時に合わせて発送します。",
        ],
      },
      {
        heading: "ランキングとプライバシー",
        paragraphs: [
          "ランキングに表示されるのは、ご自身で設定し、表示を選んだニックネームだけです。メールアドレスが表示されることはありません。ニックネームの表示を選ばなかった方は「非公開ダイバー」と表示されます。不適切なニックネームや、他人になりすましたニックネームは、非表示にすることがあります。",
          "どの友だちが参加したかはお知らせせず、参加した人数のみお知らせします。ウェイトリストのデータの取り扱いについては、プライバシーポリシーをご覧ください。",
        ],
      },
      {
        heading: "変更",
        paragraphs: [
          "プログラムを変更または終了する必要がある場合は、事前にこのページとメールでお知らせします。変更前にすでに達成した特典は維持されます。",
        ],
      },
    ],
  },
};

const es: ReferralCopy = {
  programName: "Invitación de compañeros",
  tiers: {
    first: {
      name: "Primera invitación · 1 amigo",
      reward:
        "Recibe el correo de lanzamiento de Kickstarter {hours} hora antes que la lista general.",
    },
    buddy: {
      name: "Compañero · 3 amigos",
      reward:
        "Recibe el correo de lanzamiento de Kickstarter {hours} horas antes que la lista general.",
    },
    team: {
      name: "Equipo de buceo · 5 amigos",
      reward:
        "Conserva el precio early bird de {price} con un enlace de recompensa privado de Kickstarter, incluso cuando ya no queden los primeros {seats} patrocinadores.",
    },
    leader: {
      name: "Líder de buceo · 10 amigos",
      reward:
        "Consigue una luz subacuática gratis. Hay {stock} en stock y se entregan por orden de llegada a los 10 amigos. El envío y los impuestos los paga quien la recibe.",
    },
  },
  top: {
    name: "Top {winners} de invitaciones",
    reward:
      "Cuando la campaña de Kickstarter salga en directo, las {winners} personas con más amigos verificados reciben un WatchDive cada una. El envío y los impuestos los paga quien lo recibe.",
  },
  countingNote: "Solo cuentan los amigos que confirman su correo.",
  card: {
    title: "Invita a tus compañeros de buceo",
    body: "Envía tu enlace. Las recompensas crecen con cada amigo que confirma su correo.",
    progress: "Amigos unidos: {count} · {remaining} más para {tier}",
    progressNone: "Aún no se ha unido nadie · {remaining} más para {tier}",
    progressMax:
      "Amigos unidos: {count} · has alcanzado todos los niveles. Ve a por el top {winners}.",
    statusLink: "Ver mis invitaciones",
    rulesLink: "Reglas oficiales",
  },
  leaderboard: {
    title: "Top {winners} de Invitación de compañeros",
    subtitle: "Solo amigos verificados · a {time}",
    entry: "Amigos: {count}",
    privateDiver: "Buceador anónimo",
    empty: "Todavía no hay nadie en la clasificación. Tu primera invitación podría ponerte aquí.",
    closed: "El concurso Invitación de compañeros ha terminado. Estamos revisando a los ganadores.",
    rulesLink: "Reglas oficiales",
  },
  status: {
    title: "Mi Invitación de compañeros",
    countLabel: "Amigos que se han unido",
    tierLabel: "Nivel actual",
    tierNone: "Todavía ninguno",
    rankLabel: "Puesto en la clasificación",
    rankNone: "Aún sin puesto",
    earlyNotice: "Recibirás el correo de lanzamiento de Kickstarter con {hours} h de antelación.",
    lightEligible:
      "Estás entre los primeros {stock} Líderes de buceo. Te escribiremos sobre tu luz subacuática.",
    lightGone: "Ya se han entregado las {stock} luces subacuáticas.",
    shareTitle: "Tu enlace de invitación",
    nicknameLabel: "Apodo para la clasificación",
    nicknameHelp: "De {min} a {max} caracteres. Sin direcciones de correo, teléfonos ni enlaces.",
    nicknameHiddenNote: "Nuestro equipo ha ocultado este apodo. Elige otro, por favor.",
    leaderboardToggle: "Mostrar mi apodo en la clasificación del top {winners}",
    noticesToggle: "Avisarme por correo cuando se una un amigo",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    invalidLink: "Este enlace no es válido. Abre el enlace más reciente de tu correo de WatchDive.",
    errors: {
      too_short: "Usa al menos {min} caracteres.",
      too_long: "Usa como máximo {max} caracteres.",
      contact_info: "Un apodo no puede contener una dirección de correo ni un teléfono.",
      link: "Un apodo no puede contener un enlace.",
      reserved: "Elige otro apodo, por favor.",
      invalid_chars: "Usa letras, números, espacios, puntos, guiones o guiones bajos.",
      failed: "No se pudo guardar. Inténtalo de nuevo.",
    },
  },
  mail: {
    welcomeSubject: "Ya estás en la lista de espera de WatchDive — invita a tus compañeros",
    welcomeHeading: "Ya estás en la lista de espera de WatchDive",
    welcomeIntro:
      "Tu correo está confirmado. Envía tu enlace de invitación personal a las personas con las que buceas. Las recompensas crecen con cada amigo que confirma su correo.",
    welcomeTiersHeading: "Recompensas de Invitación de compañeros",
    welcomeButton: "Compartir mi enlace de invitación",
    welcomeFallback: "O copia este enlace:",
    welcomeStatus: "Consulta tus invitaciones y elige un apodo para la clasificación:",
    welcomeRules: "Reglas oficiales:",
    welcomeOutro: "Te avisaremos por correo cuando WatchDive se publique en Kickstarter.",
    noticeSubject: "Un compañero se ha unido con tu enlace ({count} en total)",
    noticeHeading: "Un compañero se ha unido con tu enlace",
    noticeBody: "Amigos que se han unido con tu enlace y han confirmado su correo: {count}.",
    noticeTierReached: "Has alcanzado {tier}: {reward}",
    noticeNext: "Para {tier}: {remaining} más.",
    noticeMax: "Has alcanzado todos los niveles. Sigue a por el top {winners}.",
    noticeButton: "Ver mis invitaciones",
    noticeFooter: "Puedes desactivar estos correos en tu página de invitaciones.",
  },
  rules: {
    title: "Reglas oficiales de Invitación de compañeros",
    updated: "Última actualización: 22 de octubre de 2026",
    sections: [
      {
        heading: "Organizador",
        paragraphs: [
          "Invitación de compañeros la organiza DIVEROID LTD (Reino Unido), la empresa que fabrica WatchDive. Consultas: help@diveroid.com.",
        ],
      },
      {
        heading: "Periodo",
        paragraphs: [
          "El programa empieza el 22 de octubre de 2026 y termina justo antes de que la campaña de WatchDive en Kickstarter salga en directo. La campaña está prevista para diciembre de 2026. Anunciaremos la hora exacta de cierre en esta página y por correo con al menos {noticeDays} días de antelación.",
        ],
      },
      {
        heading: "Cómo participar",
        paragraphs: [
          "Únete a la lista de espera de WatchDive y confirma tu correo. Recibirás un enlace de invitación personal. Un amigo cuenta para ti cuando abre tu enlace, se une a la lista de espera y confirma su correo.",
          "No hace falta comprar nada ni apoyar la campaña de Kickstarter para participar ni para ganar. El enlace del precio early bird se usa cuando decides apoyar la campaña.",
        ],
      },
      {
        heading: "Qué cuenta",
        paragraphs: [
          "Solo cuentan los amigos que confirman su correo. No cuentan tus propias direcciones, los registros repetidos de una misma persona, las direcciones de correo desechables ni los registros marcados como abusivos.",
          "Se cuentan como máximo {cap} amigos por persona y día (hora estándar de Corea). Los amigos que confirmen después de la hora de cierre no cuentan.",
        ],
      },
      {
        heading: "Recompensas",
        paragraphs: [
          "1 amigo: el correo de lanzamiento de Kickstarter {hoursFirst} hora antes que la lista general.",
          "3 amigos (Compañero): el correo de lanzamiento {hoursBuddy} horas antes que la lista general.",
          "5 amigos (Equipo de buceo): un enlace de recompensa privado de Kickstarter con el precio early bird de {price}, disponible incluso cuando ya no queden los primeros {seats} patrocinadores.",
          "10 amigos (Líder de buceo): una luz subacuática gratis. Tenemos {stock}. Se entregan a las primeras {stock} personas que lleguen a 10 amigos, por el orden en que lo logren. Cuando se agoten, lo indicaremos en esta página.",
          "Top {winners}: las {winners} personas con más amigos contados a la hora de cierre reciben un WatchDive cada una. Si dos personas tienen la misma cifra, queda por delante quien la alcanzó antes.",
        ],
      },
      {
        heading: "Revisión y descalificación",
        paragraphs: [
          "Antes de enviar cualquier luz o WatchDive, revisamos a los amigos contados. Podemos retirar a los amigos que incumplan estas reglas y descalificar a quien use registros falsos o automatizados. Contactamos con los ganadores por correo. Si un ganador no responde en 14 días, la recompensa pasa a la siguiente persona por orden.",
        ],
      },
      {
        heading: "Entrega, envío e impuestos",
        paragraphs: [
          "Quien recibe el premio paga el envío y cualquier impuesto o arancel, incluida la retención fiscal coreana sobre premios cuando corresponda. Solo enviamos a los países a los que envía la campaña de WatchDive en Kickstarter. Las luces subacuáticas se envían tras la revisión. Un premio WatchDive se envía cuando WatchDive se envíe a los patrocinadores.",
        ],
      },
      {
        heading: "Clasificación y privacidad",
        paragraphs: [
          "La clasificación solo muestra un apodo que tú eliges y decides mostrar. Tu correo nunca se muestra. Quienes no deciden mostrar un apodo aparecen como “Buceador anónimo”. Podemos ocultar un apodo ofensivo o que suplante a alguien.",
          "Nunca te decimos quiénes son tus amigos, solo cuántos se han unido. Consulta nuestra política de privacidad para saber cómo tratamos los datos de la lista de espera.",
        ],
      },
      {
        heading: "Cambios",
        paragraphs: [
          "Si tenemos que cambiar o terminar el programa, lo anunciaremos antes aquí y por correo. Las recompensas ya alcanzadas antes de un cambio se mantienen.",
        ],
      },
    ],
  },
};

const fr: ReferralCopy = {
  programName: "Invitation binôme",
  tiers: {
    first: {
      name: "Première invitation · 1 ami",
      reward: "Recevez l’e-mail de lancement Kickstarter {hours} heure avant la liste générale.",
    },
    buddy: {
      name: "Binôme · 3 amis",
      reward: "Recevez l’e-mail de lancement Kickstarter {hours} heures avant la liste générale.",
    },
    team: {
      name: "Équipe de plongée · 5 amis",
      reward:
        "Gardez le tarif early bird de {price} grâce à un lien de récompense Kickstarter privé, même quand les {seats} premiers contributeurs sont déjà passés.",
    },
    leader: {
      name: "Leader de plongée · 10 amis",
      reward:
        "Recevez une lampe sous-marine offerte. {stock} en stock, attribuées dans l’ordre où l’on atteint 10 amis. L’expédition et les taxes sont à la charge du destinataire.",
    },
  },
  top: {
    name: "Top {winners} des invitations",
    reward:
      "À l’ouverture de la campagne Kickstarter, les {winners} personnes qui comptent le plus d’amis vérifiés reçoivent chacune un WatchDive. L’expédition et les taxes sont à la charge du destinataire.",
  },
  countingNote: "Seuls les amis qui confirment leur e-mail comptent.",
  card: {
    title: "Invitez vos binômes de plongée",
    body: "Envoyez votre lien. Les récompenses grandissent avec chaque ami qui confirme son e-mail.",
    progress: "Amis inscrits : {count} · encore {remaining} pour {tier}",
    progressNone: "Aucun ami pour l’instant · encore {remaining} pour {tier}",
    progressMax:
      "Amis inscrits : {count} · tous les paliers sont atteints. Visez le top {winners}.",
    statusLink: "Voir mes invitations",
    rulesLink: "Règlement officiel",
  },
  leaderboard: {
    title: "Top {winners} de l’Invitation binôme",
    subtitle: "Amis vérifiés uniquement · au {time}",
    entry: "Amis : {count}",
    privateDiver: "Plongeur anonyme",
    empty: "Personne n’est encore au classement. Votre première invitation pourrait vous y placer.",
    closed: "Le concours Invitation binôme est terminé. Nous examinons les gagnants.",
    rulesLink: "Règlement officiel",
  },
  status: {
    title: "Mon Invitation binôme",
    countLabel: "Amis inscrits",
    tierLabel: "Palier actuel",
    tierNone: "Aucun pour l’instant",
    rankLabel: "Rang au classement",
    rankNone: "Pas encore classé",
    earlyNotice: "Vous recevrez l’e-mail de lancement Kickstarter {hours} h plus tôt.",
    lightEligible:
      "Vous faites partie des {stock} premiers Leaders de plongée. Nous vous écrirons au sujet de votre lampe sous-marine.",
    lightGone: "Les {stock} lampes sous-marines ont toutes été attribuées.",
    shareTitle: "Votre lien d’invitation",
    nicknameLabel: "Pseudo pour le classement",
    nicknameHelp:
      "De {min} à {max} caractères. Pas d’adresse e-mail, de numéro de téléphone ni de lien.",
    nicknameHiddenNote: "Notre équipe a masqué ce pseudo. Veuillez en choisir un autre.",
    leaderboardToggle: "Afficher mon pseudo dans le classement du top {winners}",
    noticesToggle: "Me prévenir par e-mail quand un ami s’inscrit",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré",
    invalidLink:
      "Ce lien n’est pas valide. Ouvrez le lien le plus récent dans votre e-mail WatchDive.",
    errors: {
      too_short: "Utilisez au moins {min} caractères.",
      too_long: "Utilisez au plus {max} caractères.",
      contact_info: "Un pseudo ne peut pas contenir d’adresse e-mail ni de numéro de téléphone.",
      link: "Un pseudo ne peut pas contenir de lien.",
      reserved: "Veuillez choisir un autre pseudo.",
      invalid_chars:
        "Utilisez des lettres, des chiffres, des espaces, des points, des tirets ou des tirets bas.",
      failed: "Enregistrement impossible. Veuillez réessayer.",
    },
  },
  mail: {
    welcomeSubject: "Vous êtes sur la liste d’attente WatchDive — invitez vos binômes",
    welcomeHeading: "Vous êtes sur la liste d’attente WatchDive",
    welcomeIntro:
      "Votre adresse e-mail est confirmée. Envoyez votre lien d’invitation personnel aux plongeurs avec qui vous plongez. Les récompenses grandissent avec chaque ami qui confirme son e-mail.",
    welcomeTiersHeading: "Récompenses de l’Invitation binôme",
    welcomeButton: "Partager mon lien d’invitation",
    welcomeFallback: "Ou copiez ce lien :",
    welcomeStatus: "Suivez vos invitations et choisissez un pseudo pour le classement :",
    welcomeRules: "Règlement officiel :",
    welcomeOutro: "Nous vous préviendrons par e-mail lorsque WatchDive sera lancé sur Kickstarter.",
    noticeSubject: "Un binôme a rejoint via votre lien (total : {count})",
    noticeHeading: "Un binôme a rejoint via votre lien",
    noticeBody: "Amis ayant rejoint via votre lien et confirmé leur e-mail : {count}.",
    noticeTierReached: "Vous avez atteint {tier} : {reward}",
    noticeNext: "Pour {tier} : encore {remaining}.",
    noticeMax: "Tous les paliers sont atteints. Continuez vers le top {winners}.",
    noticeButton: "Voir mes invitations",
    noticeFooter: "Vous pouvez désactiver ces e-mails depuis votre page d’invitations.",
  },
  rules: {
    title: "Règlement officiel de l’Invitation binôme",
    updated: "Dernière mise à jour : 22 octobre 2026",
    sections: [
      {
        heading: "Organisateur",
        paragraphs: [
          "L’Invitation binôme est organisée par DIVEROID LTD (Royaume-Uni), le fabricant de WatchDive. Questions : help@diveroid.com.",
        ],
      },
      {
        heading: "Période",
        paragraphs: [
          "Le programme commence le 22 octobre 2026 et se termine juste avant le lancement de la campagne WatchDive sur Kickstarter. La campagne est prévue en décembre 2026. Nous annoncerons l’heure exacte de clôture sur cette page et par e-mail au moins {noticeDays} jours à l’avance.",
        ],
      },
      {
        heading: "Comment participer",
        paragraphs: [
          "Inscrivez-vous à la liste d’attente WatchDive et confirmez votre adresse e-mail. Vous obtenez alors un lien d’invitation personnel. Un ami compte pour vous lorsqu’il ouvre votre lien, rejoint la liste d’attente et confirme son adresse e-mail.",
          "Aucun achat ni aucune contribution Kickstarter n’est nécessaire pour participer ou gagner. Le lien du tarif early bird sert si vous choisissez de soutenir la campagne.",
        ],
      },
      {
        heading: "Ce qui compte",
        paragraphs: [
          "Seuls les amis qui confirment leur adresse e-mail comptent. Vos propres adresses, les inscriptions répétées d’une même personne, les adresses e-mail jetables et les inscriptions signalées comme abusives ne comptent pas.",
          "Au maximum {cap} amis sont comptés par personne et par jour (heure standard de la Corée). Les amis qui confirment après l’heure de clôture ne comptent pas.",
        ],
      },
      {
        heading: "Récompenses",
        paragraphs: [
          "1 ami : l’e-mail de lancement Kickstarter {hoursFirst} heure avant la liste générale.",
          "3 amis (Binôme) : l’e-mail de lancement {hoursBuddy} heures avant la liste générale.",
          "5 amis (Équipe de plongée) : un lien de récompense Kickstarter privé au tarif early bird de {price}, utilisable même quand les {seats} premiers contributeurs sont déjà passés.",
          "10 amis (Leader de plongée) : une lampe sous-marine offerte. Nous en avons {stock}. Elles reviennent aux {stock} premières personnes à atteindre 10 amis, dans l’ordre où elles y parviennent. Quand il n’y en a plus, nous l’indiquerons sur cette page.",
          "Top {winners} : les {winners} personnes qui comptent le plus d’amis à l’heure de clôture reçoivent chacune un WatchDive. En cas d’égalité, celle qui a atteint le nombre en premier est mieux classée.",
        ],
      },
      {
        heading: "Vérification et disqualification",
        paragraphs: [
          "Avant l’envoi de toute lampe ou de tout WatchDive, nous vérifions les amis comptés. Nous pouvons retirer les amis qui enfreignent ce règlement et disqualifier toute personne qui utilise de fausses inscriptions ou des inscriptions automatisées. Nous contactons les gagnants par e-mail. Si un gagnant ne répond pas sous 14 jours, la récompense passe à la personne suivante dans l’ordre.",
        ],
      },
      {
        heading: "Livraison, expédition et taxes",
        paragraphs: [
          "Les destinataires paient l’expédition ainsi que les éventuelles taxes ou droits de douane, y compris la retenue à la source coréenne sur les lots lorsqu’elle s’applique. Nous n’expédions que dans les pays où la campagne Kickstarter de WatchDive livre. Les lampes sous-marines sont envoyées après vérification. Un WatchDive gagné est envoyé lorsque WatchDive est expédié aux contributeurs.",
        ],
      },
      {
        heading: "Classement et confidentialité",
        paragraphs: [
          "Le classement n’affiche qu’un pseudo que vous avez défini et choisi d’afficher. Votre adresse e-mail n’est jamais affichée. Les personnes qui ne choisissent pas d’afficher un pseudo apparaissent comme « Plongeur anonyme ». Nous pouvons masquer un pseudo offensant ou qui usurpe l’identité de quelqu’un.",
          "Nous ne vous disons jamais qui sont vos amis, seulement combien ont rejoint. Consultez notre politique de confidentialité pour savoir comment nous traitons les données de la liste d’attente.",
        ],
      },
      {
        heading: "Modifications",
        paragraphs: [
          "Si nous devons modifier ou arrêter le programme, nous l’annoncerons d’abord ici et par e-mail. Les récompenses déjà atteintes avant une modification sont conservées.",
        ],
      },
    ],
  },
};

const de: ReferralCopy = {
  programName: "Buddy-Einladung",
  tiers: {
    first: {
      name: "Erste Einladung · 1 Freund",
      reward: "Erhalte die Kickstarter-Start-E-Mail {hours} Stunde vor der allgemeinen Liste.",
    },
    buddy: {
      name: "Buddy · 3 Freunde",
      reward: "Erhalte die Kickstarter-Start-E-Mail {hours} Stunden vor der allgemeinen Liste.",
    },
    team: {
      name: "Tauchteam · 5 Freunde",
      reward:
        "Behalte den Early-Bird-Preis von {price} mit einem privaten Kickstarter-Reward-Link, auch wenn die ersten {seats} Unterstützer schon vergeben sind.",
    },
    leader: {
      name: "Tauch-Leader · 10 Freunde",
      reward:
        "Erhalte eine Unterwasserlampe gratis. {stock} sind auf Lager, vergeben in der Reihenfolge, in der 10 Freunde erreicht werden. Versand und Steuern trägt der Empfänger.",
    },
  },
  top: {
    name: "Top {winners} der Einladenden",
    reward:
      "Die {winners} Personen mit den meisten verifizierten Freunden beim Start der Kickstarter-Kampagne erhalten je ein WatchDive. Versand und Steuern trägt der Empfänger.",
  },
  countingNote: "Es zählen nur Freunde, die ihre E-Mail-Adresse bestätigen.",
  card: {
    title: "Lade deine Tauchbuddys ein",
    body: "Schick deinen Link los. Die Belohnungen wachsen mit jedem Freund, der seine E-Mail-Adresse bestätigt.",
    progress: "{count} dabei · noch {remaining} bis {tier}",
    progressNone: "Noch keine Freunde · noch {remaining} bis {tier}",
    progressMax: "{count} dabei · alle Stufen erreicht. Greif nach den Top {winners}.",
    statusLink: "Meine Einladungen ansehen",
    rulesLink: "Offizielle Teilnahmebedingungen",
  },
  leaderboard: {
    title: "Buddy-Einladung: Top {winners}",
    subtitle: "Nur verifizierte Freunde · Stand {time}",
    entry: "Freunde: {count}",
    privateDiver: "Anonymer Taucher",
    empty:
      "Noch steht niemand in der Rangliste. Deine erste Einladung könnte dich hierher bringen.",
    closed: "Die Buddy-Einladung ist beendet. Wir prüfen die Gewinner.",
    rulesLink: "Offizielle Teilnahmebedingungen",
  },
  status: {
    title: "Meine Buddy-Einladung",
    countLabel: "Freunde, die dabei sind",
    tierLabel: "Aktuelle Stufe",
    tierNone: "Noch keine",
    rankLabel: "Platz in der Rangliste",
    rankNone: "Noch nicht platziert",
    earlyNotice: "Du bekommst die Kickstarter-Start-E-Mail {hours} Std. früher.",
    lightEligible:
      "Du gehörst zu den ersten {stock} Tauch-Leadern. Wir melden uns wegen deiner Unterwasserlampe bei dir.",
    lightGone: "Alle {stock} Unterwasserlampen sind vergeben.",
    shareTitle: "Dein Einladungslink",
    nicknameLabel: "Spitzname für die Rangliste",
    nicknameHelp: "{min}–{max} Zeichen. Keine E-Mail-Adressen, Telefonnummern oder Links.",
    nicknameHiddenNote: "Unser Team hat diesen Spitznamen ausgeblendet. Bitte wähle einen anderen.",
    leaderboardToggle: "Meinen Spitznamen in der Top-{winners}-Rangliste anzeigen",
    noticesToggle: "Per E-Mail benachrichtigen, wenn ein Freund dazukommt",
    save: "Speichern",
    saving: "Wird gespeichert…",
    saved: "Gespeichert",
    invalidLink: "Dieser Link ist ungültig. Öffne den neuesten Link aus deiner WatchDive-E-Mail.",
    errors: {
      too_short: "Verwende mindestens {min} Zeichen.",
      too_long: "Verwende höchstens {max} Zeichen.",
      contact_info: "Ein Spitzname darf keine E-Mail-Adresse und keine Telefonnummer enthalten.",
      link: "Ein Spitzname darf keinen Link enthalten.",
      reserved: "Bitte wähle einen anderen Spitznamen.",
      invalid_chars:
        "Verwende Buchstaben, Zahlen, Leerzeichen, Punkte, Bindestriche oder Unterstriche.",
      failed: "Speichern fehlgeschlagen. Bitte versuche es noch einmal.",
    },
  },
  mail: {
    welcomeSubject: "Du bist auf der WatchDive-Warteliste — lade deine Buddys ein",
    welcomeHeading: "Du bist auf der WatchDive-Warteliste",
    welcomeIntro:
      "Deine E-Mail-Adresse ist bestätigt. Schick deinen persönlichen Einladungslink an die Taucher, mit denen du tauchst. Die Belohnungen wachsen mit jedem Freund, der seine E-Mail-Adresse bestätigt.",
    welcomeTiersHeading: "Belohnungen der Buddy-Einladung",
    welcomeButton: "Meinen Einladungslink teilen",
    welcomeFallback: "Oder kopiere diesen Link:",
    welcomeStatus:
      "Sieh dir deine Einladungen an und lege einen Spitznamen für die Rangliste fest:",
    welcomeRules: "Offizielle Teilnahmebedingungen:",
    welcomeOutro: "Wir informieren dich per E-Mail, sobald WatchDive auf Kickstarter startet.",
    noticeSubject: "Ein Buddy ist über deinen Link dazugekommen ({count} insgesamt)",
    noticeHeading: "Ein Buddy ist über deinen Link dazugekommen",
    noticeBody: "Bisher über deinen Link dazugekommen und per E-Mail bestätigt: {count}.",
    noticeTierReached: "Du hast {tier} erreicht: {reward}",
    noticeNext: "Noch {remaining} bis {tier}.",
    noticeMax: "Alle Stufen erreicht. Mach weiter in Richtung Top {winners}.",
    noticeButton: "Meine Einladungen ansehen",
    noticeFooter: "Du kannst diese E-Mails auf deiner Einladungsseite abschalten.",
  },
  rules: {
    title: "Offizielle Teilnahmebedingungen der Buddy-Einladung",
    updated: "Zuletzt aktualisiert: 22. Oktober 2026",
    sections: [
      {
        heading: "Veranstalter",
        paragraphs: [
          "Die Buddy-Einladung wird von DIVEROID LTD (Vereinigtes Königreich), dem Hersteller von WatchDive, durchgeführt. Fragen: help@diveroid.com.",
        ],
      },
      {
        heading: "Zeitraum",
        paragraphs: [
          "Das Programm beginnt am 22. Oktober 2026 und endet unmittelbar, bevor die WatchDive-Kampagne auf Kickstarter startet. Die Kampagne ist für Dezember 2026 geplant. Den genauen Endzeitpunkt geben wir mindestens {noticeDays} Tage vorher auf dieser Seite und per E-Mail bekannt.",
        ],
      },
      {
        heading: "So nimmst du teil",
        paragraphs: [
          "Trag dich auf die WatchDive-Warteliste ein und bestätige deine E-Mail-Adresse. Danach bekommst du deinen persönlichen Einladungslink. Ein Freund zählt für dich, wenn er deinen Link öffnet, sich auf die Warteliste einträgt und seine E-Mail-Adresse bestätigt.",
          "Für die Teilnahme und für einen Gewinn ist weder ein Kauf noch eine Unterstützung auf Kickstarter nötig. Der Link zum Early-Bird-Preis kommt zum Einsatz, wenn du dich entscheidest, die Kampagne zu unterstützen.",
        ],
      },
      {
        heading: "Was zählt",
        paragraphs: [
          "Es zählen nur Freunde, die ihre E-Mail-Adresse bestätigen. Deine eigenen Adressen, wiederholte Anmeldungen derselben Person, Wegwerf-E-Mail-Adressen und als missbräuchlich markierte Anmeldungen zählen nicht.",
          "Pro Person werden höchstens {cap} Freunde pro Tag gezählt (koreanische Standardzeit). Freunde, die nach dem Endzeitpunkt bestätigen, zählen nicht.",
        ],
      },
      {
        heading: "Belohnungen",
        paragraphs: [
          "1 Freund: die Kickstarter-Start-E-Mail {hoursFirst} Stunde vor der allgemeinen Liste.",
          "3 Freunde (Buddy): die Start-E-Mail {hoursBuddy} Stunden vor der allgemeinen Liste.",
          "5 Freunde (Tauchteam): ein privater Kickstarter-Reward-Link zum Early-Bird-Preis von {price}, auch wenn die ersten {seats} Unterstützer schon vergeben sind.",
          "10 Freunde (Tauch-Leader): eine Unterwasserlampe gratis. Wir haben {stock} Stück. Sie gehen an die ersten {stock} Personen, die 10 Freunde erreichen, in der Reihenfolge, in der sie das schaffen. Wenn sie vergeben sind, schreiben wir das auf dieser Seite.",
          "Top {winners}: Die {winners} Personen mit den meisten gezählten Freunden zum Endzeitpunkt erhalten je ein WatchDive. Bei gleicher Anzahl liegt vorn, wer sie zuerst erreicht hat.",
        ],
      },
      {
        heading: "Prüfung und Ausschluss",
        paragraphs: [
          "Bevor eine Lampe oder ein WatchDive verschickt wird, prüfen wir die gezählten Freunde. Wir können Freunde entfernen, die gegen diese Regeln verstoßen, und jeden ausschließen, der gefälschte oder automatisierte Anmeldungen nutzt. Wir kontaktieren Gewinner per E-Mail. Antwortet ein Gewinner nicht innerhalb von 14 Tagen, geht die Belohnung an die nächste Person in der Reihenfolge.",
        ],
      },
      {
        heading: "Lieferung, Versand und Steuern",
        paragraphs: [
          "Empfänger tragen den Versand sowie alle Steuern und Zölle, einschließlich der koreanischen Quellensteuer auf Gewinne, soweit sie anfällt. Wir versenden nur in Länder, in die die WatchDive-Kampagne auf Kickstarter liefert. Unterwasserlampen werden nach der Prüfung verschickt. Ein WatchDive als Preis wird verschickt, wenn WatchDive an die Unterstützer ausgeliefert wird.",
        ],
      },
      {
        heading: "Rangliste und Datenschutz",
        paragraphs: [
          "Die Rangliste zeigt nur einen Spitznamen, den du selbst festlegst und anzeigen lassen willst. Deine E-Mail-Adresse wird nie angezeigt. Wer keinen Spitznamen anzeigen lässt, erscheint als „Anonymer Taucher“. Wir können einen Spitznamen ausblenden, der beleidigend ist oder jemanden imitiert.",
          "Wir sagen dir nie, wer deine Freunde sind, nur wie viele dazugekommen sind. Wie wir mit Wartelistendaten umgehen, steht in unserer Datenschutzerklärung.",
        ],
      },
      {
        heading: "Änderungen",
        paragraphs: [
          "Müssen wir das Programm ändern oder beenden, geben wir das vorher hier und per E-Mail bekannt. Belohnungen, die vor einer Änderung bereits erreicht wurden, bleiben erhalten.",
        ],
      },
    ],
  },
};

const ptBR: ReferralCopy = {
  programName: "Convite de parceiros",
  tiers: {
    first: {
      name: "Primeiro convite · 1 amigo",
      reward: "Receba o e-mail de lançamento do Kickstarter {hours} hora antes da lista geral.",
    },
    buddy: {
      name: "Parceiro · 3 amigos",
      reward: "Receba o e-mail de lançamento do Kickstarter {hours} horas antes da lista geral.",
    },
    team: {
      name: "Equipe de mergulho · 5 amigos",
      reward:
        "Mantenha o preço early bird de {price} com um link de recompensa privado do Kickstarter, mesmo depois que os primeiros {seats} apoiadores já tiverem entrado.",
    },
    leader: {
      name: "Líder de mergulho · 10 amigos",
      reward:
        "Ganhe uma lanterna subaquática grátis. Há {stock} em estoque, entregues na ordem em que as pessoas chegam a 10. Frete e impostos ficam por conta de quem recebe.",
    },
  },
  top: {
    name: "Top {winners} de convites",
    reward:
      "Quando a campanha do Kickstarter entrar no ar, as {winners} pessoas com mais amigos verificados ganham um WatchDive cada. Frete e impostos ficam por conta de quem recebe.",
  },
  countingNote: "Só contam os amigos que confirmam o e-mail.",
  card: {
    title: "Convide seus parceiros de mergulho",
    body: "Envie seu link. As recompensas crescem a cada amigo que confirma o e-mail.",
    progress: "Amigos que entraram: {count} · mais {remaining} para {tier}",
    progressNone: "Nenhum amigo ainda · mais {remaining} para {tier}",
    progressMax:
      "Amigos que entraram: {count} · você chegou a todos os níveis. Vá atrás do top {winners}.",
    statusLink: "Ver meus convites",
    rulesLink: "Regras oficiais",
  },
  leaderboard: {
    title: "Top {winners} do Convite de parceiros",
    subtitle: "Só amigos verificados · em {time}",
    entry: "Amigos: {count}",
    privateDiver: "Mergulhador anônimo",
    empty: "Ainda não há ninguém no ranking. Seu primeiro convite pode colocar você aqui.",
    closed: "O Convite de parceiros foi encerrado. Estamos analisando os ganhadores.",
    rulesLink: "Regras oficiais",
  },
  status: {
    title: "Meu Convite de parceiros",
    countLabel: "Amigos que entraram",
    tierLabel: "Nível atual",
    tierNone: "Nenhum ainda",
    rankLabel: "Posição no ranking",
    rankNone: "Ainda sem posição",
    earlyNotice: "Você vai receber o e-mail de lançamento do Kickstarter {hours} h antes.",
    lightEligible:
      "Você está entre os primeiros {stock} Líderes de mergulho. Vamos entrar em contato sobre a sua lanterna subaquática.",
    lightGone: "As {stock} lanternas subaquáticas já foram todas reivindicadas.",
    shareTitle: "Seu link de convite",
    nicknameLabel: "Apelido para o ranking",
    nicknameHelp: "De {min} a {max} caracteres. Sem endereços de e-mail, telefones ou links.",
    nicknameHiddenNote: "Nossa equipe ocultou este apelido. Escolha outro, por favor.",
    leaderboardToggle: "Mostrar meu apelido no ranking do top {winners}",
    noticesToggle: "Avisar por e-mail quando um amigo entrar",
    save: "Salvar",
    saving: "Salvando…",
    saved: "Salvo",
    invalidLink: "Este link não é válido. Abra o link mais recente do seu e-mail do WatchDive.",
    errors: {
      too_short: "Use pelo menos {min} caracteres.",
      too_long: "Use no máximo {max} caracteres.",
      contact_info: "Um apelido não pode conter endereço de e-mail nem telefone.",
      link: "Um apelido não pode conter um link.",
      reserved: "Escolha outro apelido, por favor.",
      invalid_chars: "Use letras, números, espaços, pontos, hifens ou sublinhados.",
      failed: "Não foi possível salvar. Tente de novo.",
    },
  },
  mail: {
    welcomeSubject: "Você está na lista de espera do WatchDive — convide seus parceiros",
    welcomeHeading: "Você está na lista de espera do WatchDive",
    welcomeIntro:
      "Seu e-mail foi confirmado. Envie seu link de convite pessoal para as pessoas com quem você mergulha. As recompensas crescem a cada amigo que confirma o e-mail.",
    welcomeTiersHeading: "Recompensas do Convite de parceiros",
    welcomeButton: "Compartilhar meu link de convite",
    welcomeFallback: "Ou copie este link:",
    welcomeStatus: "Veja seus convites e escolha um apelido para o ranking:",
    welcomeRules: "Regras oficiais:",
    welcomeOutro: "Vamos avisar por e-mail quando o WatchDive entrar no ar no Kickstarter.",
    noticeSubject: "Um parceiro entrou pelo seu link ({count} no total)",
    noticeHeading: "Um parceiro entrou pelo seu link",
    noticeBody: "Amigos que entraram pelo seu link e confirmaram o e-mail: {count}.",
    noticeTierReached: "Você chegou a {tier}: {reward}",
    noticeNext: "Para {tier}: mais {remaining}.",
    noticeMax: "Você chegou a todos os níveis. Continue rumo ao top {winners}.",
    noticeButton: "Ver meus convites",
    noticeFooter: "Você pode desativar estes e-mails na sua página de convites.",
  },
  rules: {
    title: "Regras oficiais do Convite de parceiros",
    updated: "Última atualização: 22 de outubro de 2026",
    sections: [
      {
        heading: "Organizador",
        paragraphs: [
          "O Convite de parceiros é realizado pela DIVEROID LTD (Reino Unido), fabricante do WatchDive. Dúvidas: help@diveroid.com.",
        ],
      },
      {
        heading: "Período",
        paragraphs: [
          "O programa começa em 22 de outubro de 2026 e termina imediatamente antes de a campanha do WatchDive no Kickstarter entrar no ar. A campanha está prevista para dezembro de 2026. Vamos anunciar o horário exato de encerramento nesta página e por e-mail com pelo menos {noticeDays} dias de antecedência.",
        ],
      },
      {
        heading: "Como participar",
        paragraphs: [
          "Entre na lista de espera do WatchDive e confirme seu e-mail. Você recebe então um link de convite pessoal. Um amigo conta para você quando abre seu link, entra na lista de espera e confirma o e-mail.",
          "Não é preciso comprar nada nem apoiar a campanha no Kickstarter para participar ou ganhar. O link do preço early bird é usado quando você decide apoiar a campanha.",
        ],
      },
      {
        heading: "O que conta",
        paragraphs: [
          "Só contam os amigos que confirmam o e-mail. Seus próprios endereços, cadastros repetidos da mesma pessoa, e-mails descartáveis e cadastros marcados como abusivos não contam.",
          "No máximo {cap} amigos são contados por pessoa por dia (horário padrão da Coreia). Amigos que confirmarem depois do horário de encerramento não contam.",
        ],
      },
      {
        heading: "Recompensas",
        paragraphs: [
          "1 amigo: o e-mail de lançamento do Kickstarter {hoursFirst} hora antes da lista geral.",
          "3 amigos (Parceiro): o e-mail de lançamento {hoursBuddy} horas antes da lista geral.",
          "5 amigos (Equipe de mergulho): um link de recompensa privado do Kickstarter com o preço early bird de {price}, disponível mesmo depois que os primeiros {seats} apoiadores já tiverem entrado.",
          "10 amigos (Líder de mergulho): uma lanterna subaquática grátis. Temos {stock}. Elas vão para as primeiras {stock} pessoas a chegar a 10 amigos, na ordem em que chegarem. Quando acabarem, avisaremos nesta página.",
          "Top {winners}: as {winners} pessoas com mais amigos contados no horário de encerramento ganham um WatchDive cada. Em caso de empate, fica na frente quem chegou primeiro àquele número.",
        ],
      },
      {
        heading: "Análise e desclassificação",
        paragraphs: [
          "Antes de enviar qualquer lanterna ou WatchDive, analisamos os amigos contados. Podemos remover amigos que descumpram estas regras e desclassificar quem usar cadastros falsos ou automatizados. Entramos em contato com os ganhadores por e-mail. Se um ganhador não responder em até 14 dias, a recompensa passa para a próxima pessoa na ordem.",
        ],
      },
      {
        heading: "Entrega, frete e impostos",
        paragraphs: [
          "Quem recebe paga o frete e quaisquer impostos ou taxas, inclusive o imposto retido na fonte coreano sobre prêmios, quando aplicável. Enviamos apenas para os países atendidos pela campanha do WatchDive no Kickstarter. As lanternas subaquáticas são enviadas após a análise. Um WatchDive como prêmio é enviado quando o WatchDive for enviado aos apoiadores.",
        ],
      },
      {
        heading: "Ranking e privacidade",
        paragraphs: [
          "O ranking mostra apenas um apelido que você definiu e escolheu exibir. Seu e-mail nunca é exibido. Quem não escolhe exibir um apelido aparece como “Mergulhador anônimo”. Podemos ocultar um apelido ofensivo ou que se passe por outra pessoa.",
          "Nunca dizemos quem são seus amigos, apenas quantos entraram. Veja nossa política de privacidade para saber como tratamos os dados da lista de espera.",
        ],
      },
      {
        heading: "Mudanças",
        paragraphs: [
          "Se precisarmos alterar ou encerrar o programa, vamos avisar antes, aqui e por e-mail. As recompensas já alcançadas antes de uma mudança são mantidas.",
        ],
      },
    ],
  },
};

export const REFERRAL_COPY: Record<Locale, ReferralCopy> = {
  en,
  ko,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  es,
  fr,
  de,
  "pt-BR": ptBR,
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
