// Buddy Invite copy for every surface: landing card, leaderboard, status page,
// mails and the official rules. Numbers are interpolated from program.ts only
// ({placeholders}); never type a threshold, stock, price or hour count here.
//
// Placeholders: {count} {remaining} {tier} {hours} {price} {seats} {stock}
// {winners} {cap} {noticeDays} {min} {max} {hoursFirst} {hoursBuddy} {nickname}
// {time} {reward} {lightValue} {prizeValue} {ageKr} {ageOther} {longStop}
// {deliveryBy} {taxFree} {taxRate} — {longStop} and {deliveryBy} arrive already
// written in the locale's own date form (values.ts), so each sentence around
// them is phrased for that form.
//
// ko and en are the reviewed source; the other seven locales are native edits
// of them (tests/referralCopy.test.ts checks keys, placeholders and claim words).
//
// Editing rules every locale follows (2026-10-22 copy review):
//   - Same words as the frozen landing (src/lib/i18n/frozen-landing-messages.ts)
//     for waitlist, Kickstarter, early bird, backer, confirm and buddy, and the
//     same form of address (du / tú / vous / você / 你).
//   - Tier names keep " · " before the friend count: the landing card shows
//     only the part before it (src/routes/index.tsx).
//   - A string that takes {count} or {remaining} must read correctly for 1 as
//     well as for 12. Languages with plural nouns use "Label: {count}" or
//     "{remaining} more" shapes instead of "{count} friends".
//   - The rules state only what the ledger and ops review actually do.

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
    /** For someone who arrived through an invite link: what the inviter can see. */
    invitedNote: string;
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
    /**
     * The words in the "Leaderboard and privacy" section that name the privacy
     * policy, exactly as they appear there; the rules page links them to the
     * policy's Buddy Invite section (`#buddy-invite`).
     */
    privacyLink: string;
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
        "Get a private Kickstarter reward link at the {price} early-bird price. It works during the live campaign on the Kickstarter website, even after the early-bird spots for the first {seats} backers are gone. One pledge per Dive Team member. Please don’t share the link.",
    },
    leader: {
      name: "Dive Leader · 10 friends",
      reward:
        "Get an underwater light worth about {lightValue}. {stock} in stock, awarded in the order people reach 10. Shipping and taxes are paid by the recipient.",
    },
  },
  top: {
    name: "Top {winners} inviters",
    reward:
      "The {winners} people with the most verified friends at the closing time each get one WatchDive, even if the campaign is late or does not go ahead. Shipping and taxes are paid by the recipient.",
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
    invitedNote: "The person who invited you sees only how many friends joined, never who.",
  },
  leaderboard: {
    title: "Buddy Invite top {winners}",
    subtitle: "Verified friends only · as of {time} · subject to review",
    entry: "{count} joined",
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
    earlyNotice: "You will get the Kickstarter launch email {hours} h before the general list.",
    lightEligible:
      "You are provisionally among the first {stock} Dive Leaders. After our review we will email you about your underwater light.",
    lightGone: "All {stock} underwater lights have been claimed.",
    shareTitle: "Your invite link",
    nicknameLabel: "Nickname for the leaderboard",
    nicknameHelp:
      "{min}–{max} characters: letters, numbers, spaces, dots, hyphens or underscores. No email addresses, phone numbers, links or names that could pass for WatchDive staff.",
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
      invalid_chars:
        "Use only letters, numbers, spaces, dots, hyphens or underscores, and don’t mix Latin with Cyrillic or Greek letters.",
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
    privacyLink: "privacy policy",
    sections: [
      {
        heading: "Organizer",
        paragraphs: [
          "Buddy Invite is run by DIVEROID LTD, the maker of WatchDive (company no. 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom). Questions: help@diveroid.com.",
        ],
      },
      {
        heading: "Who can take part",
        paragraphs: [
          "You must be {ageOther} or older, or {ageKr} or older if you live in South Korea, and at least the age of majority where you live. Employees and contractors of DIVEROID LTD and its group companies, people who help run this program, and their households cannot receive physical rewards. You may join from anywhere, but underwater lights and WatchDive prizes can only be sent to a country the WatchDive Kickstarter campaign ships to. We will publish that list on this page before the closing time. If you live elsewhere, you still get the early launch email and the Dive Team link, but a physical reward passes to the next person in order. The program is void where prohibited by law.",
        ],
      },
      {
        heading: "Period",
        paragraphs: [
          "The program starts on 22 October 2026 and closes immediately before the WatchDive Kickstarter campaign goes live, and no later than {longStop}. The campaign is planned for December 2026. We will announce the exact closing time on this page and by email at least {noticeDays} days in advance.",
        ],
      },
      {
        heading: "How to take part",
        paragraphs: [
          "Join the WatchDive waitlist and confirm your email. You then get a personal invite link. A friend counts for you when they open your link, join the waitlist and confirm their email.",
          "No purchase or Kickstarter pledge is needed to take part or to win. You use the early-bird price link only if you choose to back the campaign.",
        ],
      },
      {
        heading: "What counts",
        paragraphs: [
          "Only friends who confirm their email count, and each person counts once. A repeat sign-up by the same person does not count again, including the same mailbox written another way (for example a Gmail address with dots or a +tag, or the same name at icloud.com, me.com and mac.com). Your own address never counts for you, and inviting yourself with another address breaks the fair play rules. Addresses from known disposable email services and sign-ups flagged as abusive do not count either.",
          "A friend counts for the invite link they used when they first joined the waitlist. Joining again through another link does not move them to another inviter or count them twice. Friends who joined through your link and confirmed their email before the program started on 22 October 2026 also count.",
          "At most {cap} friends are counted for one person per day, by the day each friend confirms (Korea Standard Time). Friends over that limit are not counted, and they do not carry over to a later day. Friends who confirm after the closing time do not count.",
          "Counts are frozen at the closing time. A counted friend who later unsubscribes from WatchDive emails still counts. A friend who asks us to delete their data, or whom we remove in review, stops counting.",
          "Once you reach a tier and we tell you, you keep it unless our review finds that the friends who got you there broke these rules. If you unsubscribe from WatchDive emails yourself, you keep the rewards you have reached, but we can no longer send you the early launch email or notices.",
        ],
      },
      {
        heading: "Fair play",
        paragraphs: [
          "One entry per person. You may not sign up other people without their consent, pay or reward anyone for signing up, use referral-exchange sites, or post your link in replies or comments on WatchDive’s own ads.",
          "Each person and each household can receive at most one underwater light and one WatchDive prize; one person can win both. We check this at shipping by name, address and phone number.",
        ],
      },
      {
        heading: "Rewards",
        paragraphs: [
          "1 friend: the Kickstarter launch email {hoursFirst} hour before the general list.",
          "3 friends (Buddy): the launch email {hoursBuddy} hours before the general list.",
          "5 friends (Dive Team): before the campaign goes live, we email you a private Kickstarter reward link at the {price} early-bird price. You can use it while the campaign is live, on the Kickstarter website (desktop or mobile browser, signed in), even after the early-bird spots for the first {seats} backers are gone. It does not work in the Kickstarter app, for late pledges or in the pledge manager. One pledge per Dive Team member; please do not share the link. Shipping and any taxes are charged as for other backers.",
          "10 friends (Dive Leader): one underwater light worth about {lightValue}. We have {stock}. They go to the first {stock} people to reach 10 friends, in the order they reach it. When they are gone, we will say so on this page.",
          "Top {winners}: the {winners} people with the most counted friends at the closing time each get one WatchDive. If two people have the same count, the one who reached it first ranks higher.",
          "A WatchDive prize is one WatchDive sensor housing, in the Apple Watch or Galaxy Watch version of the winner’s choice, worth {prizeValue} (the planned public price). The watch is not included, and WatchDive works only with the supported watch models listed on our site. Prizes have no cash alternative.",
        ],
      },
      {
        heading: "If the campaign is late or does not go ahead",
        paragraphs: [
          "If the Kickstarter campaign has not gone live by {longStop}, the program closes at that time anyway. Once we have announced the closing time, we move it at most once, and only with at least 48 hours’ email notice before the original time. Even if the campaign does not reach its goal, is cancelled or is delayed, the top {winners} still each receive a WatchDive. If we end the program early, we rank people by their counts at that time and award the top {winners} prizes on that basis.",
        ],
      },
      {
        heading: "Review and disqualification",
        paragraphs: [
          "The underwater light order and the leaderboard ranking are provisional until review. Before any light or WatchDive is sent, we review the counted friends. We may remove friends that break these rules and disqualify anyone who uses fake or automated sign-ups or breaks the fair play rules. We email winners within 14 days after the closing time (lights: within 14 days after review). If a winner does not reply within 14 days, or cannot receive the reward under these rules, the light passes to the next Dive Leader in the order of reaching 10 friends, and a WatchDive prize passes to the next person in the ranking.",
        ],
      },
      {
        heading: "Delivery, shipping and taxes",
        paragraphs: [
          "Recipients pay shipping and any import duties or taxes. We ship only to countries the WatchDive Kickstarter campaign ships to. Lights are sent after review, and all physical rewards are sent before {deliveryBy}.",
          "For winners who live in South Korea, Korean law requires the payer to withhold {taxRate}% income tax (other income tax plus local income tax) on a prize whose taxable value is over {taxFree}. This applies to both the underwater light (worth about {lightValue}) and the WatchDive. Before we ship, we tell you the amount and ask you to pay it to us, and we report and pay it to the tax office. For this we ask Korean winners for their legal name, resident registration number and address, used only for the tax report and kept only as long as tax law requires.",
        ],
      },
      {
        heading: "Leaderboard and privacy",
        paragraphs: [
          "The leaderboard shows only a nickname you set and choose to show. Your email address is never shown. People who do not choose to show a nickname appear as “Private diver”. A nickname has {min} to {max} characters: letters, numbers, spaces, dots, hyphens and underscores, without mixing Latin with Cyrillic or Greek letters. It cannot contain an email address, phone number or link, or look like a name of WatchDive, Kickstarter or their staff (such as “admin” or “official”). We may hide a nickname that is offensive or impersonates someone. The leaderboard and the counts on your invite page are updated every few minutes, so a new friend can take a few minutes to appear.",
          "We never tell you which friends joined, only how many. See our privacy policy for how we handle waitlist data.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If we must change or end the program, we will announce it here and by email first. Changes never take away a reward you have already reached and never reduce the prizes for the top {winners}.",
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
      reward: "Kickstarter 오픈 소식을 일반 명단보다 {hours}시간 먼저 이메일로 받아요.",
    },
    buddy: {
      name: "버디 · 3명",
      reward: "Kickstarter 오픈 소식을 일반 명단보다 {hours}시간 먼저 이메일로 받아요.",
    },
    team: {
      name: "다이브 팀 · 5명",
      reward:
        "얼리버드 가격 {price}로 후원할 수 있는 Kickstarter 전용 리워드 링크를 드려요. 선착순 {seats}명 공개 얼리버드가 마감된 뒤에도 캠페인 기간 중 Kickstarter 웹사이트에서 쓸 수 있어요. 다이브 팀 회원 1명당 1건이며, 링크는 다른 사람과 공유하지 말아 주세요.",
    },
    leader: {
      name: "다이브 리더 · 10명",
      reward:
        "약 {lightValue} 상당의 수중 라이트 1개를 드려요. 준비된 수량은 {stock}개로, 10명을 먼저 달성한 순서대로 드려요. 배송비와 제세공과금은 받는 분이 부담합니다.",
    },
  },
  top: {
    name: "초대 랭킹 Top {winners}",
    reward:
      "마감 시각 기준 인증을 마친 친구가 가장 많은 {winners}명에게 WatchDive를 1개씩 드려요. 캠페인이 늦어지거나 진행되지 않아도 드립니다. 배송비와 제세공과금은 받는 분이 부담합니다.",
  },
  countingNote: "이메일 인증을 마친 친구만 집계됩니다.",
  card: {
    title: "다이빙 버디를 초대하세요",
    body: "내 링크를 보내 주세요. 이메일 인증을 마친 친구가 늘어날수록 혜택이 커집니다.",
    progress: "{count}명 참여 · {tier}까지 {remaining}명 남았어요",
    progressNone: "아직 참여한 친구가 없어요 · {tier}까지 {remaining}명 남았어요",
    progressMax: "{count}명 참여 · 모든 단계를 달성했어요. 랭킹 Top {winners}에 도전해 보세요.",
    statusLink: "내 초대 현황 보기",
    rulesLink: "공식 규칙",
    invitedNote: "초대한 분에게는 참여 인원수만 보이고, 누가 참여했는지는 보이지 않아요.",
  },
  leaderboard: {
    title: "버디 초대 랭킹 Top {winners}",
    subtitle: "인증을 마친 친구만 집계 · {time} 기준 · 검수 전 잠정 순위",
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
    earlyNotice: "Kickstarter 오픈 소식을 일반 명단보다 {hours}시간 먼저 이메일로 받아요.",
    lightEligible:
      "수중 라이트 {stock}개 대상에 잠정적으로 들었어요. 검수를 마치면 이메일로 연락드릴게요.",
    lightGone: "수중 라이트 {stock}개가 모두 소진되었습니다.",
    shareTitle: "내 초대 링크",
    nicknameLabel: "랭킹에 표시할 닉네임",
    nicknameHelp:
      "{min}~{max}자, 글자·숫자·공백·점(.)·하이픈(-)·밑줄(_)만 쓸 수 있어요. 이메일 주소, 전화번호, 링크, WatchDive 운영진으로 오해될 수 있는 이름은 쓸 수 없어요.",
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
      invalid_chars:
        "글자, 숫자, 공백, 점(.), 하이픈(-), 밑줄(_)만 쓸 수 있고, 라틴 문자와 키릴·그리스 문자는 섞어 쓸 수 없어요.",
      failed: "저장하지 못했어요. 다시 시도해 주세요.",
    },
  },
  mail: {
    welcomeSubject: "WatchDive 출시 알림 신청 완료 · 버디를 초대하세요",
    welcomeHeading: "WatchDive 출시 알림 신청이 완료되었습니다",
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
    privacyLink: "개인정보 처리방침",
    sections: [
      {
        heading: "주최",
        paragraphs: [
          "버디 초대는 WatchDive를 만드는 DIVEROID LTD(영국 회사번호 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom)가 운영합니다. 문의: help@diveroid.com",
        ],
      },
      {
        heading: "참여 자격",
        paragraphs: [
          "만 {ageKr}세 이상만 참여할 수 있습니다(대한민국 외 거주자는 만 {ageOther}세 이상이면서 거주지 법상 성년이어야 합니다). DIVEROID LTD 및 계열사의 임직원·계약자, 이 프로그램 운영에 참여하는 분과 그 가구원은 실물 혜택을 받을 수 없습니다. 어느 나라에서든 참여할 수 있지만, 수중 라이트와 WatchDive 경품은 WatchDive Kickstarter 캠페인의 배송 국가로만 보낼 수 있으며, 그 목록은 마감 전에 이 페이지에 공개합니다. 배송 국가 밖에 사는 분도 오픈 소식 선공개 메일과 다이브 팀 링크는 받을 수 있지만, 실물 혜택은 다음 순서의 분에게 넘어갑니다. 법으로 금지된 지역에서는 이 프로그램이 적용되지 않습니다.",
        ],
      },
      {
        heading: "기간",
        paragraphs: [
          "2026년 10월 22일에 시작해 WatchDive Kickstarter 캠페인이 공개되기 직전에 마감하며, 늦어도 {longStop}에는 마감합니다. 캠페인은 2026년 12월에 공개할 예정이며, 정확한 마감 시각은 최소 {noticeDays}일 전에 이 페이지와 이메일로 알려드립니다.",
        ],
      },
      {
        heading: "참여 방법",
        paragraphs: [
          "WatchDive 출시 알림을 신청하고 이메일을 인증하면 내 초대 링크가 생깁니다. 친구가 내 링크로 들어와 알림을 신청하고 이메일 인증까지 마치면 1명으로 집계됩니다.",
          "참여와 당첨에 구매나 Kickstarter 후원 조건은 없습니다. 얼리버드 가격 링크는 캠페인을 후원하기로 했을 때만 사용합니다.",
        ],
      },
      {
        heading: "집계 기준",
        paragraphs: [
          "이메일 인증을 마친 친구만 집계하며, 한 사람은 한 번만 집계합니다. 같은 사람이 다시 가입해도 다시 집계하지 않으며, 같은 메일함을 다른 형태로 쓴 주소(예: 점(.)이나 +태그를 넣은 Gmail 주소, 같은 이름의 icloud.com·me.com·mac.com 주소)도 같은 사람으로 봅니다. 본인 주소는 집계하지 않으며, 본인의 다른 주소로 자신을 초대하는 것은 공정한 참여 규칙 위반입니다. 알려진 일회용 이메일 서비스의 주소와 부정 가입으로 표시된 가입도 집계하지 않습니다.",
          "친구는 처음 알림을 신청할 때 사용한 초대 링크의 주인에게 집계됩니다. 나중에 다른 링크로 다시 신청해도 초대한 사람이 바뀌거나 두 번 집계되지 않습니다. 프로그램 시작일(2026년 10월 22일) 전에 내 링크로 신청해 이메일 인증을 마친 친구도 집계합니다.",
          "한 사람당 하루 최대 {cap}명까지 집계하며, 날짜는 친구가 인증한 날(한국 시간 기준)로 셉니다. 이 한도를 넘은 친구는 집계하지 않으며, 다음 날로 넘어가지도 않습니다. 마감 시각 이후에 인증한 친구도 집계하지 않습니다.",
          "집계는 마감 시각 기준으로 확정됩니다. 집계된 친구가 나중에 WatchDive 메일 수신을 거부해도 계속 집계되지만, 정보 삭제를 요청했거나 검수에서 제외된 친구는 집계에서 빠집니다.",
          "단계를 달성했다는 안내를 받은 뒤에는, 검수에서 그 단계를 채운 가입이 규칙 위반으로 확인되지 않는 한 그 단계가 유지됩니다. 본인이 WatchDive 메일 수신을 거부해도 이미 달성한 혜택은 유지되지만, 오픈 소식 선공개 메일과 알림은 보내드릴 수 없습니다.",
        ],
      },
      {
        heading: "공정한 참여",
        paragraphs: [
          "1인 1회만 참여할 수 있습니다. 본인 동의 없이 다른 사람을 신청시키는 행위, 돈이나 보상을 주고 가입을 유도하는 행위, 추천 링크 교환 사이트 이용, WatchDive 광고의 댓글이나 답글에 링크를 올리는 행위는 허용되지 않습니다.",
          "수중 라이트와 WatchDive 경품은 1인당, 1가구당 각각 1개까지 받을 수 있으며, 한 사람이 둘 다 받을 수도 있습니다. 발송 시 이름, 주소, 전화번호로 확인합니다.",
        ],
      },
      {
        heading: "혜택",
        paragraphs: [
          "1명: Kickstarter 오픈 소식을 일반 명단보다 {hoursFirst}시간 먼저 이메일로 받습니다.",
          "3명(버디): 오픈 소식을 일반 명단보다 {hoursBuddy}시간 먼저 받습니다.",
          "5명(다이브 팀): 캠페인 공개 전에 얼리버드 가격 {price}로 후원할 수 있는 Kickstarter 전용 리워드 링크를 이메일로 보내 드립니다. 선착순 {seats}명 공개 얼리버드가 마감된 뒤에도 캠페인 진행 기간에 Kickstarter 웹사이트(PC 또는 모바일 브라우저, 로그인 상태)에서 사용할 수 있습니다. Kickstarter 앱, 레이트 플레지, 플레지 매니저에서는 쓸 수 없습니다. 다이브 팀 회원 1명당 1건만 후원할 수 있으며, 링크는 다른 사람과 공유하지 말아 주세요. 배송비와 세금은 다른 후원자와 같은 기준으로 부과됩니다.",
          "10명(다이브 리더): 약 {lightValue} 상당의 수중 라이트 1개를 받습니다. 준비된 수량은 {stock}개이며, 10명을 먼저 달성한 {stock}명에게 달성 순서대로 드립니다. 모두 소진되면 이 페이지에 알립니다.",
          "Top {winners}: 마감 시각 기준 집계된 친구가 가장 많은 {winners}명에게 WatchDive를 1개씩 드립니다. 집계 수가 같으면 그 수에 먼저 도달한 분이 앞섭니다.",
          "WatchDive 경품은 당첨자가 고른 Apple Watch용 또는 Galaxy Watch용 WatchDive 센서 하우징 1개(예정 정가 {prizeValue} 상당)입니다. 스마트워치는 포함되지 않으며, 사이트에 안내된 지원 모델에서만 작동합니다. 경품은 현금으로 대신 지급하지 않습니다.",
        ],
      },
      {
        heading: "캠페인이 늦어지거나 진행되지 않는 경우",
        paragraphs: [
          "Kickstarter 캠페인이 {longStop}까지 공개되지 않으면 이 프로그램은 그 시각에 마감합니다. 마감 시각을 알린 뒤에는 한 번만 변경할 수 있으며, 변경할 때는 원래 마감 시각 최소 48시간 전에 이메일로 알려드립니다. 캠페인이 목표 금액에 도달하지 못하거나 취소되거나 늦어지더라도 Top {winners}에게는 WatchDive를 1개씩 드립니다. 프로그램을 일찍 종료하는 경우 종료 시점의 집계로 순위를 정해 Top {winners} 경품을 드립니다.",
        ],
      },
      {
        heading: "검수와 실격",
        paragraphs: [
          "수중 라이트 지급 순서와 랭킹은 검수 전까지 잠정적입니다. 수중 라이트와 WatchDive를 보내기 전에 집계된 친구를 검수합니다. 규칙에 맞지 않는 가입은 집계에서 빼고, 가짜 또는 자동화된 가입을 이용하거나 공정한 참여 규칙을 어긴 경우 실격 처리할 수 있습니다. 당첨자에게는 마감 후 14일 안에(수중 라이트는 검수 후 14일 안에) 이메일로 연락드립니다. 14일 안에 회신이 없거나 이 규칙상 받을 수 없는 경우, 수중 라이트는 10명 달성 순서상 다음 다이브 리더에게, WatchDive 경품은 랭킹상 다음 분에게 넘어갑니다.",
        ],
      },
      {
        heading: "배송과 제세공과금",
        paragraphs: [
          "배송비와 관세·세금 등 제세공과금은 받는 분이 부담합니다. 배송은 WatchDive Kickstarter 캠페인의 배송 대상 국가로만 가능합니다. 수중 라이트는 검수 후 발송하며, 모든 실물 혜택은 {deliveryBy} 전에 발송합니다.",
          "대한민국 거주 당첨자의 경우, 과세 대상 금액이 {taxFree}을 넘는 경품에는 소득세법에 따라 지급자가 {taxRate}%(기타소득세 및 지방소득세)를 원천징수해야 합니다. 이는 수중 라이트(약 {lightValue} 상당)와 WatchDive 모두에 해당합니다. 발송 전에 해당 금액을 안내드리며, 이를 회사에 입금해 주시면 회사가 세무서에 신고·납부합니다. 이를 위해 한국 당첨자에게 성명, 주민등록번호, 주소를 받으며, 세무 신고에만 쓰고 세법이 정한 기간만 보관합니다.",
        ],
      },
      {
        heading: "랭킹과 개인정보",
        paragraphs: [
          "랭킹에는 본인이 정하고 공개를 선택한 닉네임만 표시합니다. 이메일 주소는 절대 공개하지 않습니다. 닉네임 공개를 선택하지 않은 분은 ‘비공개 다이버’로 표시됩니다. 닉네임은 {min}~{max}자의 글자, 숫자, 공백, 점(.), 하이픈(-), 밑줄(_)로 정하며, 라틴 문자와 키릴·그리스 문자를 섞어 쓸 수 없습니다. 이메일 주소, 전화번호, 링크를 넣거나 WatchDive·Kickstarter 또는 운영진으로 보일 수 있는 이름(예: admin, 공식)은 쓸 수 없습니다. 불쾌하거나 타인을 사칭하는 닉네임은 숨길 수 있습니다. 랭킹과 초대 현황 페이지의 인원수는 몇 분마다 갱신되므로, 새로 참여한 친구가 반영되기까지 몇 분 걸릴 수 있습니다.",
          "초대한 친구가 누구인지는 알려드리지 않고, 참여한 인원수만 알려드립니다. 대기 명단 정보 처리는 개인정보 처리방침을 따릅니다.",
        ],
      },
      {
        heading: "변경",
        paragraphs: [
          "프로그램을 변경하거나 종료해야 하는 경우 이 페이지와 이메일로 먼저 알려드립니다. 변경으로 이미 달성한 혜택이 없어지거나 Top {winners} 경품이 줄어드는 일은 없습니다.",
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
      reward: "比普通名单早 {hours} 小时收到 Kickstarter 开启通知邮件。",
    },
    buddy: {
      name: "潜伴 · 3 位朋友",
      reward: "比普通名单早 {hours} 小时收到 Kickstarter 开启通知邮件。",
    },
    team: {
      name: "潜水小队 · 5 位朋友",
      reward:
        "获得以 {price} 早鸟价支持的专属 Kickstarter 回报链接。众筹进行期间可在 Kickstarter 网站使用，即使前 {seats} 名支持者的早鸟名额已满也可以。每位潜水小队成员限支持 1 次，请勿分享此链接。",
    },
    leader: {
      name: "潜水队长 · 10 位朋友",
      reward:
        "获得 1 个价值约 {lightValue} 的潜水灯。共 {stock} 个，按达到 10 位朋友的先后顺序发放。运费和税费由收件人承担。",
    },
  },
  top: {
    name: "邀请榜前 {winners} 名",
    reward:
      "截止时已验证朋友最多的 {winners} 位各获得 1 台 WatchDive；即使众筹延期或未能进行，也照常发放。运费和税费由收件人承担。",
  },
  countingNote: "只有确认邮箱的朋友才会计入。",
  card: {
    title: "邀请你的潜伴",
    body: "把你的链接发给潜伴。每多一位朋友确认邮箱，奖励就更进一步。",
    progress: "已加入 {count} 位 · 再邀 {remaining} 位达成“{tier}”",
    progressNone: "还没有朋友加入 · 再邀 {remaining} 位达成“{tier}”",
    progressMax: "已加入 {count} 位 · 所有等级均已达成，冲刺前 {winners} 名吧。",
    statusLink: "查看我的邀请",
    rulesLink: "官方规则",
    invitedNote: "邀请你的人只能看到有多少位朋友加入，看不到具体是谁。",
  },
  leaderboard: {
    title: "潜伴邀请榜 前 {winners} 名",
    subtitle: "仅计已验证的朋友 · 截至 {time} · 以审核结果为准",
    entry: "{count} 位朋友",
    privateDiver: "匿名潜水员",
    empty: "榜单上还没有人。发出第一个邀请，下一个上榜的也许就是你。",
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
    earlyNotice: "你将比普通名单早 {hours} 小时收到 Kickstarter 开启通知邮件。",
    lightEligible:
      "你已暂列前 {stock} 位潜水队长之中。审核完成后，我们会发邮件与你联系潜水灯事宜。",
    lightGone: "{stock} 个潜水灯已全部送完。",
    shareTitle: "你的邀请链接",
    nicknameLabel: "排行榜昵称",
    nicknameHelp:
      "{min}–{max} 个字符，可使用文字、数字、空格、点（.）、连字符（-）和下划线（_）；不能包含邮箱地址、电话号码、链接，或可能被误认为 WatchDive 工作人员的名称。",
    nicknameHiddenNote: "这个昵称已被我们隐藏，请换一个。",
    leaderboardToggle: "在前 {winners} 名排行榜上显示我的昵称",
    noticesToggle: "有朋友加入时发邮件通知我",
    save: "保存",
    saving: "保存中…",
    saved: "已保存",
    invalidLink: "链接无效。请打开 WatchDive 最近一封邮件中的链接。",
    errors: {
      too_short: "请至少输入 {min} 个字符。",
      too_long: "最多 {max} 个字符。",
      contact_info: "昵称不能包含邮箱地址或电话号码。",
      link: "昵称不能包含链接。",
      reserved: "请换一个昵称。",
      invalid_chars:
        "只能使用文字、数字、空格、点（.）、连字符（-）和下划线（_），且不能混用拉丁字母与西里尔字母或希腊字母。",
      failed: "保存失败，请重试。",
    },
  },
  mail: {
    welcomeSubject: "你已加入 WatchDive 候补名单 — 邀请你的潜伴",
    welcomeHeading: "你已加入 WatchDive 候补名单",
    welcomeIntro:
      "邮箱已确认。把你的专属邀请链接发给一起潜水的潜伴吧。每多一位朋友确认邮箱，奖励就更进一步。",
    welcomeTiersHeading: "潜伴邀请奖励",
    welcomeButton: "分享我的邀请链接",
    welcomeFallback: "或复制此链接：",
    welcomeStatus: "查看邀请进度、设置排行榜昵称：",
    welcomeRules: "官方规则：",
    welcomeOutro: "WatchDive 在 Kickstarter 开启时，我们会发邮件通知你。",
    noticeSubject: "有潜伴通过你的链接加入了（目前共 {count} 位）",
    noticeHeading: "有潜伴通过你的链接加入了",
    noticeBody: "目前已有 {count} 位朋友通过你的链接加入并确认了邮箱。",
    noticeTierReached: "你已达成“{tier}”：{reward}",
    noticeNext: "再邀 {remaining} 位即可达成“{tier}”。",
    noticeMax: "所有等级均已达成，继续冲刺前 {winners} 名吧。",
    noticeButton: "查看我的邀请",
    noticeFooter: "你可以在邀请页面关闭此类邮件。",
  },
  rules: {
    title: "潜伴邀请官方规则",
    updated: "最后更新：2026 年 10 月 22 日",
    privacyLink: "隐私政策",
    sections: [
      {
        heading: "主办方",
        paragraphs: [
          "潜伴邀请由 WatchDive 的制造商 DIVEROID LTD 主办（英国公司编号 16343651，地址：Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom）。咨询：help@diveroid.com。",
        ],
      },
      {
        heading: "参与资格",
        paragraphs: [
          "参与者须年满 {ageOther} 岁，并已达到居住地的法定成年年龄；居住在韩国的参与者须年满 {ageKr} 岁。DIVEROID LTD 及其关联公司的员工和合同方、协助运营本活动的人员及其家庭成员，不能获得实物奖励。任何国家和地区的人都可以参与，但潜水灯和 WatchDive 奖品只能寄往 WatchDive Kickstarter 众筹可配送的国家和地区，该名单将在截止时间前在本页面公布。居住在其他地区的人仍可获得提前的开启通知邮件和潜水小队链接，但实物奖励将顺延给下一位。在法律禁止的地区，本活动无效。",
        ],
      },
      {
        heading: "活动时间",
        paragraphs: [
          "活动自 2026 年 10 月 22 日开始，至 WatchDive 的 Kickstarter 众筹开启前一刻结束，最迟于 {longStop}结束。众筹计划于 2026 年 12 月开启。确切的截止时间将至少提前 {noticeDays} 天在本页面公布，并通过邮件通知。",
        ],
      },
      {
        heading: "参与方式",
        paragraphs: [
          "加入 WatchDive 候补名单并确认邮箱后，你会获得专属邀请链接。朋友打开你的链接、加入候补名单并确认邮箱后，即计为你邀请的 1 位朋友。",
          "参与和获奖均无需购买，也无需在 Kickstarter 上支持。早鸟价链接仅在你自己决定支持众筹时使用。",
        ],
      },
      {
        heading: "计入规则",
        paragraphs: [
          "只有确认邮箱的朋友才会计入，且每人只计入一次。同一人重复报名不会再次计入，同一邮箱的其他写法也视为同一人（例如加了点号或 +标签的 Gmail 地址，或 icloud.com、me.com、mac.com 下的同名地址）。你自己的邮箱不会计入，用自己的其他邮箱邀请自己也违反公平参与规则。来自已知一次性邮箱服务的地址，以及被标记为滥用的报名，同样不计入。",
          "朋友计入其首次加入候补名单时所用邀请链接的主人名下。之后通过其他链接再次报名，既不会改记到别人名下，也不会重复计入。在活动开始日（2026 年 10 月 22 日）之前通过你的链接加入并确认邮箱的朋友，同样计入。",
          "每人每天最多计入 {cap} 位朋友，按朋友确认邮箱的日期计算（以韩国标准时间为准）。超出上限的朋友不计入，也不会顺延到之后的日期。截止时间之后才确认邮箱的朋友不计入。",
          "计入数以截止时间为准锁定。已计入的朋友之后即使退订 WatchDive 邮件，仍继续计入；但要求删除个人数据、或在审核中被剔除的朋友不再计入。",
          "你达成某个等级并收到我们的通知后，该等级将一直保留，除非审核发现帮你达成该等级的朋友违反了本规则。你自己退订 WatchDive 邮件后，已达成的奖励仍会保留，但我们将无法再给你发送提前的开启通知邮件和邀请通知。",
        ],
      },
      {
        heading: "公平参与",
        paragraphs: [
          "每人只能参与一次。禁止未经本人同意替他人报名、以金钱或奖励换取报名、使用互换邀请的网站，以及在 WatchDive 官方广告的评论或回复中发布邀请链接。",
          "潜水灯和 WatchDive 奖品，每人、每户各限 1 份；同一人可以同时获得两者。寄送时我们会核对姓名、地址和电话号码。",
        ],
      },
      {
        heading: "奖励",
        paragraphs: [
          "1 位朋友：比普通名单早 {hoursFirst} 小时收到 Kickstarter 开启通知邮件。",
          "3 位朋友（潜伴）：比普通名单早 {hoursBuddy} 小时收到开启通知邮件。",
          "5 位朋友（潜水小队）：众筹开启前，我们会通过邮件发给你以 {price} 早鸟价支持的专属 Kickstarter 回报链接。众筹进行期间，即使前 {seats} 名支持者的早鸟名额已满，你仍可在 Kickstarter 网站（电脑或手机浏览器，需登录）使用。该链接不适用于 Kickstarter App、延迟支持（Late Pledge）或 Pledge Manager。每位潜水小队成员限支持 1 次，请勿分享此链接。运费和税费与其他支持者按相同标准收取。",
          "10 位朋友（潜水队长）：获得 1 个价值约 {lightValue} 的潜水灯。共 {stock} 个，按达到 10 位朋友的先后顺序，发给最先达到的 {stock} 人。送完后，我们会在本页面说明。",
          "前 {winners} 名：截止时计入朋友数最多的 {winners} 位，各获得 1 台 WatchDive。人数相同时，先达到该人数者排名靠前。",
          "WatchDive 奖品为 1 个 WatchDive 传感器外壳，Apple Watch 版或 Galaxy Watch 版由获奖者选择，价值 {prizeValue}（计划公开售价）。不含手表，且仅适用于我们网站列出的支持机型。奖品不可兑换现金。",
        ],
      },
      {
        heading: "众筹延期或未能进行时",
        paragraphs: [
          "如果 Kickstarter 众筹在 {longStop}前仍未开启，活动将于该时间照常结束。截止时间公布后最多只调整一次，且会在原定截止时间至少 48 小时前通过邮件通知。即使众筹未达成目标、被取消或延期，前 {winners} 名仍各获得 1 台 WatchDive。如果我们提前结束活动，将按结束时的计入数排名，并据此发放前 {winners} 名奖品。",
        ],
      },
      {
        heading: "审核与取消资格",
        paragraphs: [
          "潜水灯的发放顺序和排行榜名次在审核完成前均为暂定。寄出潜水灯或 WatchDive 之前，我们会审核已计入的朋友。我们可能剔除违反本规则的朋友，并取消使用虚假或自动化报名、或违反公平参与规则者的资格。我们会在截止后 14 天内（潜水灯为审核后 14 天内）通过邮件联系获奖者。获奖者如在 14 天内未回复，或按本规则无法领取奖励，潜水灯将顺延给按达到 10 位朋友先后顺序的下一位潜水队长，WatchDive 奖品将顺延给排行榜上的下一位。",
        ],
      },
      {
        heading: "配送、运费与税费",
        paragraphs: [
          "收件人需承担运费及任何关税或税费。我们只寄送到 WatchDive Kickstarter 众筹可配送的国家和地区。潜水灯在审核后寄出；所有实物奖励都会在 {deliveryBy}前寄出。",
          "对于居住在韩国的获奖者，根据韩国法律，应税价值超过 {taxFree} 的奖品须由支付方代扣 {taxRate}% 的所得税（其他所得税及地方所得税）。潜水灯（价值约 {lightValue}）和 WatchDive 均适用。寄送前，我们会告知你应缴金额，请你先支付给我们，由我们向税务机关申报并缴纳。为此，我们会向韩国获奖者收集法定姓名、居民登记号码和地址，仅用于税务申报，并只在税法规定的期限内保存。",
        ],
      },
      {
        heading: "排行榜与隐私",
        paragraphs: [
          "排行榜只显示你自己设置并选择公开的昵称，绝不显示你的邮箱地址。未选择公开昵称的人显示为“匿名潜水员”。昵称须为 {min}–{max} 个字符，只能使用文字、数字、空格、点（.）、连字符（-）和下划线（_），且不能混用拉丁字母与西里尔字母或希腊字母；不能包含邮箱地址、电话号码或链接，也不能使用可能被误认为 WatchDive、Kickstarter 或其工作人员的名称（如 admin、官方）。带有冒犯性或冒充他人的昵称，我们可能会隐藏。排行榜和邀请页面上的人数每隔几分钟更新一次，新加入的朋友可能要过几分钟才会显示。",
          "我们不会告诉你是哪些朋友加入，只告诉你加入的人数。候补名单数据的处理方式，请参阅我们的隐私政策。",
        ],
      },
      {
        heading: "变更",
        paragraphs: [
          "如需变更或终止本活动，我们会事先在本页面公布并通过邮件通知。任何变更都不会取消你已达成的奖励，也不会减少前 {winners} 名的奖品。",
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
      reward: "比一般名單早 {hours} 小時收到 Kickstarter 募資開跑通知信。",
    },
    buddy: {
      name: "潛伴 · 3 位朋友",
      reward: "比一般名單早 {hours} 小時收到 Kickstarter 募資開跑通知信。",
    },
    team: {
      name: "潛水小隊 · 5 位朋友",
      reward:
        "取得以 {price} 早鳥價贊助的專屬 Kickstarter 回饋連結。募資期間可在 Kickstarter 網站使用，即使前 {seats} 名贊助者的早鳥名額已滿也可以。每位潛水小隊成員限贊助 1 次，請勿分享此連結。",
    },
    leader: {
      name: "潛水隊長 · 10 位朋友",
      reward:
        "獲得 1 支價值約 {lightValue} 的潛水燈。共 {stock} 支，依達到 10 位朋友的先後順序發送。運費與稅費由收件人負擔。",
    },
  },
  top: {
    name: "邀請榜前 {winners} 名",
    reward:
      "截止時已驗證朋友最多的 {winners} 位各獲得 1 台 WatchDive；即使募資延期或未能進行，也照常發送。運費與稅費由收件人負擔。",
  },
  countingNote: "只有確認信箱的朋友才會計入。",
  card: {
    title: "邀請你的潛伴",
    body: "把你的連結傳給潛伴。每多一位朋友確認信箱，獎勵就更進一步。",
    progress: "已加入 {count} 位 · 再邀 {remaining} 位達成「{tier}」",
    progressNone: "還沒有朋友加入 · 再邀 {remaining} 位達成「{tier}」",
    progressMax: "已加入 {count} 位 · 所有等級皆已達成，衝刺前 {winners} 名吧。",
    statusLink: "查看我的邀請",
    rulesLink: "官方規則",
    invitedNote: "邀請你的人只會看到有多少位朋友加入，看不到是誰。",
  },
  leaderboard: {
    title: "潛伴邀請榜 前 {winners} 名",
    subtitle: "僅計已驗證的朋友 · 截至 {time} · 以審核結果為準",
    entry: "{count} 位朋友",
    privateDiver: "匿名潛水員",
    empty: "排行榜上還沒有人。送出第一個邀請，下一個上榜的也許就是你。",
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
    earlyNotice: "你將比一般名單早 {hours} 小時收到 Kickstarter 募資開跑通知信。",
    lightEligible: "你已暫列前 {stock} 位潛水隊長之中。審核完成後，我們會寄信與你聯絡潛水燈事宜。",
    lightGone: "{stock} 支潛水燈已全數送出。",
    shareTitle: "你的邀請連結",
    nicknameLabel: "排行榜暱稱",
    nicknameHelp:
      "{min}–{max} 個字元，可使用文字、數字、空格、句點（.）、連字號（-）和底線（_）；不能包含電子郵件地址、電話號碼、連結，或可能被誤認為 WatchDive 工作人員的名稱。",
    nicknameHiddenNote: "這個暱稱已被我們隱藏，請換一個。",
    leaderboardToggle: "在前 {winners} 名排行榜上顯示我的暱稱",
    noticesToggle: "有朋友加入時寄信通知我",
    save: "儲存",
    saving: "儲存中…",
    saved: "已儲存",
    invalidLink: "連結無效。請開啟 WatchDive 最近一封信中的連結。",
    errors: {
      too_short: "請至少輸入 {min} 個字元。",
      too_long: "最多 {max} 個字元。",
      contact_info: "暱稱不能包含電子郵件地址或電話號碼。",
      link: "暱稱不能包含連結。",
      reserved: "請換一個暱稱。",
      invalid_chars:
        "只能使用文字、數字、空格、句點（.）、連字號（-）和底線（_），且不能混用拉丁字母與西里爾字母或希臘字母。",
      failed: "儲存失敗，請再試一次。",
    },
  },
  mail: {
    welcomeSubject: "你已加入 WatchDive 等候名單 — 邀請你的潛伴",
    welcomeHeading: "你已加入 WatchDive 等候名單",
    welcomeIntro:
      "信箱已確認。把你的專屬邀請連結傳給一起潛水的潛伴吧。每多一位朋友確認信箱，獎勵就更進一步。",
    welcomeTiersHeading: "潛伴邀請獎勵",
    welcomeButton: "分享我的邀請連結",
    welcomeFallback: "或複製此連結：",
    welcomeStatus: "查看邀請進度、設定排行榜暱稱：",
    welcomeRules: "官方規則：",
    welcomeOutro: "WatchDive 在 Kickstarter 開賣時，我們會寄信通知你。",
    noticeSubject: "有潛伴透過你的連結加入了（目前共 {count} 位）",
    noticeHeading: "有潛伴透過你的連結加入了",
    noticeBody: "目前已有 {count} 位朋友透過你的連結加入並確認了信箱。",
    noticeTierReached: "你已達成「{tier}」：{reward}",
    noticeNext: "再邀 {remaining} 位即可達成「{tier}」。",
    noticeMax: "所有等級皆已達成，繼續衝刺前 {winners} 名吧。",
    noticeButton: "查看我的邀請",
    noticeFooter: "你可以在邀請頁面關閉這類通知信。",
  },
  rules: {
    title: "潛伴邀請官方規則",
    updated: "最後更新：2026 年 10 月 22 日",
    privacyLink: "隱私權政策",
    sections: [
      {
        heading: "主辦單位",
        paragraphs: [
          "潛伴邀請由 WatchDive 的製造商 DIVEROID LTD 主辦（英國公司編號 16343651，地址：Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom）。洽詢：help@diveroid.com。",
        ],
      },
      {
        heading: "參加資格",
        paragraphs: [
          "參加者須年滿 {ageOther} 歲，並已達居住地的法定成年年齡；居住在韓國的參加者須年滿 {ageKr} 歲。DIVEROID LTD 及其關係企業的員工與約聘人員、協助營運本活動的人員及其家庭成員，不能獲得實體獎勵。任何國家和地區的人都可以參加，但潛水燈和 WatchDive 獎品只能寄往 WatchDive Kickstarter 募資可配送的國家和地區，該名單將在截止時間前於本頁面公布。居住在其他地區的人仍可收到提前的開跑通知信和潛水小隊連結，但實體獎勵將順延給下一位。在法律禁止的地區，本活動無效。",
        ],
      },
      {
        heading: "活動期間",
        paragraphs: [
          "活動自 2026 年 10 月 22 日開始，至 WatchDive 的 Kickstarter 募資開跑前一刻結束，最遲於 {longStop}結束。募資預計於 2026 年 12 月開跑。確切的截止時間將至少提前 {noticeDays} 天在本頁面公布，並寄信通知。",
        ],
      },
      {
        heading: "參加方式",
        paragraphs: [
          "加入 WatchDive 等候名單並確認信箱後，你會取得專屬邀請連結。朋友開啟你的連結、加入等候名單並確認信箱後，即計為你邀請的 1 位朋友。",
          "參加和得獎都不需要購買，也不需要在 Kickstarter 上贊助。早鳥價連結只在你自己決定贊助募資時使用。",
        ],
      },
      {
        heading: "計入規則",
        paragraphs: [
          "只有確認信箱的朋友才會計入，且每人只計入一次。同一人重複登記不會再次計入，同一信箱的其他寫法也視為同一人（例如加了句點或 +標籤的 Gmail 地址，或 icloud.com、me.com、mac.com 下的同名地址）。你自己的信箱不會計入，用自己的其他信箱邀請自己也違反公平參加規則。來自已知拋棄式信箱服務的地址，以及被標記為濫用的登記，同樣不計入。",
          "朋友會計入其首次加入等候名單時所用邀請連結的主人名下。之後透過其他連結再次登記，既不會改記到別人名下，也不會重複計入。在活動開始日（2026 年 10 月 22 日）之前透過你的連結加入並確認信箱的朋友，同樣計入。",
          "每人每天最多計入 {cap} 位朋友，依朋友確認信箱的日期計算（以韓國標準時間為準）。超出上限的朋友不計入，也不會順延到之後的日期。截止時間之後才確認信箱的朋友不計入。",
          "計入數以截止時間為準鎖定。已計入的朋友之後即使取消訂閱 WatchDive 信件，仍繼續計入；但要求刪除個人資料、或在審核中被剔除的朋友不再計入。",
          "你達成某個等級並收到我們的通知後，該等級會一直保留，除非審核發現幫你達成該等級的朋友違反本規則。你自己取消訂閱 WatchDive 信件後，已達成的獎勵仍會保留，但我們將無法再寄給你提前的開跑通知信和邀請通知。",
        ],
      },
      {
        heading: "公平參加",
        paragraphs: [
          "每人只能參加一次。禁止未經本人同意替他人登記、以金錢或獎勵換取登記、使用互換邀請的網站，以及在 WatchDive 官方廣告的留言或回覆中張貼邀請連結。",
          "潛水燈和 WatchDive 獎品，每人、每戶各限 1 份；同一人可以同時獲得兩者。寄送時我們會核對姓名、地址和電話號碼。",
        ],
      },
      {
        heading: "獎勵",
        paragraphs: [
          "1 位朋友：比一般名單早 {hoursFirst} 小時收到 Kickstarter 募資開跑通知信。",
          "3 位朋友（潛伴）：比一般名單早 {hoursBuddy} 小時收到開跑通知信。",
          "5 位朋友（潛水小隊）：募資開跑前，我們會寄給你以 {price} 早鳥價贊助的專屬 Kickstarter 回饋連結。募資期間，即使前 {seats} 名贊助者的早鳥名額已滿，你仍可在 Kickstarter 網站（電腦或手機瀏覽器，需登入）使用。此連結不適用於 Kickstarter App、延遲贊助（Late Pledge）或 Pledge Manager。每位潛水小隊成員限贊助 1 次，請勿分享此連結。運費與稅費依其他贊助者的相同標準收取。",
          "10 位朋友（潛水隊長）：獲得 1 支價值約 {lightValue} 的潛水燈。共 {stock} 支，依達到 10 位朋友的先後順序，送給最先達到的 {stock} 人。送完後，我們會在本頁面說明。",
          "前 {winners} 名：截止時計入朋友數最多的 {winners} 位，各獲得 1 台 WatchDive。人數相同時，先達到該人數者排名在前。",
          "WatchDive 獎品為 1 個 WatchDive 感測器外殼，Apple Watch 版或 Galaxy Watch 版由得獎者選擇，價值 {prizeValue}（預計公開售價）。不含手錶，且僅適用於我們網站列出的支援機型。獎品不可兌換現金。",
        ],
      },
      {
        heading: "募資延期或未能進行時",
        paragraphs: [
          "如果 Kickstarter 募資在 {longStop}前仍未開跑，活動將於該時間照常結束。截止時間公布後最多只調整一次，且會在原定截止時間至少 48 小時前寄信通知。即使募資未達目標、被取消或延期，前 {winners} 名仍各獲得 1 台 WatchDive。如果我們提前結束活動，將依結束時的計入數排名，並據此發送前 {winners} 名獎品。",
        ],
      },
      {
        heading: "審核與取消資格",
        paragraphs: [
          "潛水燈的發送順序和排行榜名次在審核完成前皆為暫定。寄出潛水燈或 WatchDive 之前，我們會審核已計入的朋友。我們可能剔除違反本規則的朋友，並取消使用虛假或自動化登記、或違反公平參加規則者的資格。我們會在截止後 14 天內（潛水燈為審核後 14 天內）寄信聯絡得獎者。得獎者若在 14 天內未回覆，或依本規則無法領取獎勵，潛水燈將順延給依達到 10 位朋友先後順序的下一位潛水隊長，WatchDive 獎品將順延給排行榜上的下一位。",
        ],
      },
      {
        heading: "配送、運費與稅費",
        paragraphs: [
          "收件人須負擔運費及任何關稅或稅費。我們只寄送到 WatchDive Kickstarter 募資可配送的國家和地區。潛水燈在審核後寄出；所有實體獎勵都會在 {deliveryBy}前寄出。",
          "對於居住在韓國的得獎者，依韓國法律，應稅價值超過 {taxFree} 的獎品須由支付方代扣 {taxRate}% 的所得稅（其他所得稅及地方所得稅）。潛水燈（價值約 {lightValue}）和 WatchDive 皆適用。寄送前，我們會告知你應繳金額，請你先支付給我們，由我們向稅務機關申報並繳納。為此，我們會向韓國得獎者蒐集法定姓名、居民登錄號碼和地址，僅用於稅務申報，並只在稅法規定的期間內保存。",
        ],
      },
      {
        heading: "排行榜與隱私",
        paragraphs: [
          "排行榜只顯示你自己設定並選擇公開的暱稱，絕不顯示你的電子郵件地址。未選擇公開暱稱的人會顯示為「匿名潛水員」。暱稱須為 {min}–{max} 個字元，只能使用文字、數字、空格、句點（.）、連字號（-）和底線（_），且不能混用拉丁字母與西里爾字母或希臘字母；不能包含電子郵件地址、電話號碼或連結，也不能使用可能被誤認為 WatchDive、Kickstarter 或其工作人員的名稱（如 admin、官方）。帶有冒犯性或冒充他人的暱稱，我們可能會隱藏。排行榜和邀請頁面上的人數每隔幾分鐘更新一次，新加入的朋友可能要過幾分鐘才會顯示。",
          "我們不會告訴你是哪些朋友加入，只告訴你加入的人數。等候名單資料的處理方式，請參閱我們的隱私權政策。",
        ],
      },
      {
        heading: "變更",
        paragraphs: [
          "如需變更或終止本活動，我們會事先在本頁面公布並寄信通知。任何變更都不會取消你已達成的獎勵，也不會減少前 {winners} 名的獎品。",
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
      reward: "Kickstarter 開始のお知らせメールを、一般リストより{hours}時間早く受け取れます。",
    },
    buddy: {
      name: "バディ · 友だち3人",
      reward: "Kickstarter 開始のお知らせメールを、一般リストより{hours}時間早く受け取れます。",
    },
    team: {
      name: "ダイブチーム · 友だち5人",
      reward:
        "{price}の早割価格で支援できる、専用の Kickstarter リワードリンクをお送りします。先着{seats}名の早割枠が埋まったあとも、キャンペーン期間中に Kickstarter のウェブサイトで使えます。ダイブチームのメンバー1人につき支援は1件までです。リンクはほかの人と共有しないでください。",
    },
    leader: {
      name: "ダイブリーダー · 友だち10人",
      reward:
        "約{lightValue}相当の水中ライトを1個プレゼント。在庫は{stock}個で、友だち10人に到達した順にお渡しします。送料・税金は受取人のご負担です。",
    },
  },
  top: {
    name: "招待ランキング上位{winners}名",
    reward:
      "終了日時の時点で確認済みの友だちが最も多い{winners}名に、WatchDive を1台ずつプレゼントします。キャンペーンが遅れたり実施されなかったりした場合も同様です。送料・税金は受取人のご負担です。",
  },
  countingNote: "カウントされるのは、メールアドレスを確認した友だちだけです。",
  card: {
    title: "ダイビングバディを招待しよう",
    body: "あなたのリンクを送りましょう。メールアドレスを確認した友だちが増えるほど、特典が増えていきます。",
    progress: "{count}人が参加 · 「{tier}」まであと{remaining}人",
    progressNone: "まだ参加した友だちはいません · 「{tier}」まであと{remaining}人",
    progressMax: "{count}人が参加 · すべての段階を達成しました。上位{winners}名を目指しましょう。",
    statusLink: "招待状況を見る",
    rulesLink: "公式ルール",
    invitedNote:
      "あなたを招待した人に見えるのは参加した人数だけで、誰が参加したかは表示されません。",
  },
  leaderboard: {
    title: "バディ招待ランキング 上位{winners}名",
    subtitle: "確認済みの友だちのみ · {time}時点 · 審査前の暫定順位",
    entry: "{count}人",
    privateDiver: "匿名ダイバー",
    empty: "まだランキングには誰もいません。最初の招待で、ここに載るのはあなたかもしれません。",
    closed: "バディ招待は終了しました。現在、当選者を審査しています。",
    rulesLink: "公式ルール",
  },
  status: {
    title: "バディ招待の状況",
    countLabel: "参加した友だち",
    tierLabel: "現在の段階",
    tierNone: "まだありません",
    rankLabel: "ランキング順位",
    rankNone: "まだランク外です",
    earlyNotice: "Kickstarter 開始のお知らせメールを、一般リストより{hours}時間早くお届けします。",
    lightEligible:
      "ダイブリーダーの先着{stock}名に暫定で入っています。審査が終わったら、水中ライトについてメールでご連絡します。",
    lightGone: "水中ライト{stock}個は、すべてなくなりました。",
    shareTitle: "あなたの招待リンク",
    nicknameLabel: "ランキングに表示するニックネーム",
    nicknameHelp:
      "{min}〜{max}文字。文字・数字・スペース・ドット（.）・ハイフン（-）・アンダースコア（_）が使えます。メールアドレス・電話番号・リンクや、WatchDive の運営者と誤解される名前は使えません。",
    nicknameHiddenNote:
      "このニックネームは運営により非表示になりました。別のニックネームを設定してください。",
    leaderboardToggle: "上位{winners}名のランキングにニックネームを表示する",
    noticesToggle: "友だちが参加したらメールで知らせる",
    save: "保存",
    saving: "保存中…",
    saved: "保存しました",
    invalidLink: "このリンクは無効です。WatchDive から届いた最新のメールのリンクを開いてください。",
    errors: {
      too_short: "{min}文字以上で入力してください。",
      too_long: "{max}文字以内で入力してください。",
      contact_info: "ニックネームにメールアドレスや電話番号は使えません。",
      link: "ニックネームにリンクは使えません。",
      reserved: "別のニックネームを設定してください。",
      invalid_chars:
        "使えるのは文字、数字、スペース、ドット（.）、ハイフン（-）、アンダースコア（_）です。ラテン文字とキリル文字・ギリシャ文字は混ぜられません。",
      failed: "保存できませんでした。もう一度お試しください。",
    },
  },
  mail: {
    welcomeSubject: "WatchDive のウェイトリストに登録されました — バディを招待しましょう",
    welcomeHeading: "WatchDive のウェイトリストに登録されました",
    welcomeIntro:
      "メールアドレスの確認が完了しました。あなた専用の招待リンクを、一緒に潜るバディに送りましょう。メールアドレスを確認した友だちが増えるほど、特典が増えていきます。",
    welcomeTiersHeading: "バディ招待の特典",
    welcomeButton: "招待リンクをシェアする",
    welcomeFallback: "またはこのリンクをコピー：",
    welcomeStatus: "招待状況の確認と、ランキング用ニックネームの設定：",
    welcomeRules: "公式ルール：",
    welcomeOutro: "WatchDive の Kickstarter キャンペーンが始まったら、メールでお知らせします。",
    noticeSubject: "あなたのリンクからバディが参加しました（これまでに{count}人）",
    noticeHeading: "あなたのリンクからバディが参加しました",
    noticeBody:
      "これまでに{count}人の友だちがあなたのリンクから参加し、メールアドレスを確認しました。",
    noticeTierReached: "「{tier}」を達成しました：{reward}",
    noticeNext: "「{tier}」まで、あと{remaining}人です。",
    noticeMax: "すべての段階を達成しました。引き続き上位{winners}名を目指しましょう。",
    noticeButton: "招待状況を見る",
    noticeFooter: "このお知らせメールは、招待状況のページで停止できます。",
  },
  rules: {
    title: "バディ招待 公式ルール",
    updated: "最終更新：2026年10月22日",
    privacyLink: "プライバシーポリシー",
    sections: [
      {
        heading: "主催者",
        paragraphs: [
          "バディ招待は、WatchDive を開発・製造する DIVEROID LTD（英国法人、会社番号 16343651、所在地：Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom）が運営しています。お問い合わせ：help@diveroid.com",
        ],
      },
      {
        heading: "参加資格",
        paragraphs: [
          "参加できるのは{ageOther}歳以上で、お住まいの国・地域の法律上の成年に達している方です（韓国にお住まいの方は{ageKr}歳以上）。DIVEROID LTD とそのグループ会社の従業員・業務委託先、本プログラムの運営に関わる方、およびその同一世帯の方は、物品の特典を受け取れません。どの国・地域からでも参加できますが、水中ライトと賞品の WatchDive の発送先は、WatchDive の Kickstarter キャンペーンの発送対象国に限ります。対象国の一覧は、終了日時までにこのページで公開します。対象国以外にお住まいの方も、開始のお知らせメールの先行配信とダイブチームのリンクは受け取れますが、物品の特典は次の順位の方に移ります。法律で禁止されている地域では、本プログラムは無効です。",
        ],
      },
      {
        heading: "期間",
        paragraphs: [
          "本プログラムは2026年10月22日に始まり、WatchDive の Kickstarter キャンペーン開始の直前に終了します。遅くとも{longStop}には終了します。キャンペーンは2026年12月に開始予定です。正確な終了日時は、少なくとも{noticeDays}日前までに、このページとメールでお知らせします。",
        ],
      },
      {
        heading: "参加方法",
        paragraphs: [
          "WatchDive のウェイトリストに登録してメールアドレスを確認すると、あなた専用の招待リンクが届きます。友だちがそのリンクを開いてウェイトリストに登録し、メールアドレスを確認すると、あなたの招待1人としてカウントされます。",
          "参加や当選に、購入や Kickstarter での支援は必要ありません。早割価格のリンクは、キャンペーンを支援すると決めた場合にのみお使いいただくものです。",
        ],
      },
      {
        heading: "カウント対象",
        paragraphs: [
          "カウントされるのは、メールアドレスを確認した友だちだけで、1人につき1回だけカウントされます。同一人物が再度登録してもカウントは増えず、同じメールボックスを別の書き方にしたアドレス（例：ドットや +タグを付けた Gmail アドレス、icloud.com・me.com・mac.com の同じ名前のアドレス）も同一人物として扱います。ご自身のアドレスはカウントされず、ご自身の別のアドレスで自分を招待することはフェアプレーのルール違反です。既知の使い捨てメールサービスのアドレスと、不正と判断された登録もカウントされません。",
          "友だちは、最初にウェイトリストに登録したときに使った招待リンクの持ち主にカウントされます。あとから別のリンクで登録し直しても、カウント先が変わったり、二重にカウントされたりすることはありません。プログラム開始日（2026年10月22日）より前にあなたのリンクから登録し、メールアドレスを確認した友だちもカウントされます。",
          "カウントは1人につき1日最大{cap}人までで、日付は友だちがメールアドレスを確認した日（韓国標準時）で数えます。上限を超えた友だちはカウントされず、翌日以降に繰り越されることもありません。終了日時より後にメールアドレスを確認した友だちもカウントされません。",
          "カウントは終了日時の時点で確定します。カウントされた友だちが後で WatchDive のメール配信を停止しても、引き続きカウントされます。ただし、データの削除を依頼した友だちや、審査で除外された友だちはカウントされなくなります。",
          "段階を達成し、そのお知らせを受け取ったあとは、その段階に到達させた友だちのルール違反が審査で判明しないかぎり、その段階はそのまま有効です。ご自身が WatchDive のメール配信を停止しても、達成済みの特典は有効ですが、開始のお知らせメールの先行配信や招待のお知らせはお送りできなくなります。",
        ],
      },
      {
        heading: "フェアプレー",
        paragraphs: [
          "参加は1人1回までです。本人の同意なく他人を登録すること、お金や見返りと引き換えに登録してもらうこと、紹介リンク交換サイトの利用、WatchDive の広告のコメント欄や返信へのリンク投稿は禁止します。",
          "水中ライトと賞品の WatchDive は、それぞれ1人・1世帯につき1つまでです。1人で両方を受け取ることはできます。発送時に、氏名・住所・電話番号で確認します。",
        ],
      },
      {
        heading: "特典",
        paragraphs: [
          "友だち1人：Kickstarter 開始のお知らせメールを、一般リストより{hoursFirst}時間早く受け取れます。",
          "友だち3人（バディ）：開始のお知らせメールを、一般リストより{hoursBuddy}時間早く受け取れます。",
          "友だち5人（ダイブチーム）：キャンペーン開始前に、{price}の早割価格で支援できる専用の Kickstarter リワードリンクをメールでお送りします。先着{seats}名の早割枠が埋まったあとも、キャンペーン期間中に Kickstarter のウェブサイト（パソコンまたはスマートフォンのブラウザで、ログインした状態）で使えます。Kickstarter アプリ、レイトプレッジ、プレッジマネージャーでは使えません。ダイブチームのメンバー1人につき支援は1件までで、リンクはほかの人と共有しないでください。送料と税金は、ほかの支援者と同じ基準でかかります。",
          "友だち10人（ダイブリーダー）：約{lightValue}相当の水中ライトを1個プレゼントします。在庫は{stock}個で、友だち10人に到達した最初の{stock}名に、到達した順にお渡しします。なくなった場合は、このページでお知らせします。",
          "上位{winners}名：終了日時の時点でカウントされた友だちが最も多い{winners}名に、WatchDive を1台ずつプレゼントします。人数が同じ場合は、先にその人数に到達した方が上位になります。",
          "賞品の WatchDive は、当選者が選べる Apple Watch 用または Galaxy Watch 用の WatchDive センサーハウジング1個（予定一般価格{prizeValue}相当）です。スマートウォッチは含まれず、サイトに掲載している対応モデルでのみ使えます。賞品を現金に換えることはできません。",
        ],
      },
      {
        heading: "キャンペーンが遅れた場合・実施されない場合",
        paragraphs: [
          "{longStop}までに Kickstarter キャンペーンが始まらない場合も、本プログラムはその時点で終了します。終了日時をお知らせしたあとに変更するのは1回だけで、その場合は元の終了日時の48時間以上前にメールでお知らせします。キャンペーンが目標金額に届かなかった場合、中止された場合、または遅れた場合でも、上位{winners}名には WatchDive を1台ずつお贈りします。本プログラムを早期に終了する場合は、その時点のカウントで順位を決め、上位{winners}名に賞品をお贈りします。",
        ],
      },
      {
        heading: "審査と失格",
        paragraphs: [
          "水中ライトをお渡しする順番とランキングの順位は、審査が終わるまで暫定です。水中ライトや WatchDive を発送する前に、カウントされた友だちを審査します。ルールに反する友だちはカウントから除外することがあり、偽の登録や自動化された登録を使った方、フェアプレーのルールに違反した方は失格となる場合があります。当選者には、終了日時から14日以内（水中ライトは審査から14日以内）にメールでご連絡します。14日以内にご返信がない場合や、このルール上受け取れない場合、水中ライトは友だち10人に到達した順で次のダイブリーダーに、WatchDive はランキングで次の方に移ります。",
        ],
      },
      {
        heading: "配送・送料・税金",
        paragraphs: [
          "送料と、関税を含む各種税金は受取人のご負担です。発送先は、WatchDive の Kickstarter キャンペーンの発送対象国に限ります。水中ライトは審査後に発送し、物品の特典はすべて{deliveryBy}より前に発送します。",
          "韓国にお住まいの当選者の場合、韓国の法律により、課税対象額が{taxFree}を超える賞品には、支払者が{taxRate}%（その他所得税と地方所得税）を源泉徴収する必要があります。これは水中ライト（約{lightValue}相当）と WatchDive の両方に当てはまります。発送前に金額をお知らせしますので、その額を当社にお支払いください。当社が税務署へ申告・納付します。このため、韓国の当選者からは法的な氏名、住民登録番号、住所をお預かりします。これらは税務申告にのみ使い、税法で定められた期間だけ保管します。",
        ],
      },
      {
        heading: "ランキングとプライバシー",
        paragraphs: [
          "ランキングに表示されるのは、ご自身で設定し、表示を選んだニックネームだけです。メールアドレスが表示されることはありません。ニックネームの表示を選ばなかった方は「匿名ダイバー」と表示されます。ニックネームは{min}〜{max}文字で、使えるのは文字、数字、スペース、ドット（.）、ハイフン（-）、アンダースコア（_）です。ラテン文字とキリル文字・ギリシャ文字を混ぜることはできません。メールアドレス・電話番号・リンクを含むものや、WatchDive・Kickstarter やその運営者と誤解されるおそれのある名前（例：admin、公式）は使えません。不適切なニックネームや、他人になりすましたニックネームは非表示にすることがあります。ランキングと招待ページの人数は数分ごとに更新されるため、新しく参加した友だちが反映されるまで数分かかることがあります。",
          "どの友だちが参加したかはお知らせせず、人数だけをお知らせします。ウェイトリストのデータの取り扱いについては、プライバシーポリシーをご覧ください。",
        ],
      },
      {
        heading: "変更",
        paragraphs: [
          "プログラムを変更または終了する必要がある場合は、事前にこのページとメールでお知らせします。変更によって、達成済みの特典がなくなったり、上位{winners}名の賞品が減ったりすることはありません。",
        ],
      },
    ],
  },
};

const es: ReferralCopy = {
  programName: "Invita a tu compañero",
  tiers: {
    first: {
      name: "Primera invitación · 1 amigo",
      reward:
        "Recibe el correo del lanzamiento en Kickstarter {hours} hora antes que la lista general.",
    },
    buddy: {
      name: "Compañero · 3 amigos",
      reward:
        "Recibe el correo del lanzamiento en Kickstarter {hours} horas antes que la lista general.",
    },
    team: {
      name: "Equipo de buceo · 5 amigos",
      reward:
        "Consigue un enlace privado de recompensa en Kickstarter con el precio early bird de {price}. Funciona durante la campaña en la web de Kickstarter, aunque ya se hayan cubierto las plazas de los {seats} primeros patrocinadores. Un apoyo por cada miembro del Equipo de buceo. Por favor, no compartas el enlace.",
    },
    leader: {
      name: "Líder de buceo · 10 amigos",
      reward:
        "Llévate una linterna de buceo valorada en unos {lightValue}. Hay {stock} unidades y se entregan por orden de llegada a los 10 amigos. Envío e impuestos a cargo de quien la recibe.",
    },
  },
  top: {
    name: "Top {winners} en invitaciones",
    reward:
      "Las {winners} personas con más amigos verificados a la hora de cierre se llevan un WatchDive cada una, aunque la campaña se retrase o no salga adelante. Envío e impuestos a cargo de quien lo recibe.",
  },
  countingNote: "Solo cuentan los amigos que confirman su correo.",
  card: {
    title: "Invita a tus compañeros de buceo",
    body: "Comparte tu enlace. Cada amigo que confirma su correo te acerca a la siguiente recompensa.",
    progress: "Amigos: {count} · {remaining} más para {tier}",
    progressNone: "Aún no se ha unido nadie · {remaining} más para {tier}",
    progressMax: "Amigos: {count} · has alcanzado todos los niveles. ¡Ve a por el top {winners}!",
    statusLink: "Ver mis invitaciones",
    rulesLink: "Bases oficiales",
    invitedNote: "Quien te invitó solo ve cuántos amigos se han unido, nunca quiénes.",
  },
  leaderboard: {
    title: "Top {winners} · Invita a tu compañero",
    subtitle: "Solo amigos verificados · actualizado: {time} · pendiente de revisión",
    entry: "Amigos: {count}",
    privateDiver: "Buceador anónimo",
    empty:
      "Todavía no hay nadie en la clasificación. Con tu primera invitación podrías aparecer aquí.",
    closed: "El concurso “Invita a tu compañero” ha terminado. Estamos revisando a los ganadores.",
    rulesLink: "Bases oficiales",
  },
  status: {
    title: "Mis invitaciones",
    countLabel: "Amigos que se han unido",
    tierLabel: "Nivel actual",
    tierNone: "Ninguno todavía",
    rankLabel: "Puesto en la clasificación",
    rankNone: "Aún sin puesto",
    earlyNotice:
      "Recibirás el correo del lanzamiento en Kickstarter {hours} h antes que la lista general.",
    lightEligible:
      "De forma provisional, estás entre los primeros {stock} en llegar a Líder de buceo. Tras nuestra revisión, te escribiremos por correo sobre tu linterna de buceo.",
    lightGone: "Ya no quedan linternas: las {stock} están asignadas.",
    shareTitle: "Tu enlace de invitación",
    nicknameLabel: "Alias para la clasificación",
    nicknameHelp:
      "De {min} a {max} caracteres: letras, números, espacios, puntos, guiones o guiones bajos. Sin correos, teléfonos, enlaces ni nombres que parezcan del equipo de WatchDive.",
    nicknameHiddenNote: "Nuestro equipo ha ocultado este alias. Elige otro, por favor.",
    leaderboardToggle: "Mostrar mi alias en el top {winners}",
    noticesToggle: "Avisarme por correo cuando se una un amigo",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    invalidLink: "Este enlace no es válido. Abre el enlace del correo más reciente de WatchDive.",
    errors: {
      too_short: "Usa al menos {min} caracteres.",
      too_long: "Usa como máximo {max} caracteres.",
      contact_info: "El alias no puede incluir un correo ni un teléfono.",
      link: "El alias no puede incluir enlaces.",
      reserved: "Elige otro alias, por favor.",
      invalid_chars:
        "Usa solo letras, números, espacios, puntos, guiones o guiones bajos, sin mezclar letras latinas con cirílicas o griegas.",
      failed: "No se ha podido guardar. Inténtalo de nuevo.",
    },
  },
  mail: {
    welcomeSubject: "Ya estás en la lista de espera de WatchDive — invita a tus compañeros",
    welcomeHeading: "Ya estás en la lista de espera de WatchDive",
    welcomeIntro:
      "Tu correo está confirmado. Pasa tu enlace de invitación personal a los buceadores con los que te metes al agua. Cada amigo que confirma su correo te acerca a la siguiente recompensa.",
    welcomeTiersHeading: "Recompensas por invitar",
    welcomeButton: "Compartir mi enlace",
    welcomeFallback: "O copia este enlace:",
    welcomeStatus: "Consulta tus invitaciones y elige un alias para la clasificación:",
    welcomeRules: "Bases oficiales:",
    welcomeOutro: "Te escribiremos en cuanto WatchDive abra en Kickstarter.",
    noticeSubject: "Un compañero se ha unido con tu enlace ({count} en total)",
    noticeHeading: "Un compañero se ha unido con tu enlace",
    noticeBody: "Amigos que se han unido con tu enlace y han confirmado su correo: {count}.",
    noticeTierReached: "Has llegado a {tier}: {reward}",
    noticeNext: "Para {tier}: {remaining} más.",
    noticeMax: "Has alcanzado todos los niveles. ¡Sigue a por el top {winners}!",
    noticeButton: "Ver mis invitaciones",
    noticeFooter: "Puedes desactivar estos correos en tu página de invitaciones.",
  },
  rules: {
    title: "Bases oficiales de “Invita a tu compañero”",
    updated: "Última actualización: 22 de octubre de 2026",
    privacyLink: "política de privacidad",
    sections: [
      {
        heading: "Organizador",
        paragraphs: [
          "“Invita a tu compañero” lo organiza DIVEROID LTD, la empresa que fabrica WatchDive (n.º de sociedad 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, Reino Unido). Consultas: help@diveroid.com.",
        ],
      },
      {
        heading: "Quién puede participar",
        paragraphs: [
          "Debes tener al menos {ageOther} años, o {ageKr} si vives en Corea del Sur, y ser mayor de edad donde vivas. Los empleados y colaboradores de DIVEROID LTD y de las empresas de su grupo, las personas que ayudan a gestionar este programa y quienes conviven con ellos no pueden recibir premios físicos. Puedes participar desde cualquier lugar, pero las linternas y los premios WatchDive solo pueden enviarse a los países a los que envía la campaña de WatchDive en Kickstarter. Publicaremos esa lista en esta página antes de la hora de cierre. Si vives en otro país, sigues recibiendo el correo anticipado del lanzamiento y el enlace del Equipo de buceo, pero el premio físico pasa a la siguiente persona por orden. El programa no es válido donde la ley lo prohíba.",
        ],
      },
      {
        heading: "Periodo",
        paragraphs: [
          "El programa empieza el 22 de octubre de 2026 y termina justo antes de que abra la campaña de WatchDive en Kickstarter, prevista para diciembre de 2026, y como muy tarde el {longStop}. Anunciaremos la hora exacta de cierre en esta página y por correo con al menos {noticeDays} días de antelación.",
        ],
      },
      {
        heading: "Cómo participar",
        paragraphs: [
          "Únete a la lista de espera de WatchDive y confirma tu correo: recibirás un enlace de invitación personal. Un amigo cuenta para ti cuando abre tu enlace, se une a la lista de espera y confirma su correo.",
          "No hace falta comprar nada ni apoyar la campaña en Kickstarter para participar ni para ganar. El enlace con el precio early bird solo se usa si decides apoyar la campaña.",
        ],
      },
      {
        heading: "Qué cuenta",
        paragraphs: [
          "Solo cuentan los amigos que confirman su correo, y cada persona cuenta una sola vez. Si la misma persona vuelve a registrarse, no cuenta de nuevo, aunque use el mismo buzón escrito de otra forma (por ejemplo, una dirección de Gmail con puntos o con una +etiqueta, o el mismo nombre en icloud.com, me.com y mac.com). Tu propia dirección nunca cuenta para ti, e invitarte a ti mismo con otra dirección incumple las reglas de juego limpio. Tampoco cuentan las direcciones de servicios conocidos de correo desechable ni los registros marcados como abusivos.",
          "Cada amigo cuenta para el enlace de invitación con el que se unió por primera vez a la lista de espera. Si vuelve a registrarse con otro enlace, no pasa a contar para otra persona ni cuenta dos veces. También cuentan los amigos que se unieron con tu enlace y confirmaron su correo antes del inicio del programa, el 22 de octubre de 2026.",
          "Se cuentan como máximo {cap} amigos por persona y día, según el día en que cada amigo confirma su correo (hora estándar de Corea). Los amigos que superen ese límite no se cuentan, tampoco en días posteriores. Los amigos que confirmen después de la hora de cierre no cuentan.",
          "Los recuentos quedan fijados a la hora de cierre. Un amigo ya contado que más adelante se da de baja de los correos de WatchDive sigue contando; deja de contar si nos pide borrar sus datos o si lo retiramos en la revisión.",
          "Cuando alcanzas un nivel y te lo comunicamos, lo conservas, salvo que la revisión demuestre que los amigos con los que lo alcanzaste incumplían estas bases. Si te das de baja de los correos de WatchDive, conservas las recompensas ya alcanzadas, pero ya no podremos enviarte el correo anticipado del lanzamiento ni los avisos.",
        ],
      },
      {
        heading: "Juego limpio",
        paragraphs: [
          "Cada persona puede participar una sola vez. No está permitido apuntar a otras personas sin su consentimiento, pagar u ofrecer incentivos a cambio de registros, usar webs de intercambio de referidos ni publicar tu enlace en respuestas o comentarios de los anuncios de WatchDive.",
          "Cada persona y cada hogar puede recibir como máximo una linterna de buceo y un premio WatchDive; una misma persona puede ganar ambos. Lo comprobamos al hacer el envío, por nombre, dirección y teléfono.",
        ],
      },
      {
        heading: "Recompensas",
        paragraphs: [
          "1 amigo: el correo del lanzamiento en Kickstarter {hoursFirst} hora antes que la lista general.",
          "3 amigos (Compañero): el correo del lanzamiento {hoursBuddy} horas antes que la lista general.",
          "5 amigos (Equipo de buceo): antes de que abra la campaña, te enviamos por correo un enlace privado de recompensa en Kickstarter con el precio early bird de {price}. Puedes usarlo mientras la campaña esté activa, en la web de Kickstarter (en el navegador del ordenador o del móvil, con la sesión iniciada), aunque ya se hayan cubierto las plazas de los {seats} primeros patrocinadores. No funciona en la app de Kickstarter, en los apoyos tardíos (late pledges) ni en el pledge manager. Un apoyo por cada miembro del Equipo de buceo; por favor, no compartas el enlace. El envío y los impuestos se cobran igual que al resto de patrocinadores.",
          "10 amigos (Líder de buceo): una linterna de buceo valorada en unos {lightValue}. Tenemos {stock} y son para las primeras {stock} personas que lleguen a 10 amigos, por orden de llegada. Cuando se agoten, lo indicaremos en esta página.",
          "Top {winners}: las {winners} personas con más amigos contados a la hora de cierre se llevan un WatchDive cada una. En caso de empate, queda por delante quien alcanzó antes esa cifra.",
          "Un premio WatchDive es una carcasa con sensor WatchDive, en la versión para Apple Watch o para Galaxy Watch que elija la persona ganadora, valorada en {prizeValue} (el precio público previsto). El reloj no está incluido y WatchDive solo funciona con los modelos compatibles indicados en nuestra web. Los premios no se pueden cambiar por dinero.",
        ],
      },
      {
        heading: "Si la campaña se retrasa o no sale adelante",
        paragraphs: [
          "Si la campaña de Kickstarter no ha abierto antes del {longStop}, el programa se cierra igualmente en ese momento. Una vez anunciada la hora de cierre, la cambiaremos como máximo una vez, avisando por correo con al menos 48 horas de antelación sobre la hora original. Aunque la campaña no alcance su objetivo, se cancele o se retrase, las personas del top {winners} recibirán igualmente un WatchDive cada una. Si terminamos el programa antes de tiempo, la clasificación se hará con los recuentos de ese momento y los premios del top {winners} se darán según esa clasificación.",
        ],
      },
      {
        heading: "Revisión y descalificación",
        paragraphs: [
          "El orden de entrega de las linternas y la clasificación son provisionales hasta la revisión. Antes de enviar cualquier linterna o WatchDive, revisamos los amigos contados. Podemos retirar a los amigos que incumplan estas bases y descalificar a quien use registros falsos o automatizados o no respete las normas de juego limpio. Escribimos a los ganadores en los 14 días siguientes al cierre (en el caso de las linternas, en los 14 días siguientes a la revisión). Si un ganador no responde en 14 días o no puede recibir la recompensa según estas bases, la linterna pasa al siguiente Líder de buceo por orden de llegada a los 10 amigos, y el premio WatchDive, a la siguiente persona de la clasificación.",
        ],
      },
      {
        heading: "Entrega, envío e impuestos",
        paragraphs: [
          "Quien recibe el premio paga el envío y cualquier arancel o impuesto. Solo enviamos a los países a los que envía la campaña de WatchDive en Kickstarter. Las linternas se envían tras la revisión, y todos los premios físicos se envían antes de {deliveryBy}.",
          "Si la persona ganadora vive en Corea del Sur, la ley coreana obliga a quien paga el premio a retener un {taxRate} % de impuesto sobre la renta (impuesto sobre otros ingresos más impuesto local) en los premios cuyo valor imponible supere {taxFree}. Esto se aplica tanto a la linterna (valorada en unos {lightValue}) como al WatchDive. Antes del envío te indicaremos el importe y te pediremos que nos lo abones; nosotros lo declaramos e ingresamos en la administración tributaria. Para ello pediremos a los ganadores residentes en Corea su nombre legal, su número de registro de residente y su dirección, que usaremos solo para la declaración fiscal y conservaremos solo el tiempo que exija la ley tributaria.",
        ],
      },
      {
        heading: "Clasificación y privacidad",
        paragraphs: [
          "La clasificación solo muestra el alias que tú eliges y decides mostrar. Tu correo nunca se muestra. Quien no decide mostrar un alias aparece como “Buceador anónimo”. El alias debe tener entre {min} y {max} caracteres: letras, números, espacios, puntos, guiones y guiones bajos, sin mezclar letras latinas con cirílicas o griegas. No puede contener correos, teléfonos ni enlaces, ni parecer un nombre de WatchDive, de Kickstarter o de su equipo (como “admin” o “staff”). Podemos ocultar alias ofensivos o que suplanten a otra persona. La clasificación y los recuentos de tu página de invitaciones se actualizan cada pocos minutos, así que un amigo nuevo puede tardar unos minutos en aparecer.",
          "Nunca te decimos qué amigos se han unido, solo cuántos. Consulta nuestra política de privacidad para saber cómo tratamos los datos de la lista de espera.",
        ],
      },
      {
        heading: "Cambios",
        paragraphs: [
          "Si tenemos que cambiar o terminar el programa, lo anunciaremos antes aquí y por correo. Ningún cambio te quitará una recompensa ya alcanzada ni reducirá los premios del top {winners}.",
        ],
      },
    ],
  },
};

const fr: ReferralCopy = {
  programName: "Invitez votre binôme",
  tiers: {
    first: {
      name: "Première invitation · 1 ami",
      reward: "Recevez l’e-mail de lancement Kickstarter {hours} heure avant le reste de la liste.",
    },
    buddy: {
      name: "Binôme · 3 amis",
      reward:
        "Recevez l’e-mail de lancement Kickstarter {hours} heures avant le reste de la liste.",
    },
    team: {
      name: "Palanquée · 5 amis",
      reward:
        "Recevez un lien de contrepartie Kickstarter privé au tarif early bird de {price}. Il fonctionne pendant la campagne sur le site Kickstarter, même quand les places des {seats} premiers contributeurs sont prises. Une contribution par membre de la Palanquée. Merci de ne pas partager ce lien.",
    },
    leader: {
      name: "Chef de file · 10 amis",
      reward:
        "Recevez une lampe de plongée d’une valeur d’environ {lightValue}. {stock} exemplaires, attribués dans l’ordre où chacun atteint 10 amis. Frais de port et taxes à la charge du destinataire.",
    },
  },
  top: {
    name: "Top {winners} des invitations",
    reward:
      "À l’heure de clôture, les {winners} personnes qui comptent le plus d’amis vérifiés reçoivent chacune un WatchDive, même si la campagne est retardée ou n’a pas lieu. Frais de port et taxes à la charge du destinataire.",
  },
  countingNote: "Seuls les amis qui confirment leur e-mail comptent.",
  card: {
    title: "Invitez vos binômes de plongée",
    body: "Envoyez votre lien. Chaque ami qui confirme son e-mail vous rapproche de la récompense suivante.",
    progress: "Amis inscrits : {count} · encore {remaining} pour {tier}",
    progressNone: "Aucun ami inscrit pour l’instant · encore {remaining} pour {tier}",
    progressMax:
      "Amis inscrits : {count} · tous les paliers sont atteints. Visez le top {winners} !",
    statusLink: "Voir mes invitations",
    rulesLink: "Règlement officiel",
    invitedNote:
      "La personne qui vous invite ne voit que le nombre d’amis inscrits, jamais leur identité.",
  },
  leaderboard: {
    title: "Top {winners} · Invitez votre binôme",
    subtitle: "Amis vérifiés uniquement · mis à jour : {time} · sous réserve de vérification",
    entry: "Amis : {count}",
    privateDiver: "Plongeur anonyme",
    empty:
      "Personne n’est encore au classement. Votre première invitation pourrait vous y faire entrer.",
    closed: "Le concours « Invitez votre binôme » est terminé. Nous vérifions les gagnants.",
    rulesLink: "Règlement officiel",
  },
  status: {
    title: "Mes invitations",
    countLabel: "Amis inscrits",
    tierLabel: "Palier actuel",
    tierNone: "Aucun pour l’instant",
    rankLabel: "Rang au classement",
    rankNone: "Pas encore classé",
    earlyNotice:
      "Vous recevrez l’e-mail de lancement Kickstarter {hours} h avant le reste de la liste.",
    lightEligible:
      "Vous faites provisoirement partie des {stock} premiers à atteindre le palier Chef de file. Après notre vérification, nous vous écrirons au sujet de votre lampe de plongée.",
    lightGone: "Les {stock} lampes de plongée ont toutes été attribuées.",
    shareTitle: "Votre lien d’invitation",
    nicknameLabel: "Pseudo affiché dans le classement",
    nicknameHelp:
      "{min} à {max} caractères : lettres, chiffres, espaces, points, tirets et tirets bas. Ni adresse e-mail, ni numéro de téléphone, ni lien, ni nom pouvant passer pour l’équipe WatchDive.",
    nicknameHiddenNote: "Notre équipe a masqué ce pseudo. Merci d’en choisir un autre.",
    leaderboardToggle: "Afficher mon pseudo dans le top {winners}",
    noticesToggle: "Me prévenir par e-mail quand un ami s’inscrit",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré",
    invalidLink: "Ce lien n’est pas valide. Ouvrez le lien du dernier e-mail reçu de WatchDive.",
    errors: {
      too_short: "Au moins {min} caractères.",
      too_long: "{max} caractères maximum.",
      contact_info: "Le pseudo ne peut pas contenir d’adresse e-mail ni de numéro de téléphone.",
      link: "Le pseudo ne peut pas contenir de lien.",
      reserved: "Merci de choisir un autre pseudo.",
      invalid_chars:
        "Lettres, chiffres, espaces, points, tirets et tirets bas uniquement, sans mélanger lettres latines et lettres cyrilliques ou grecques.",
      failed: "Enregistrement impossible. Veuillez réessayer.",
    },
  },
  mail: {
    welcomeSubject: "Vous êtes sur la liste d’attente WatchDive — invitez vos binômes",
    welcomeHeading: "Vous êtes sur la liste d’attente WatchDive",
    welcomeIntro:
      "Votre adresse e-mail est confirmée. Envoyez votre lien d’invitation personnel aux plongeurs avec qui vous descendez. Chaque ami qui confirme son e-mail vous rapproche de la récompense suivante.",
    welcomeTiersHeading: "Vos récompenses",
    welcomeButton: "Partager mon lien",
    welcomeFallback: "Ou copiez ce lien :",
    welcomeStatus: "Suivez vos invitations et choisissez un pseudo pour le classement :",
    welcomeRules: "Règlement officiel :",
    welcomeOutro: "Nous vous écrirons dès l’ouverture de WatchDive sur Kickstarter.",
    noticeSubject: "Un binôme s’est inscrit via votre lien (total : {count})",
    noticeHeading: "Un binôme s’est inscrit via votre lien",
    noticeBody: "Amis inscrits via votre lien qui ont confirmé leur e-mail : {count}.",
    noticeTierReached: "Palier atteint — {tier} : {reward}",
    noticeNext: "Pour {tier} : encore {remaining}.",
    noticeMax: "Tous les paliers sont atteints. Continuez, visez le top {winners} !",
    noticeButton: "Voir mes invitations",
    noticeFooter: "Vous pouvez désactiver ces e-mails depuis votre page d’invitations.",
  },
  rules: {
    title: "Règlement officiel « Invitez votre binôme »",
    updated: "Dernière mise à jour : 22 octobre 2026",
    privacyLink: "politique de confidentialité",
    sections: [
      {
        heading: "Organisateur",
        paragraphs: [
          "« Invitez votre binôme » est organisé par DIVEROID LTD, fabricant de WatchDive (société n° 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, Royaume-Uni). Questions : help@diveroid.com.",
        ],
      },
      {
        heading: "Qui peut participer",
        paragraphs: [
          "Vous devez avoir au moins {ageOther} ans, ou {ageKr} ans si vous résidez en Corée du Sud, et être majeur selon la loi de votre lieu de résidence. Les salariés et prestataires de DIVEROID LTD et des sociétés de son groupe, les personnes qui participent à l’organisation de ce programme et les membres de leur foyer ne peuvent pas recevoir de lots physiques. Vous pouvez participer depuis n’importe quel pays, mais les lampes et les WatchDive ne peuvent être envoyés que dans un pays desservi par la campagne Kickstarter de WatchDive. Nous publierons cette liste sur cette page avant l’heure de clôture. Si vous résidez ailleurs, vous recevez quand même l’e-mail de lancement en avance et le lien Palanquée, mais le lot physique passe à la personne suivante dans l’ordre. Le programme est nul là où la loi l’interdit.",
        ],
      },
      {
        heading: "Période",
        paragraphs: [
          "Le programme commence le 22 octobre 2026 et se termine juste avant l’ouverture de la campagne WatchDive sur Kickstarter, prévue en décembre 2026, et au plus tard le {longStop}. Nous annoncerons l’heure exacte de clôture sur cette page et par e-mail au moins {noticeDays} jours à l’avance.",
        ],
      },
      {
        heading: "Comment participer",
        paragraphs: [
          "Inscrivez-vous sur la liste d’attente WatchDive et confirmez votre adresse e-mail : vous recevez alors un lien d’invitation personnel. Un ami compte pour vous lorsqu’il ouvre votre lien, s’inscrit sur la liste d’attente et confirme son adresse e-mail.",
          "Aucun achat ni aucune contribution Kickstarter n’est nécessaire pour participer ou gagner. Le lien au tarif early bird ne sert que si vous décidez de soutenir la campagne.",
        ],
      },
      {
        heading: "Ce qui compte",
        paragraphs: [
          "Seuls les amis qui confirment leur adresse e-mail comptent, et chaque personne ne compte qu’une fois. Une nouvelle inscription de la même personne ne compte pas, même si elle utilise la même boîte de réception sous une autre forme (par exemple une adresse Gmail avec des points ou un +libellé, ou le même nom chez icloud.com, me.com et mac.com). Votre propre adresse ne compte jamais pour vous, et vous inviter vous-même avec une autre adresse enfreint les règles de fair-play. Les adresses de services d’e-mail jetable connus et les inscriptions signalées comme abusives ne comptent pas non plus.",
          "Un ami compte pour le lien d’invitation qu’il a utilisé lors de sa première inscription sur la liste d’attente. S’il se réinscrit via un autre lien, il ne change pas de parrain et ne compte pas deux fois. Les amis inscrits via votre lien qui ont confirmé leur adresse avant le début du programme, le 22 octobre 2026, comptent aussi.",
          "Au maximum {cap} amis sont comptés par personne et par jour, selon le jour où chaque ami confirme son adresse (heure normale de Corée). Les amis au-delà de cette limite ne sont pas comptés, ni ce jour-là ni plus tard. Les amis qui confirment après l’heure de clôture ne comptent pas.",
          "Les compteurs sont figés à l’heure de clôture. Un ami déjà compté qui se désinscrit ensuite des e-mails WatchDive reste compté ; il cesse de compter s’il nous demande de supprimer ses données ou si nous le retirons lors de la vérification.",
          "Une fois qu’un palier est atteint et que nous vous l’avons annoncé, vous le conservez, sauf si notre vérification établit que les amis qui vous l’ont fait atteindre enfreignaient ce règlement. Si vous vous désinscrivez des e-mails WatchDive, vous conservez les récompenses déjà obtenues, mais nous ne pourrons plus vous envoyer l’e-mail de lancement en avance ni les notifications.",
        ],
      },
      {
        heading: "Fair-play",
        paragraphs: [
          "Une seule participation par personne. Il est interdit d’inscrire d’autres personnes sans leur accord, de payer ou de récompenser des inscriptions, d’utiliser des sites d’échange de parrainages et de publier votre lien en réponse ou en commentaire des publicités de WatchDive.",
          "Chaque personne et chaque foyer peut recevoir au maximum une lampe de plongée et un WatchDive gagné ; une même personne peut gagner les deux. Nous le vérifions à l’expédition, d’après le nom, l’adresse et le numéro de téléphone.",
        ],
      },
      {
        heading: "Récompenses",
        paragraphs: [
          "1 ami : l’e-mail de lancement Kickstarter {hoursFirst} heure avant le reste de la liste.",
          "3 amis (Binôme) : l’e-mail de lancement {hoursBuddy} heures avant le reste de la liste.",
          "5 amis (Palanquée) : avant l’ouverture de la campagne, nous vous envoyons par e-mail un lien de contrepartie Kickstarter privé au tarif early bird de {price}. Vous pouvez l’utiliser pendant la campagne, sur le site Kickstarter (navigateur sur ordinateur ou mobile, en étant connecté), même quand les places des {seats} premiers contributeurs sont prises. Il ne fonctionne ni dans l’application Kickstarter, ni pour les contributions tardives (late pledges), ni dans le pledge manager. Une contribution par membre de la Palanquée ; merci de ne pas partager ce lien. Les frais de port et les taxes sont facturés comme pour les autres contributeurs.",
          "10 amis (Chef de file) : une lampe de plongée d’une valeur d’environ {lightValue}. Nous en avons {stock}, attribuées aux {stock} premières personnes qui atteignent 10 amis, dans l’ordre où elles y parviennent. Quand il n’y en aura plus, nous l’indiquerons sur cette page.",
          "Top {winners} : les {winners} personnes qui comptent le plus d’amis à l’heure de clôture reçoivent chacune un WatchDive. En cas d’égalité, la personne qui a atteint ce nombre en premier est mieux classée.",
          "Un WatchDive gagné correspond à un caisson à capteur WatchDive, en version Apple Watch ou Galaxy Watch au choix du gagnant, d’une valeur de {prizeValue} (prix public prévu). La montre n’est pas incluse et WatchDive ne fonctionne qu’avec les modèles compatibles indiqués sur notre site. Les lots ne peuvent pas être échangés contre de l’argent.",
        ],
      },
      {
        heading: "Si la campagne est retardée ou n’a pas lieu",
        paragraphs: [
          "Si la campagne Kickstarter n’a pas ouvert d’ici le {longStop}, le programme se termine quand même à ce moment-là. Une fois l’heure de clôture annoncée, nous ne la modifierons qu’une seule fois au plus, en prévenant par e-mail au moins 48 heures avant l’heure initiale. Même si la campagne n’atteint pas son objectif, est annulée ou retardée, les personnes du top {winners} reçoivent chacune un WatchDive. Si nous arrêtons le programme plus tôt, le classement sera établi d’après les compteurs à ce moment-là et les lots du top {winners} seront attribués sur cette base.",
        ],
      },
      {
        heading: "Vérification et disqualification",
        paragraphs: [
          "L’ordre d’attribution des lampes et le classement restent provisoires jusqu’à la vérification. Avant l’envoi de toute lampe ou de tout WatchDive, nous vérifions les amis comptés. Nous pouvons retirer les amis qui enfreignent ce règlement et disqualifier toute personne qui utilise des inscriptions fausses ou automatisées ou qui ne respecte pas les règles de fair-play. Nous contactons les gagnants par e-mail dans les 14 jours suivant la clôture (pour les lampes : dans les 14 jours suivant la vérification). Si un gagnant ne répond pas sous 14 jours ou ne peut pas recevoir la récompense selon ce règlement, la lampe passe au Chef de file suivant dans l’ordre d’arrivée à 10 amis, et le WatchDive à la personne suivante du classement.",
        ],
      },
      {
        heading: "Livraison, frais de port et taxes",
        paragraphs: [
          "Les destinataires paient les frais de port ainsi que les éventuels droits de douane et taxes. Nous expédions uniquement vers les pays desservis par la campagne Kickstarter de WatchDive. Les lampes sont envoyées après vérification, et tous les lots physiques sont envoyés avant {deliveryBy}.",
          "Pour les gagnants résidant en Corée du Sud, la loi coréenne impose à celui qui remet le lot de retenir {taxRate} % d’impôt sur le revenu (impôt sur les autres revenus et impôt local) sur tout lot dont la valeur imposable dépasse {taxFree}. Cela concerne aussi bien la lampe (d’une valeur d’environ {lightValue}) que le WatchDive. Avant l’envoi, nous vous indiquons le montant et vous demandons de nous le régler ; nous le déclarons et le versons ensuite à l’administration fiscale. Pour cela, nous demandons aux gagnants résidant en Corée leur nom légal, leur numéro d’enregistrement de résident et leur adresse, utilisés uniquement pour la déclaration fiscale et conservés seulement pendant la durée exigée par la loi fiscale.",
        ],
      },
      {
        heading: "Classement et confidentialité",
        paragraphs: [
          "Le classement n’affiche que le pseudo que vous avez choisi et décidé d’afficher. Votre adresse e-mail n’est jamais affichée. Les personnes qui n’affichent pas de pseudo apparaissent sous le nom « Plongeur anonyme ». Un pseudo compte de {min} à {max} caractères : lettres, chiffres, espaces, points, tirets et tirets bas, sans mélanger lettres latines et lettres cyrilliques ou grecques. Il ne peut contenir ni adresse e-mail, ni numéro de téléphone, ni lien, ni ressembler à un nom de WatchDive, de Kickstarter ou de leurs équipes (comme « admin » ou « staff »). Nous pouvons masquer un pseudo offensant ou qui usurpe l’identité de quelqu’un. Le classement et les compteurs de votre page d’invitations sont actualisés à quelques minutes d’intervalle : un nouvel ami peut donc mettre quelques minutes à apparaître.",
          "Nous ne vous disons jamais quels amis se sont inscrits, seulement combien. Consultez notre politique de confidentialité pour savoir comment nous traitons les données de la liste d’attente.",
        ],
      },
      {
        heading: "Modifications",
        paragraphs: [
          "Si nous devons modifier ou arrêter le programme, nous l’annoncerons d’abord ici et par e-mail. Une modification ne vous retire jamais une récompense déjà obtenue et ne réduit jamais les lots du top {winners}.",
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
      reward:
        "Du bekommst die E-Mail zum Kickstarter-Start {hours} Stunde vor der allgemeinen Liste.",
    },
    buddy: {
      name: "Buddy · 3 Freunde",
      reward:
        "Du bekommst die E-Mail zum Kickstarter-Start {hours} Stunden vor der allgemeinen Liste.",
    },
    team: {
      name: "Tauchteam · 5 Freunde",
      reward:
        "Du bekommst einen privaten Kickstarter-Reward-Link zum Early-Bird-Preis von {price}. Er funktioniert während der laufenden Kampagne auf der Kickstarter-Website, auch wenn die Plätze für die ersten {seats} Unterstützer schon vergeben sind. Eine Unterstützung pro Tauchteam-Mitglied. Bitte gib den Link nicht weiter.",
    },
    leader: {
      name: "Teamleiter · 10 Freunde",
      reward:
        "Du bekommst eine Tauchlampe im Wert von rund {lightValue}. {stock} Stück sind da, vergeben in der Reihenfolge, in der 10 Freunde erreicht werden. Versand und Steuern zahlt der Empfänger.",
    },
  },
  top: {
    name: "Top {winners} der Einladenden",
    reward:
      "Die {winners} Personen mit den meisten bestätigten Freunden zum Endzeitpunkt bekommen je ein WatchDive, auch wenn sich die Kampagne verzögert oder nicht stattfindet. Versand und Steuern zahlt der Empfänger.",
  },
  countingNote: "Es zählen nur Freunde, die ihre E-Mail-Adresse bestätigen.",
  card: {
    title: "Lade deine Tauchbuddys ein",
    body: "Schick deinen Link los. Jeder Freund, der seine E-Mail-Adresse bestätigt, bringt dich der nächsten Belohnung näher.",
    progress: "{count} dabei · noch {remaining} bis {tier}",
    progressNone: "Noch niemand dabei · noch {remaining} bis {tier}",
    progressMax: "{count} dabei · alle Stufen erreicht. Jetzt geht’s um die Top {winners}.",
    statusLink: "Meine Einladungen",
    rulesLink: "Teilnahmebedingungen",
    invitedNote: "Wer dich eingeladen hat, sieht nur, wie viele Freunde dabei sind – nie, wer.",
  },
  leaderboard: {
    title: "Buddy-Einladung: Top {winners}",
    subtitle: "Nur bestätigte Freunde · Stand: {time} · vorläufig bis zur Prüfung",
    entry: "Freunde: {count}",
    privateDiver: "Anonymer Taucher",
    empty:
      "Noch steht niemand in der Rangliste. Mit deiner ersten Einladung könntest du hier auftauchen.",
    closed: "Die Buddy-Einladung ist beendet. Wir prüfen gerade die Gewinner.",
    rulesLink: "Teilnahmebedingungen",
  },
  status: {
    title: "Meine Buddy-Einladung",
    countLabel: "Freunde dabei",
    tierLabel: "Aktuelle Stufe",
    tierNone: "Noch keine",
    rankLabel: "Platz in der Rangliste",
    rankNone: "Noch nicht platziert",
    earlyNotice:
      "Du bekommst die E-Mail zum Kickstarter-Start {hours} Std. vor der allgemeinen Liste.",
    lightEligible:
      "Du bist vorläufig unter den ersten {stock}, die die Stufe Teamleiter erreicht haben. Nach unserer Prüfung melden wir uns per E-Mail wegen deiner Tauchlampe.",
    lightGone: "Alle {stock} Tauchlampen sind vergeben.",
    shareTitle: "Dein Einladungslink",
    nicknameLabel: "Nickname für die Rangliste",
    nicknameHelp:
      "{min}–{max} Zeichen: Buchstaben, Zahlen, Leerzeichen, Punkte, Binde- und Unterstriche. Keine E-Mail-Adressen, Telefonnummern, Links oder Namen, die nach dem WatchDive-Team aussehen.",
    nicknameHiddenNote: "Unser Team hat diesen Nickname ausgeblendet. Bitte wähle einen anderen.",
    leaderboardToggle: "Meinen Nickname in der Top-{winners}-Rangliste zeigen",
    noticesToggle: "Mir eine E-Mail schicken, wenn ein Freund dazukommt",
    save: "Speichern",
    saving: "Wird gespeichert…",
    saved: "Gespeichert",
    invalidLink: "Dieser Link ist ungültig. Öffne den Link aus deiner neuesten WatchDive-E-Mail.",
    errors: {
      too_short: "Verwende mindestens {min} Zeichen.",
      too_long: "Verwende höchstens {max} Zeichen.",
      contact_info: "Ein Nickname darf keine E-Mail-Adresse und keine Telefonnummer enthalten.",
      link: "Ein Nickname darf keinen Link enthalten.",
      reserved: "Bitte wähle einen anderen Nickname.",
      invalid_chars:
        "Erlaubt sind Buchstaben, Zahlen, Leerzeichen, Punkte, Bindestriche und Unterstriche – ohne lateinische mit kyrillischen oder griechischen Buchstaben zu mischen.",
      failed: "Speichern hat nicht geklappt. Bitte versuch es noch einmal.",
    },
  },
  mail: {
    welcomeSubject: "Du bist auf der WatchDive-Warteliste — lade deine Buddys ein",
    welcomeHeading: "Du bist auf der WatchDive-Warteliste",
    welcomeIntro:
      "Deine E-Mail-Adresse ist bestätigt. Schick deinen persönlichen Einladungslink an die Taucher, mit denen du ins Wasser gehst. Jeder Freund, der seine E-Mail-Adresse bestätigt, bringt dich der nächsten Belohnung näher.",
    welcomeTiersHeading: "Deine Belohnungen",
    welcomeButton: "Einladungslink teilen",
    welcomeFallback: "Oder kopiere diesen Link:",
    welcomeStatus: "Einladungen ansehen und Nickname für die Rangliste festlegen:",
    welcomeRules: "Teilnahmebedingungen:",
    welcomeOutro: "Wir schreiben dir, sobald WatchDive auf Kickstarter startet.",
    noticeSubject: "Ein Buddy ist über deinen Link dazugekommen (insgesamt {count})",
    noticeHeading: "Ein Buddy ist über deinen Link dazugekommen",
    noticeBody: "Freunde über deinen Link, die ihre E-Mail-Adresse bestätigt haben: {count}.",
    noticeTierReached: "Stufe erreicht – {tier}: {reward}",
    noticeNext: "Noch {remaining} bis {tier}.",
    noticeMax: "Alle Stufen erreicht. Jetzt geht’s um die Top {winners}.",
    noticeButton: "Meine Einladungen",
    noticeFooter: "Du kannst diese E-Mails auf deiner Einladungsseite ausschalten.",
  },
  rules: {
    title: "Teilnahmebedingungen der Buddy-Einladung",
    updated: "Zuletzt aktualisiert: 22. Oktober 2026",
    privacyLink: "Datenschutzerklärung",
    sections: [
      {
        heading: "Veranstalter",
        paragraphs: [
          "Veranstalter der Buddy-Einladung ist DIVEROID LTD, der Hersteller von WatchDive (Company No. 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, Vereinigtes Königreich). Fragen: help@diveroid.com.",
        ],
      },
      {
        heading: "Wer teilnehmen kann",
        paragraphs: [
          "Du musst mindestens {ageOther} Jahre alt sein, in Südkorea mindestens {ageKr}, und an deinem Wohnort volljährig. Beschäftigte und Auftragnehmer von DIVEROID LTD und seinen Konzerngesellschaften, Personen, die an der Durchführung dieses Programms mitwirken, sowie ihre Haushaltsangehörigen können keine Sachpreise erhalten. Teilnehmen kannst du von überall, aber Tauchlampen und WatchDive-Gewinne können wir nur in Länder schicken, die die WatchDive-Kampagne auf Kickstarter beliefert. Diese Liste veröffentlichen wir vor dem Endzeitpunkt auf dieser Seite. Wohnst du woanders, bekommst du trotzdem die frühe Start-E-Mail und den Tauchteam-Link, der Sachpreis geht aber an die nächste Person in der Reihenfolge. Wo das Programm gesetzlich verboten ist, ist die Teilnahme ungültig.",
        ],
      },
      {
        heading: "Zeitraum",
        paragraphs: [
          "Das Programm beginnt am 22. Oktober 2026 und endet unmittelbar vor dem Start der WatchDive-Kampagne auf Kickstarter, der für Dezember 2026 geplant ist, spätestens jedoch am {longStop}. Den genauen Endzeitpunkt geben wir mindestens {noticeDays} Tage vorher auf dieser Seite und per E-Mail bekannt.",
        ],
      },
      {
        heading: "So nimmst du teil",
        paragraphs: [
          "Trag dich auf die WatchDive-Warteliste ein und bestätige deine E-Mail-Adresse. Danach bekommst du deinen persönlichen Einladungslink. Ein Freund zählt für dich, wenn er deinen Link öffnet, sich auf die Warteliste einträgt und seine E-Mail-Adresse bestätigt.",
          "Für die Teilnahme und einen Gewinn ist weder ein Kauf noch eine Unterstützung auf Kickstarter nötig. Den Link zum Early-Bird-Preis nutzt du nur, wenn du dich entscheidest, die Kampagne zu unterstützen.",
        ],
      },
      {
        heading: "Was zählt",
        paragraphs: [
          "Es zählen nur Freunde, die ihre E-Mail-Adresse bestätigen, und jede Person zählt nur einmal. Meldet sich dieselbe Person erneut an, zählt sie nicht noch einmal – auch nicht mit demselben Postfach in anderer Schreibweise (zum Beispiel eine Gmail-Adresse mit Punkten oder einem +Zusatz oder derselbe Name bei icloud.com, me.com und mac.com). Deine eigene Adresse zählt nie für dich, und wer sich mit einer anderen eigenen Adresse selbst einlädt, verstößt gegen die Fair-Play-Regeln. Adressen bekannter Wegwerf-E-Mail-Dienste und als missbräuchlich markierte Anmeldungen zählen ebenfalls nicht.",
          "Ein Freund zählt für den Einladungslink, über den er sich zum ersten Mal auf die Warteliste eingetragen hat. Trägt er sich über einen anderen Link erneut ein, zählt er weder für jemand anderen noch doppelt. Auch Freunde, die sich vor dem Programmstart am 22. Oktober 2026 über deinen Link eingetragen und ihre E-Mail-Adresse bestätigt haben, zählen.",
          "Pro Person werden höchstens {cap} Freunde pro Tag gezählt; maßgeblich ist der Tag, an dem der Freund bestätigt (koreanische Standardzeit). Freunde über diesem Limit werden nicht gezählt, auch nicht an einem späteren Tag. Freunde, die erst nach dem Endzeitpunkt bestätigen, zählen nicht.",
          "Die Zahlen werden zum Endzeitpunkt eingefroren. Ein bereits gezählter Freund, der sich später von den WatchDive-E-Mails abmeldet, zählt weiter. Wer uns bittet, seine Daten zu löschen, oder bei der Prüfung entfernt wird, zählt nicht mehr.",
          "Hast du eine Stufe erreicht und wir haben es dir mitgeteilt, behältst du sie – es sei denn, unsere Prüfung ergibt, dass die Freunde, mit denen du sie erreicht hast, gegen diese Bedingungen verstoßen haben. Meldest du dich selbst von den WatchDive-E-Mails ab, behältst du deine erreichten Belohnungen, wir können dir dann aber weder die frühe Start-E-Mail noch Benachrichtigungen schicken.",
        ],
      },
      {
        heading: "Fair Play",
        paragraphs: [
          "Pro Person ist nur eine Teilnahme erlaubt. Nicht erlaubt ist, andere ohne ihre Zustimmung anzumelden, Anmeldungen zu bezahlen oder mit Gegenleistungen zu belohnen, Empfehlungs-Tauschbörsen zu nutzen oder deinen Link in Antworten oder Kommentaren unter WatchDive-Anzeigen zu posten.",
          "Jede Person und jeder Haushalt kann höchstens eine Tauchlampe und ein WatchDive als Gewinn erhalten; eine Person kann beides gewinnen. Das prüfen wir beim Versand anhand von Name, Adresse und Telefonnummer.",
        ],
      },
      {
        heading: "Belohnungen",
        paragraphs: [
          "1 Freund: die E-Mail zum Kickstarter-Start {hoursFirst} Stunde vor der allgemeinen Liste.",
          "3 Freunde (Buddy): die Start-E-Mail {hoursBuddy} Stunden vor der allgemeinen Liste.",
          "5 Freunde (Tauchteam): Vor dem Start der Kampagne schicken wir dir per E-Mail einen privaten Kickstarter-Reward-Link zum Early-Bird-Preis von {price}. Du kannst ihn während der laufenden Kampagne auf der Kickstarter-Website nutzen (im Browser am Computer oder Smartphone, angemeldet), auch wenn die Plätze für die ersten {seats} Unterstützer schon vergeben sind. In der Kickstarter-App, bei Late Pledges und im Pledge Manager funktioniert er nicht. Eine Unterstützung pro Tauchteam-Mitglied; bitte gib den Link nicht weiter. Versand und Steuern werden wie bei anderen Unterstützern berechnet.",
          "10 Freunde (Teamleiter): eine Tauchlampe im Wert von rund {lightValue}. Wir haben {stock} Stück. Sie gehen an die ersten {stock} Personen, die 10 Freunde erreichen, in der Reihenfolge, in der sie das schaffen. Sind alle vergeben, steht das auf dieser Seite.",
          "Top {winners}: Die {winners} Personen mit den meisten gezählten Freunden zum Endzeitpunkt bekommen je ein WatchDive. Bei Gleichstand liegt vorn, wer die Zahl zuerst erreicht hat.",
          "Ein WatchDive-Gewinn ist ein WatchDive-Sensorgehäuse in der Version für Apple Watch oder Galaxy Watch nach Wahl des Gewinners, im Wert von {prizeValue} (geplanter regulärer Preis). Die Uhr ist nicht enthalten, und WatchDive funktioniert nur mit den unterstützten Uhrenmodellen, die auf unserer Website aufgeführt sind. Eine Barauszahlung ist nicht möglich.",
        ],
      },
      {
        heading: "Wenn sich die Kampagne verzögert oder nicht stattfindet",
        paragraphs: [
          "Ist die Kickstarter-Kampagne bis zum {longStop} nicht gestartet, endet das Programm trotzdem zu diesem Zeitpunkt. Einen angekündigten Endzeitpunkt verschieben wir höchstens einmal und nur mit einer E-Mail mindestens 48 Stunden vor dem ursprünglichen Zeitpunkt. Auch wenn die Kampagne ihr Ziel nicht erreicht, abgesagt wird oder sich verzögert, bekommen die Top {winners} je ein WatchDive. Beenden wir das Programm vorzeitig, ermitteln wir die Rangfolge nach den Zahlen zu diesem Zeitpunkt und vergeben die Gewinne der Top {winners} auf dieser Grundlage.",
        ],
      },
      {
        heading: "Prüfung und Ausschluss",
        paragraphs: [
          "Die Reihenfolge bei den Tauchlampen und die Rangliste sind bis zur Prüfung vorläufig. Bevor eine Lampe oder ein WatchDive verschickt wird, prüfen wir die gezählten Freunde. Wir können Freunde streichen, die gegen diese Bedingungen verstoßen, und alle ausschließen, die gefälschte oder automatisierte Anmeldungen nutzen oder gegen die Fair-Play-Regeln verstoßen. Gewinner benachrichtigen wir innerhalb von 14 Tagen nach dem Endzeitpunkt per E-Mail (Tauchlampen: innerhalb von 14 Tagen nach der Prüfung). Antwortet ein Gewinner nicht innerhalb von 14 Tagen oder kann er die Belohnung nach diesen Bedingungen nicht erhalten, geht die Lampe an den nächsten Teamleiter in der Reihenfolge, in der 10 Freunde erreicht wurden, und ein WatchDive an die nächste Person in der Rangliste.",
        ],
      },
      {
        heading: "Lieferung, Versand und Steuern",
        paragraphs: [
          "Empfänger tragen die Versandkosten sowie alle Zölle und Steuern. Wir versenden nur in Länder, die auch die WatchDive-Kampagne auf Kickstarter beliefert. Tauchlampen werden nach der Prüfung verschickt, alle Sachpreise vor {deliveryBy}.",
          "Für Gewinner mit Wohnsitz in Südkorea muss der Zahlende nach koreanischem Recht {taxRate} % Einkommensteuer (Steuer auf sonstige Einkünfte und lokale Einkommensteuer) auf Gewinne einbehalten, deren steuerpflichtiger Wert {taxFree} übersteigt. Das gilt für die Tauchlampe (Wert rund {lightValue}) ebenso wie für das WatchDive. Vor dem Versand nennen wir dir den Betrag und bitten dich, ihn an uns zu zahlen; wir melden und zahlen ihn dann an das Finanzamt. Dafür erfragen wir bei Gewinnern in Korea den amtlichen Namen, die koreanische Einwohnernummer und die Adresse. Wir nutzen sie nur für die Steuermeldung und bewahren sie nur so lange auf, wie das Steuerrecht es verlangt.",
        ],
      },
      {
        heading: "Rangliste und Datenschutz",
        paragraphs: [
          "Die Rangliste zeigt nur einen Nickname, den du selbst festlegst und anzeigen lässt. Deine E-Mail-Adresse wird nie angezeigt. Wer keinen Nickname anzeigen lässt, erscheint als „Anonymer Taucher“. Ein Nickname hat {min} bis {max} Zeichen: Buchstaben, Zahlen, Leerzeichen, Punkte, Bindestriche und Unterstriche, ohne lateinische mit kyrillischen oder griechischen Buchstaben zu mischen. Er darf weder eine E-Mail-Adresse noch eine Telefonnummer oder einen Link enthalten und nicht nach WatchDive, Kickstarter oder deren Team aussehen (etwa „admin“ oder „staff“). Beleidigende Nicknames oder solche, mit denen sich jemand als eine andere Person ausgibt, können wir ausblenden. Die Rangliste und die Zahlen auf deiner Einladungsseite werden alle paar Minuten aktualisiert; ein neuer Freund kann also ein paar Minuten brauchen, bis er erscheint.",
          "Wir sagen dir nie, welche Freunde dazugekommen sind, nur wie viele. Wie wir mit Wartelistendaten umgehen, steht in unserer Datenschutzerklärung.",
        ],
      },
      {
        heading: "Änderungen",
        paragraphs: [
          "Müssen wir das Programm ändern oder beenden, geben wir das vorher hier und per E-Mail bekannt. Eine Änderung nimmt dir nie eine bereits erreichte Belohnung und verringert nie die Gewinne der Top {winners}.",
        ],
      },
    ],
  },
};

const ptBR: ReferralCopy = {
  programName: "Convide seu parceiro",
  tiers: {
    first: {
      name: "Primeiro convite · 1 amigo",
      reward: "Receba o e-mail de lançamento no Kickstarter {hours} hora antes da lista geral.",
    },
    buddy: {
      name: "Parceiro · 3 amigos",
      reward: "Receba o e-mail de lançamento no Kickstarter {hours} horas antes da lista geral.",
    },
    team: {
      name: "Equipe de mergulho · 5 amigos",
      reward:
        "Ganhe um link de recompensa exclusivo no Kickstarter com o preço early bird de {price}. Ele funciona durante a campanha, no site do Kickstarter, mesmo depois que as vagas dos primeiros {seats} apoiadores acabarem. Um apoio por membro da Equipe de mergulho. Por favor, não compartilhe o link.",
    },
    leader: {
      name: "Líder de mergulho · 10 amigos",
      reward:
        "Ganhe uma lanterna de mergulho avaliada em cerca de {lightValue}. São {stock} unidades, entregues na ordem em que as pessoas chegam a 10 amigos. Frete e impostos por conta de quem recebe.",
    },
  },
  top: {
    name: "Top {winners} em convites",
    reward:
      "As {winners} pessoas com mais amigos verificados no horário de encerramento ganham um WatchDive cada, mesmo que a campanha atrase ou não aconteça. Frete e impostos por conta de quem recebe.",
  },
  countingNote: "Só contam os amigos que confirmam o e-mail.",
  card: {
    title: "Convide seus parceiros de mergulho",
    body: "Mande seu link. Cada amigo que confirma o e-mail deixa você mais perto da próxima recompensa.",
    progress: "Amigos: {count} · mais {remaining} para {tier}",
    progressNone: "Nenhum amigo ainda · mais {remaining} para {tier}",
    progressMax: "Amigos: {count} · você chegou a todos os níveis. Agora é buscar o top {winners}.",
    statusLink: "Ver meus convites",
    rulesLink: "Regulamento oficial",
    invitedNote: "Quem convidou você vê só quantos amigos entraram, nunca quem.",
  },
  leaderboard: {
    title: "Top {winners} · Convide seu parceiro",
    subtitle: "Só amigos verificados · atualizado em {time} · sujeito a análise",
    entry: "Amigos: {count}",
    privateDiver: "Mergulhador anônimo",
    empty: "Ainda não tem ninguém no ranking. Seu primeiro convite pode colocar você aqui.",
    closed: "O “Convide seu parceiro” foi encerrado. Estamos analisando os ganhadores.",
    rulesLink: "Regulamento oficial",
  },
  status: {
    title: "Meus convites",
    countLabel: "Amigos que entraram",
    tierLabel: "Nível atual",
    tierNone: "Nenhum ainda",
    rankLabel: "Posição no ranking",
    rankNone: "Ainda sem posição",
    earlyNotice:
      "Você vai receber o e-mail de lançamento no Kickstarter {hours} h antes da lista geral.",
    lightEligible:
      "Você está, provisoriamente, entre os primeiros {stock} a chegar a Líder de mergulho. Depois da nossa análise, vamos falar com você por e-mail sobre a sua lanterna de mergulho.",
    lightGone: "As {stock} lanternas de mergulho já foram todas distribuídas.",
    shareTitle: "Seu link de convite",
    nicknameLabel: "Apelido no ranking",
    nicknameHelp:
      "De {min} a {max} caracteres: letras, números, espaços, pontos, hifens ou sublinhados. Sem e-mails, telefones, links ou nomes que pareçam da equipe do WatchDive.",
    nicknameHiddenNote: "Nossa equipe ocultou este apelido. Escolha outro, por favor.",
    leaderboardToggle: "Mostrar meu apelido no ranking do top {winners}",
    noticesToggle: "Me avisar por e-mail quando um amigo entrar",
    save: "Salvar",
    saving: "Salvando…",
    saved: "Salvo",
    invalidLink: "Este link não é válido. Abra o link do e-mail mais recente do WatchDive.",
    errors: {
      too_short: "Use pelo menos {min} caracteres.",
      too_long: "Use no máximo {max} caracteres.",
      contact_info: "O apelido não pode ter endereço de e-mail nem telefone.",
      link: "O apelido não pode ter links.",
      reserved: "Escolha outro apelido, por favor.",
      invalid_chars:
        "Use só letras, números, espaços, pontos, hifens ou sublinhados, sem misturar letras latinas com cirílicas ou gregas.",
      failed: "Não foi possível salvar. Tente de novo.",
    },
  },
  mail: {
    welcomeSubject: "Você está na lista de espera do WatchDive — convide seus parceiros",
    welcomeHeading: "Você está na lista de espera do WatchDive",
    welcomeIntro:
      "Seu e-mail foi confirmado. Mande seu link de convite pessoal para quem mergulha com você. Cada amigo que confirma o e-mail deixa você mais perto da próxima recompensa.",
    welcomeTiersHeading: "Recompensas por convite",
    welcomeButton: "Compartilhar meu link",
    welcomeFallback: "Ou copie este link:",
    welcomeStatus: "Veja seus convites e escolha um apelido para o ranking:",
    welcomeRules: "Regulamento oficial:",
    welcomeOutro: "A gente avisa por e-mail assim que o WatchDive abrir no Kickstarter.",
    noticeSubject: "Um parceiro entrou pelo seu link ({count} no total)",
    noticeHeading: "Um parceiro entrou pelo seu link",
    noticeBody: "Amigos que entraram pelo seu link e confirmaram o e-mail: {count}.",
    noticeTierReached: "Você chegou a {tier}: {reward}",
    noticeNext: "Para {tier}: mais {remaining}.",
    noticeMax: "Você chegou a todos os níveis. Agora é buscar o top {winners}.",
    noticeButton: "Ver meus convites",
    noticeFooter: "Você pode desativar estes e-mails na sua página de convites.",
  },
  rules: {
    title: "Regulamento oficial do “Convide seu parceiro”",
    updated: "Última atualização: 22 de outubro de 2026",
    privacyLink: "política de privacidade",
    sections: [
      {
        heading: "Organizador",
        paragraphs: [
          "O “Convide seu parceiro” é realizado pela DIVEROID LTD, fabricante do WatchDive (empresa nº 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, Reino Unido). Dúvidas: help@diveroid.com.",
        ],
      },
      {
        heading: "Quem pode participar",
        paragraphs: [
          "Você precisa ter pelo menos {ageOther} anos, ou {ageKr} se morar na Coreia do Sul, e ser maior de idade segundo a lei do lugar onde mora. Funcionários e prestadores de serviço da DIVEROID LTD e das empresas do seu grupo, pessoas que ajudam a conduzir este programa e quem mora com elas não podem receber prêmios físicos. Você pode participar de qualquer lugar, mas lanternas e prêmios WatchDive só podem ser enviados para países atendidos pela campanha do WatchDive no Kickstarter. Vamos publicar essa lista nesta página antes do horário de encerramento. Se você mora em outro país, continua recebendo o e-mail de lançamento antecipado e o link da Equipe de mergulho, mas o prêmio físico passa para a próxima pessoa na ordem. O programa não vale onde for proibido por lei.",
        ],
      },
      {
        heading: "Período",
        paragraphs: [
          "O programa começa em 22 de outubro de 2026 e termina imediatamente antes de a campanha do WatchDive abrir no Kickstarter, prevista para dezembro de 2026, e, no máximo, até {longStop}. Vamos anunciar o horário exato de encerramento nesta página e por e-mail com pelo menos {noticeDays} dias de antecedência.",
        ],
      },
      {
        heading: "Como participar",
        paragraphs: [
          "Entre na lista de espera do WatchDive e confirme seu e-mail para receber um link de convite pessoal. Um amigo conta para você quando abre seu link, entra na lista de espera e confirma o e-mail.",
          "Não é preciso comprar nada nem apoiar a campanha no Kickstarter para participar ou ganhar. O link com o preço early bird só é usado se você decidir apoiar a campanha.",
        ],
      },
      {
        heading: "O que conta",
        paragraphs: [
          "Só contam os amigos que confirmam o e-mail, e cada pessoa conta uma única vez. Se a mesma pessoa se cadastrar de novo, ela não conta outra vez, mesmo usando a mesma caixa de entrada escrita de outro jeito (por exemplo, um endereço do Gmail com pontos ou com uma +etiqueta, ou o mesmo nome em icloud.com, me.com e mac.com). Seu próprio endereço nunca conta para você, e convidar a si mesmo com outro endereço descumpre as regras de jogo limpo. Também não contam endereços de serviços conhecidos de e-mail descartável nem cadastros marcados como abusivos.",
          "Cada amigo conta para o link de convite que usou na primeira vez que entrou na lista de espera. Se ele se cadastrar de novo por outro link, não passa a contar para outra pessoa nem conta duas vezes. Amigos que entraram pelo seu link e confirmaram o e-mail antes do início do programa, em 22 de outubro de 2026, também contam.",
          "São contados no máximo {cap} amigos por pessoa por dia, pelo dia em que cada amigo confirma o e-mail (horário padrão da Coreia). Amigos acima desse limite não são contados, nem em dias seguintes. Amigos que confirmarem depois do horário de encerramento não contam.",
          "As contagens ficam congeladas no horário de encerramento. Um amigo já contado que depois cancelar a inscrição nos e-mails do WatchDive continua contando; ele deixa de contar se pedir que apaguemos os dados dele ou se for removido na análise.",
          "Depois que você alcança um nível e nós avisamos, ele continua seu, a menos que a análise mostre que os amigos que levaram você até lá descumpriram este regulamento. Se você cancelar a inscrição nos e-mails do WatchDive, mantém as recompensas já alcançadas, mas não poderemos mais enviar o e-mail de lançamento antecipado nem os avisos.",
        ],
      },
      {
        heading: "Jogo limpo",
        paragraphs: [
          "Cada pessoa pode participar uma única vez. Não é permitido cadastrar outras pessoas sem o consentimento delas, pagar ou oferecer vantagens em troca de cadastros, usar sites de troca de indicações nem publicar seu link em respostas ou comentários dos anúncios do WatchDive.",
          "Cada pessoa e cada domicílio pode receber no máximo uma lanterna de mergulho e um WatchDive como prêmio; a mesma pessoa pode ganhar os dois. Conferimos isso no envio, por nome, endereço e telefone.",
        ],
      },
      {
        heading: "Recompensas",
        paragraphs: [
          "1 amigo: o e-mail de lançamento no Kickstarter {hoursFirst} hora antes da lista geral.",
          "3 amigos (Parceiro): o e-mail de lançamento {hoursBuddy} horas antes da lista geral.",
          "5 amigos (Equipe de mergulho): antes de a campanha abrir, enviamos por e-mail um link de recompensa exclusivo no Kickstarter com o preço early bird de {price}. Você pode usá-lo durante a campanha, no site do Kickstarter (navegador no computador ou no celular, com login feito), mesmo depois que as vagas dos primeiros {seats} apoiadores acabarem. Ele não funciona no app do Kickstarter, em apoios atrasados (late pledges) nem no pledge manager. Um apoio por membro da Equipe de mergulho; por favor, não compartilhe o link. Frete e impostos são cobrados como para os demais apoiadores.",
          "10 amigos (Líder de mergulho): uma lanterna de mergulho avaliada em cerca de {lightValue}. Temos {stock} unidades, que vão para as primeiras {stock} pessoas a chegar a 10 amigos, na ordem em que chegarem. Quando acabarem, avisaremos nesta página.",
          "Top {winners}: as {winners} pessoas com mais amigos contados no horário de encerramento ganham um WatchDive cada. Em caso de empate, fica na frente quem chegou primeiro àquele número.",
          "Um prêmio WatchDive é uma caixa com sensor WatchDive, na versão para Apple Watch ou Galaxy Watch à escolha de quem ganhar, avaliada em {prizeValue} (o preço público previsto). O relógio não está incluído, e o WatchDive só funciona com os modelos compatíveis listados no nosso site. Os prêmios não podem ser trocados por dinheiro.",
        ],
      },
      {
        heading: "Se a campanha atrasar ou não acontecer",
        paragraphs: [
          "Se a campanha no Kickstarter não tiver aberto até {longStop}, o programa termina nesse horário mesmo assim. Depois de anunciado, o horário de encerramento muda no máximo uma vez, com aviso por e-mail pelo menos 48 horas antes do horário original. Mesmo que a campanha não atinja a meta, seja cancelada ou atrase, as pessoas do top {winners} ganham um WatchDive cada. Se encerrarmos o programa antes, o ranking será definido pelas contagens daquele momento, e os prêmios do top {winners} serão entregues com base nele.",
        ],
      },
      {
        heading: "Análise e desclassificação",
        paragraphs: [
          "A ordem de entrega das lanternas e o ranking são provisórios até a análise. Antes de enviar qualquer lanterna ou WatchDive, analisamos os amigos contados. Podemos remover amigos que descumpram este regulamento e desclassificar quem usar cadastros falsos ou automatizados ou desrespeitar as regras de jogo limpo. Entramos em contato com os ganhadores por e-mail em até 14 dias após o encerramento (lanternas: em até 14 dias após a análise). Se um ganhador não responder em até 14 dias ou não puder receber a recompensa por este regulamento, a lanterna passa para o próximo Líder de mergulho na ordem de chegada a 10 amigos, e o prêmio WatchDive passa para a próxima pessoa do ranking.",
        ],
      },
      {
        heading: "Entrega, frete e impostos",
        paragraphs: [
          "Quem recebe paga o frete e quaisquer impostos ou taxas de importação. Só enviamos para os países atendidos pela campanha do WatchDive no Kickstarter. As lanternas são enviadas após a análise, e todos os prêmios físicos são enviados antes de {deliveryBy}.",
          "Para ganhadores que moram na Coreia do Sul, a lei coreana exige que quem paga o prêmio retenha {taxRate}% de imposto de renda (imposto sobre outros rendimentos e imposto local) sobre prêmios com valor tributável acima de {taxFree}. Isso vale tanto para a lanterna (avaliada em cerca de {lightValue}) quanto para o WatchDive. Antes do envio, informamos o valor e pedimos que você o pague a nós; nós declaramos e recolhemos o imposto. Para isso, pedimos aos ganhadores na Coreia o nome civil, o número de registro de residente e o endereço, usados só para a declaração fiscal e guardados apenas pelo prazo exigido pela lei tributária.",
        ],
      },
      {
        heading: "Ranking e privacidade",
        paragraphs: [
          "O ranking mostra apenas o apelido que você definiu e escolheu exibir. Seu e-mail nunca aparece. Quem não escolhe exibir um apelido aparece como “Mergulhador anônimo”. O apelido deve ter de {min} a {max} caracteres: letras, números, espaços, pontos, hifens e sublinhados, sem misturar letras latinas com cirílicas ou gregas. Ele não pode ter e-mail, telefone ou link, nem parecer um nome do WatchDive, do Kickstarter ou das suas equipes (como “admin” ou “staff”). Podemos ocultar apelidos ofensivos ou que se passem por outra pessoa. O ranking e as contagens da sua página de convites são atualizados a cada poucos minutos, então um amigo novo pode levar alguns minutos para aparecer.",
          "Nunca dizemos quais amigos entraram, só quantos. Veja nossa política de privacidade para saber como tratamos os dados da lista de espera.",
        ],
      },
      {
        heading: "Mudanças",
        paragraphs: [
          "Se precisarmos alterar ou encerrar o programa, vamos avisar antes, aqui e por e-mail. Nenhuma mudança tira uma recompensa que você já alcançou nem reduz os prêmios do top {winners}.",
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
