// Privacy-policy section for the Buddy Invite referral program, nine locales.
//
// Rendered by src/routes/privacy.tsx only while the owner's switch
// (`referralProgramEnabled`, read on the server) is on. With the switch off the
// policy must stay exactly as it was, so this text lives outside the frozen
// landing catalog, the same way SOCIAL_SIGNUP_PRIVACY does.
//
// Every statement must match what the program actually processes:
//   - stored columns: src/lib/referral/contract.ts REFERRAL_COLUMNS
//   - counting and fraud signals: src/lib/referral/ledger.ts, eligibility.ts,
//     scripts/referral-report.ts (friends' domains, timing, locale, landing
//     path and UTM only flag; ops decides, see docs/referral-program-ops.md)
//   - mails: src/lib/verification/resend.ts (guide + friend-joined notices)
//   - the `?ref=` code kept in localStorage `wd_ref` by src/routes/index.tsx
//   - processors: only those already named in policy section 5
// Program name, "private diver" label and the leaderboard size are filled in
// from referral copy and program.ts, so they can never drift from the rules.

import type { Locale } from "./i18n/locale.ts";
import { fill, referralCopy } from "./referral/copy.ts";
import { TOP_PRIZE_WINNERS } from "./referral/program.ts";

/** A bold lead followed by its explanation, like the items in section 2. */
export type PrivacyLead = readonly [lead: string, body: string];

export type BuddyInvitePrivacyCopy = {
  title: string;
  intro: string;
  storedIntro: string;
  stored: readonly PrivacyLead[];
  friends: PrivacyLead;
  purposesIntro: string;
  purposes: readonly string[];
  visibility: PrivacyLead;
  prizes: PrivacyLead;
  legalBasis: PrivacyLead;
  sharing: PrivacyLead;
  retention: PrivacyLead;
  /** Contains help@diveroid.com, rendered as a mailto link. */
  rights: PrivacyLead;
};

// Placeholders: {program} {privateDiver} {winners}
const TEXT: Record<Locale, BuddyInvitePrivacyCopy> = {
  en: {
    title: "11. {program}",
    intro:
      "{program} is our friend invite program. Every waitlist record gets an invite code when it is created. While the program runs, we email your invite link and status page once you confirm your email, and we count the friends who join through your link. DIVEROID LTD (Section 1) is the controller. This section adds to the sections above while the program runs.",
    storedIntro: "What we store for the program, with your waitlist record:",
    stored: [
      [
        "Your invite code",
        " — an 8-character code created with your waitlist record and used in your invite link.",
      ],
      [
        "Who invited you",
        " — if you joined through a friend's link, that friend's invite code, not their name or email address. The code from the link is also kept in your browser's local storage, so it can be added when you sign up.",
      ],
      ["Nickname", " — only if you set one on your {program} status page."],
      [
        "Your choices",
        " — whether your nickname is shown on the leaderboard and whether we email you when a friend joins.",
      ],
      [
        "Counts and review status",
        " — how many confirmed friends are counted for you, the last count we emailed you and when, whether our team hid your nickname, and the status of any manual reward review.",
      ],
    ],
    friends: [
      "Invited friends' records",
      " — to count invites and review rewards, we also use details already held in the waitlist records of people who joined through your link: whether and when they confirmed their email, their email address and its domain, signup time, page language, landing page, campaign tags and abuse flags. Email addresses are compared only on our server, to catch self-invites, repeat signups and disposable addresses.",
    ],
    purposesIntro: "We use this information to:",
    purposes: [
      "count confirmed friends and apply the program rules, including the daily limit and the closing time;",
      "give the rewards you reach: the earlier launch email, the early-bird price link and prizes;",
      "review rewards for fraud, such as self-invites, repeat or disposable addresses and automated signups — review signals only flag a record, and a person decides before a reward is refused;",
      "send program emails: the invite guide and, unless you turn them off, an email when a friend joins.",
    ],
    visibility: [
      "Who sees what",
      ' — your counts are shown only to you: on your status page, opened from the signed link in our emails, and in program emails. They show how many friends counted, never who they are. The public top {winners} leaderboard shows each place\'s rank and friend count, with a nickname only if that person set one, chose to show it and our team has not hidden it; otherwise it shows "{privateDiver}". Email addresses are never shown.',
    ],
    prizes: [
      "Prize winners",
      " — if you win a prize that has to be shipped (an underwater light or a WatchDive), we ask you by email for the details needed to deliver it: your name, shipping address and phone number. Where Korean withholding tax applies to a prize, we also collect the identification details the law requires for that tax and use them only to withhold and report it. We give shipping details only to the delivery service that ships the prize, and tax details only to the tax authority where the law requires it.",
    ],
    legalBasis: [
      "Legal basis",
      " — under the GDPR and UK GDPR, we count invites, give rewards and send program emails to carry out the program rules you take part in (contract). Recording who invited you and reviewing invites and rewards for fraud rely on our legitimate interest in running a fair program. Your nickname is shown only if you choose it (consent), and you can withdraw that choice on your status page at any time. We process tax identification details to meet a legal obligation. Under Korea's Personal Information Protection Act (PIPA), we process program data and prize shipping details as necessary to run the program and deliver the prize you claim, and tax identification details only where a law requires it.",
    ],
    sharing: [
      "Where it is kept",
      " — {program} data is kept with your waitlist record in Notion, program emails are sent through Resend, and the pages run on Vercel: the processors listed in Section 5. We never sell it.",
    ],
    retention: [
      "How long we keep it",
      " — we keep {program} data until the program has closed and every reward has been delivered, then delete or anonymise it. Prize shipping details are kept only for that delivery. Tax records are kept only as long as the law requires, then deleted. If you ask us to delete your waitlist record sooner, your {program} data is deleted with it.",
    ],
    rights: [
      "Your choices and rights",
      " — you can change your nickname, leaderboard choice and friend-joined emails at any time on your status page. The rights in Section 7 apply to {program} data too. To use them, or with questions about the program, email help@diveroid.com.",
    ],
  },
  ko: {
    title: "11. {program}",
    intro:
      "{program}는 친구 초대 프로그램입니다. 모든 대기명단 기록에는 생성될 때 초대 코드가 함께 만들어집니다. 프로그램이 운영되는 동안에는 이메일 인증을 마치면 초대 링크와 현황 페이지를 이메일로 보내 드리고, 그 링크로 가입한 친구를 집계합니다. 처리 책임자는 DIVEROID LTD(1항)입니다. 이 항은 프로그램이 운영되는 동안 위의 각 항에 더해 적용됩니다.",
    storedIntro: "프로그램을 위해 대기명단 기록에 함께 저장하는 정보:",
    stored: [
      ["내 초대 코드", " — 대기명단 기록과 함께 만들어지는 8자리 코드로, 초대 링크에 쓰입니다."],
      [
        "나를 초대한 사람",
        " — 친구의 링크로 가입한 경우 그 친구의 초대 코드만 저장하며, 이름이나 이메일 주소는 저장하지 않습니다. 링크의 코드는 가입할 때 함께 기록되도록 브라우저의 로컬 저장소에도 보관됩니다.",
      ],
      ["닉네임", " — {program} 현황 페이지에서 직접 정한 경우에만 저장합니다."],
      [
        "내 선택",
        " — 랭킹에 닉네임을 표시할지, 친구가 참여했을 때 이메일 알림을 받을지 여부입니다.",
      ],
      [
        "집계 수와 검수 상태",
        " — 나에게 집계된 인증 완료 친구 수, 마지막으로 이메일로 알려드린 수와 그 시각, 운영팀의 닉네임 숨김 여부, 수동 혜택 검수 상태입니다.",
      ],
    ],
    friends: [
      "초대된 친구의 기록",
      " — 초대를 집계하고 혜택을 검수하기 위해, 내 링크로 가입한 사람의 대기명단 기록에 이미 있는 정보도 사용합니다: 이메일 인증 여부와 시각, 이메일 주소와 도메인, 가입 시각, 페이지 언어, 유입 페이지, 캠페인 태그, 부정 이용 표시. 이메일 주소는 본인 초대, 중복 가입, 일회용 주소를 가려내기 위해 서버 안에서만 비교합니다.",
    ],
    purposesIntro: "이 정보는 다음 목적으로 이용합니다:",
    purposes: [
      "인증을 마친 친구 수를 집계하고 하루 집계 한도와 마감 시각 등 프로그램 규칙을 적용;",
      "달성한 혜택 제공: 런칭 소식 먼저 받기, 얼리버드 가격 링크, 경품;",
      "본인 초대, 중복·일회용 주소, 자동화된 가입 등 부정 이용에 대한 혜택 검수 — 검수 신호는 표시만 할 뿐이며, 혜택을 거절하기 전에는 사람이 직접 판단합니다;",
      "프로그램 이메일 발송: 초대 안내 메일, 그리고 끄지 않은 경우 친구 참여 알림 메일.",
    ],
    visibility: [
      "누가 무엇을 보는지",
      " — 집계 수는 본인에게만 보입니다. 이메일에 담긴 서명된 링크로 여는 현황 페이지와 프로그램 이메일에서 확인할 수 있으며, 몇 명이 집계되었는지만 보여 주고 그 친구가 누구인지는 절대 보여 주지 않습니다. 공개 랭킹 Top {winners}에는 순위와 친구 수가 표시되며, 닉네임은 본인이 정하고 공개를 선택했으며 운영팀이 숨기지 않은 경우에만 표시합니다. 그 밖의 경우 ‘{privateDiver}’로 표시됩니다. 이메일 주소는 절대 공개하지 않습니다.",
    ],
    prizes: [
      "경품 당첨자",
      " — 배송이 필요한 경품(수중 라이트 또는 WatchDive)에 당첨되면, 배송에 필요한 정보인 이름, 배송지 주소, 전화번호를 이메일로 요청합니다. 경품에 한국의 기타소득세 원천징수가 적용되는 경우, 그 세금 신고에 법령상 필요한 신원 확인 정보도 수집하며, 원천징수와 신고에만 사용합니다. 배송 정보는 경품을 배송하는 배송업체에만, 세무 정보는 법령이 요구하는 경우 세무 당국에만 제공합니다.",
    ],
    legalBasis: [
      "법적 근거",
      " — GDPR 및 영국 GDPR상, 초대 집계, 혜택 제공, 프로그램 이메일 발송은 이용자가 참여하는 프로그램 규칙을 이행하기 위한 것입니다(계약). 나를 초대한 사람의 기록과 초대·혜택의 부정 이용 검수는 공정한 프로그램 운영이라는 정당한 이익에 근거합니다. 닉네임은 본인이 선택한 경우에만 공개되며(동의), 그 선택은 현황 페이지에서 언제든 철회할 수 있습니다. 세무 신원 정보는 법적 의무를 이행하기 위해 처리합니다. 한국 「개인정보 보호법」상, 프로그램 정보와 경품 배송 정보는 프로그램 운영과 신청하신 경품 배송에 필요한 범위에서 처리하며, 세무 신원 정보는 법령이 요구하는 경우에만 처리합니다.",
    ],
    sharing: [
      "보관 위치",
      " — {program} 정보는 대기명단 기록과 함께 Notion에 보관하고, 프로그램 이메일은 Resend로 발송하며, 페이지는 Vercel에서 운영됩니다. 모두 5항에 적은 처리자입니다. 이 정보를 판매하지 않습니다.",
    ],
    retention: [
      "보유 기간",
      " — {program} 정보는 프로그램이 마감되고 모든 혜택의 제공이 끝날 때까지 보관한 뒤 삭제하거나 익명 처리합니다. 경품 배송 정보는 해당 배송에만 보관합니다. 세무 기록은 법령이 정한 기간 동안만 보관한 뒤 삭제합니다. 그 전에 대기명단 기록 삭제를 요청하시면 {program} 정보도 함께 삭제됩니다.",
    ],
    rights: [
      "선택과 권리",
      " — 닉네임, 랭킹 표시 여부, 친구 참여 알림은 현황 페이지에서 언제든 바꿀 수 있습니다. 7항의 권리는 {program} 정보에도 똑같이 적용됩니다. 권리를 행사하거나 프로그램에 대해 문의하시려면 help@diveroid.com으로 이메일을 보내 주세요.",
    ],
  },
  "zh-CN": {
    title: "11. {program}",
    intro:
      "{program}是我们的好友邀请活动。每条候补名单记录在创建时都会生成一个邀请码。活动期间，你确认邮箱后，我们会通过邮件发送你的邀请链接和状态页面，并统计通过你的链接加入的朋友。控制者为 DIVEROID LTD（见第 1 条）。活动进行期间，本条在以上各条之外适用。",
    storedIntro: "为活动随候补名单记录一起保存的信息：",
    stored: [
      ["你的邀请码", " — 随候补名单记录生成的 8 位代码，用于你的邀请链接。"],
      [
        "邀请你的人",
        " — 如果你通过朋友的链接加入，我们只保存该朋友的邀请码，不保存其姓名或邮箱地址。链接中的邀请码也会保存在浏览器的本地存储中，以便在你注册时一并记录。",
      ],
      ["昵称", " — 仅在你于{program}状态页面上设置时保存。"],
      ["你的选择", " — 是否在排行榜上显示昵称，以及有朋友加入时是否给你发邮件。"],
      [
        "计数与审核状态",
        " — 计入你名下的已确认朋友数、上次邮件通知你的数量及时间、我们的团队是否隐藏了你的昵称，以及人工奖励审核的状态。",
      ],
    ],
    friends: [
      "受邀朋友的记录",
      " — 为了计入邀请和审核奖励，我们也会使用通过你的链接加入者的候补名单记录中已有的信息：是否以及何时确认邮箱、邮箱地址及其域名、注册时间、页面语言、落地页、活动标签和滥用标记。邮箱地址只在我们的服务器上比对，用于识别自我邀请、重复注册和一次性邮箱。",
    ],
    purposesIntro: "我们将这些信息用于：",
    purposes: [
      "统计已确认的朋友，并执行活动规则，包括每日上限和截止时间；",
      "发放你达成的奖励：提前收到上线邮件、早鸟价链接和奖品；",
      "审核奖励中的作弊行为，例如自我邀请、重复或一次性邮箱以及自动化注册——审核信号只做标记，拒绝任何奖励前都由人工判断；",
      "发送活动邮件：邀请指南，以及在你未关闭时，朋友加入的通知邮件。",
    ],
    visibility: [
      "谁能看到什么",
      " — 你的计数只对你本人显示：在通过邮件中签名链接打开的状态页面上，以及活动邮件中。我们只显示计入了多少位朋友，绝不显示他们是谁。公开的前 {winners} 名排行榜显示每个名次的排名和朋友数；只有当本人设置了昵称、选择显示且未被我们的团队隐藏时才显示昵称，否则显示“{privateDiver}”。邮箱地址绝不公开。",
    ],
    prizes: [
      "获奖者",
      " — 如果你获得需要寄送的奖品（水下灯或 WatchDive），我们会通过邮件向你索取寄送所需的信息：姓名、收货地址和电话号码。如果奖品适用韩国的预扣税，我们还会收集该税款依法所需的身份识别信息，且仅用于代扣代缴和申报。收货信息只提供给寄送奖品的物流服务商，税务信息只在法律要求时提供给税务机关。",
    ],
    legalBasis: [
      "法律依据",
      " — 根据 GDPR 和英国 GDPR，统计邀请、发放奖励和发送活动邮件是为了履行你所参与的活动规则（合同）。记录邀请你的人以及审核邀请和奖励中的作弊行为，基于我们公平开展活动的正当利益。只有在你选择时才显示你的昵称（同意），你可以随时在状态页面上撤回该选择。处理税务身份信息是为了履行法定义务。根据韩国《个人信息保护法》，我们在开展活动和寄送你领取的奖品所必需的范围内处理活动信息和奖品收货信息，税务身份信息仅在法律要求时处理。",
    ],
    sharing: [
      "存放位置",
      " — {program}信息随你的候补名单记录保存在 Notion 中，活动邮件通过 Resend 发送，页面运行在 Vercel 上，均为第 5 条所列的处理方。我们绝不出售这些信息。",
    ],
    retention: [
      "保存期限",
      " — {program}信息保存至活动截止且所有奖励发放完毕，之后删除或匿名化。奖品收货信息仅为该次寄送保存。税务记录仅在法律要求的期限内保存，之后删除。如果你在此之前要求删除候补名单记录，{program}信息也会一并删除。",
    ],
    rights: [
      "你的选择与权利",
      " — 你可以随时在状态页面上更改昵称、排行榜显示和朋友加入通知。第 7 条所列的权利同样适用于{program}信息。如需行使这些权利或咨询活动相关问题，请发邮件至 help@diveroid.com。",
    ],
  },
  "zh-TW": {
    title: "11. {program}",
    intro:
      "{program}是我們的好友邀請活動。每筆候補名單紀錄在建立時都會產生一組邀請碼。活動期間，你確認電子郵件後，我們會寄送你的邀請連結與狀態頁面，並計算透過你的連結加入的朋友。控制者為 DIVEROID LTD（見第 1 條）。活動進行期間，本條在以上各條之外適用。",
    storedIntro: "為活動隨候補名單紀錄一併儲存的資訊：",
    stored: [
      ["你的邀請碼", " — 隨候補名單紀錄產生的 8 位代碼，用於你的邀請連結。"],
      [
        "邀請你的人",
        " — 如果你透過朋友的連結加入，我們只儲存該朋友的邀請碼，不儲存其姓名或電子郵件地址。連結中的邀請碼也會保存在瀏覽器的本機儲存空間中，以便在你註冊時一併記錄。",
      ],
      ["暱稱", " — 僅在你於{program}狀態頁面上設定時儲存。"],
      ["你的選擇", " — 是否在排行榜上顯示暱稱，以及有朋友加入時是否寄信通知你。"],
      [
        "計數與審核狀態",
        " — 計入你名下的已確認朋友數、上次寄信通知你的數量與時間、我們的團隊是否隱藏了你的暱稱，以及人工獎勵審核的狀態。",
      ],
    ],
    friends: [
      "受邀朋友的紀錄",
      " — 為了計入邀請並審核獎勵，我們也會使用透過你的連結加入者的候補名單紀錄中已有的資訊：是否以及何時確認電子郵件、電子郵件地址及其網域、註冊時間、頁面語言、到達頁面、活動標籤與濫用標記。電子郵件地址只在我們的伺服器上比對，用於辨識自我邀請、重複註冊與拋棄式信箱。",
    ],
    purposesIntro: "我們將這些資訊用於：",
    purposes: [
      "計算已確認的朋友，並執行活動規則，包括每日上限與截止時間；",
      "發放你達成的獎勵：提前收到上線信、早鳥價連結與獎品；",
      "審核獎勵中的舞弊行為，例如自我邀請、重複或拋棄式信箱以及自動化註冊——審核訊號只做標記，拒絕任何獎勵前都由人工判斷；",
      "寄送活動信件：邀請指南，以及在你未關閉時，朋友加入的通知信。",
    ],
    visibility: [
      "誰能看到什麼",
      " — 你的計數只對你本人顯示：在透過信件中簽署連結開啟的狀態頁面上，以及活動信件中。我們只顯示計入了多少位朋友，絕不顯示他們是誰。公開的前 {winners} 名排行榜顯示每個名次的排名與朋友數；只有在本人設定了暱稱、選擇顯示且未被我們的團隊隱藏時才顯示暱稱，否則顯示「{privateDiver}」。電子郵件地址絕不公開。",
    ],
    prizes: [
      "得獎者",
      " — 如果你獲得需要寄送的獎品（水下燈或 WatchDive），我們會透過電子郵件向你索取寄送所需的資訊：姓名、收件地址與電話號碼。如果獎品適用韓國的扣繳稅款，我們也會蒐集該稅款依法所需的身分識別資訊，且僅用於扣繳與申報。收件資訊只提供給寄送獎品的物流業者，稅務資訊只在法律要求時提供給稅務機關。",
    ],
    legalBasis: [
      "法律依據",
      " — 依據 GDPR 與英國 GDPR，計算邀請、發放獎勵與寄送活動信件是為了履行你所參加的活動規則（契約）。記錄邀請你的人以及審核邀請與獎勵中的舞弊行為，基於我們公平舉辦活動的正當利益。只有在你選擇時才會顯示你的暱稱（同意），你可以隨時在狀態頁面上撤回該選擇。處理稅務身分資訊是為了履行法定義務。依據韓國《個人資訊保護法》，我們在舉辦活動與寄送你領取的獎品所必要的範圍內處理活動資訊與獎品收件資訊，稅務身分資訊僅在法律要求時處理。",
    ],
    sharing: [
      "存放位置",
      " — {program}資訊隨你的候補名單紀錄保存在 Notion 中，活動信件透過 Resend 寄送，頁面由 Vercel 代管，皆為第 5 條所列的處理者。我們絕不出售這些資訊。",
    ],
    retention: [
      "保存期間",
      " — {program}資訊保存至活動截止且所有獎勵發放完畢，之後刪除或匿名化。獎品收件資訊僅為該次寄送保存。稅務紀錄僅在法律要求的期間內保存，之後刪除。如果你在此之前要求刪除候補名單紀錄，{program}資訊也會一併刪除。",
    ],
    rights: [
      "你的選擇與權利",
      " — 你可以隨時在狀態頁面上變更暱稱、排行榜顯示與朋友加入通知。第 7 條所列的權利同樣適用於{program}資訊。如需行使這些權利或詢問活動相關問題，請寄信至 help@diveroid.com。",
    ],
  },
  ja: {
    title: "11. {program}",
    intro:
      "{program}は、当社の友だち招待プログラムです。ウェイトリストの記録には作成時に招待コードが付きます。プログラムの実施中は、メールアドレスの確認後に招待リンクと状況ページをメールでお送りし、そのリンクから登録した友だちをカウントします。管理者は DIVEROID LTD（第 1 条）です。この条は、プログラムの実施中、上記の各条に加えて適用されます。",
    storedIntro: "プログラムのためにウェイトリストの記録とともに保存する情報:",
    stored: [
      [
        "ご自身の招待コード",
        " — ウェイトリストの記録とともに作られる 8 文字のコードで、招待リンクに使われます。",
      ],
      [
        "招待した人",
        " — 友だちのリンクから登録した場合は、その友だちの招待コードだけを保存し、名前やメールアドレスは保存しません。リンクのコードは、登録時に記録できるよう、ブラウザのローカルストレージにも保存されます。",
      ],
      ["ニックネーム", " — {program}の状況ページで設定した場合だけ保存します。"],
      [
        "ご自身の選択",
        " — ランキングにニックネームを表示するかどうか、友だちが参加したときにメールで知らせるかどうか。",
      ],
      [
        "カウントと審査の状況",
        " — お客様にカウントされた確認済みの友だちの数、最後にメールでお知らせした数とその日時、当社チームがニックネームを非表示にしたかどうか、手動による特典審査の状況。",
      ],
    ],
    friends: [
      "招待された友だちの記録",
      " — 招待のカウントと特典の審査のため、お客様のリンクから登録した方のウェイトリストの記録にすでにある情報も使います: メール確認の有無と日時、メールアドレスとそのドメイン、登録日時、ページの言語、ランディングページ、キャンペーンタグ、不正利用のフラグ。メールアドレスは、自己招待、重複登録、使い捨てアドレスを見分けるため、当社のサーバー内でだけ照合します。",
    ],
    purposesIntro: "これらの情報は、次の目的で利用します:",
    purposes: [
      "確認済みの友だちをカウントし、1 日の上限や締め切り時刻などのプログラムのルールを適用するため;",
      "達成した特典をお届けするため: ローンチのメールを早く受け取れる特典、早割価格のリンク、賞品;",
      "自己招待、重複・使い捨てアドレス、自動化された登録などの不正について特典を審査するため — 審査の信号は記録に印を付けるだけで、特典をお断りする前には必ず人が判断します;",
      "プログラムのメールを送るため: 招待の案内メールと、停止していない場合は友だちが参加したときのお知らせメール。",
    ],
    visibility: [
      "誰に何が見えるか",
      " — カウントが見えるのはお客様ご本人だけです。メールに記載された署名付きリンクから開く状況ページと、プログラムのメールで確認できます。表示するのはカウントされた人数だけで、その友だちが誰かは決して表示しません。公開の上位{winners}名ランキングには順位と友だちの人数を表示し、ニックネームは本人が設定して表示を選び、当社チームが非表示にしていない場合だけ表示します。それ以外は「{privateDiver}」と表示します。メールアドレスは決して公開しません。",
    ],
    prizes: [
      "賞品の当選者",
      " — 発送が必要な賞品（水中ライトまたは WatchDive）に当選した場合、お届けに必要な情報として、お名前、配送先住所、電話番号をメールでお尋ねします。賞品に韓国の源泉徴収税が適用される場合は、その税に法令上必要な本人確認情報も収集し、源泉徴収と申告にだけ使います。配送情報は賞品を発送する配送業者にだけ、税務情報は法令で求められる場合に税務当局にだけ提供します。",
    ],
    legalBasis: [
      "法的根拠",
      " — GDPR および英国 GDPR のもとでは、招待のカウント、特典のお届け、プログラムのメール送信は、お客様が参加するプログラムのルールを履行するためのものです（契約）。招待した人の記録と、招待や特典の不正の審査は、公正なプログラム運営という当社の正当な利益に基づきます。ニックネームはお客様が選んだ場合だけ表示し（同意）、その選択は状況ページからいつでも撤回できます。税務上の本人確認情報は、法的義務を果たすために取り扱います。韓国の個人情報保護法のもとでは、プログラムの情報と賞品の配送情報を、プログラムの運営とお申し出いただいた賞品のお届けに必要な範囲で取り扱い、税務上の本人確認情報は法令で求められる場合だけ取り扱います。",
    ],
    sharing: [
      "保管場所",
      " — {program}の情報はウェイトリストの記録とともに Notion に保管し、プログラムのメールは Resend で送信し、ページは Vercel で運用します。いずれも第 5 条に記載の処理者です。これらの情報を販売することは決してありません。",
    ],
    retention: [
      "保存期間",
      " — {program}の情報は、プログラムが締め切られ、すべての特典のお届けが終わるまで保持し、その後削除または匿名化します。賞品の配送情報は、そのお届けのためだけに保持します。税務記録は法令で定められた期間だけ保管し、その後削除します。それより前にウェイトリストの記録の削除をご依頼いただいた場合は、{program}の情報も一緒に削除します。",
    ],
    rights: [
      "ご自身の選択と権利",
      " — ニックネーム、ランキングへの表示、友だち参加のお知らせは、状況ページからいつでも変更できます。第 7 条の権利は{program}の情報にも適用されます。権利を行使する場合や、プログラムについてのお問い合わせは、help@diveroid.com までメールでご連絡ください。",
    ],
  },
  es: {
    title: "11. {program}",
    intro:
      "{program} es nuestro programa para invitar a amigos. Cada registro de la lista de espera recibe un código de invitación al crearse. Mientras el programa esté activo, cuando confirmas tu correo te enviamos tu enlace de invitación y tu página de estado, y contamos a los amigos que se unen con tu enlace. El responsable del tratamiento es DIVEROID LTD (Sección 1). Mientras el programa esté activo, esta sección se suma a las anteriores.",
    storedIntro: "Lo que guardamos para el programa, junto con tu registro de la lista de espera:",
    stored: [
      [
        "Tu código de invitación",
        " — un código de 8 caracteres que se crea con tu registro de la lista de espera y se usa en tu enlace de invitación.",
      ],
      [
        "Quién te invitó",
        " — si te uniste con el enlace de un amigo, el código de invitación de ese amigo, no su nombre ni su dirección de correo. El código del enlace también se guarda en el almacenamiento local de tu navegador, para poder añadirlo cuando te registres.",
      ],
      ["Apodo", " — solo si eliges uno en tu página de estado de {program}."],
      [
        "Tus preferencias",
        " — si tu apodo se muestra en la clasificación y si te enviamos un correo cuando se une un amigo.",
      ],
      [
        "Recuentos y estado de revisión",
        " — cuántos amigos confirmados cuentan para ti, el último recuento que te enviamos por correo y cuándo, si nuestro equipo ocultó tu apodo y el estado de cualquier revisión manual de recompensas.",
      ],
    ],
    friends: [
      "Registros de los amigos invitados",
      " — para contar invitaciones y revisar recompensas, también usamos datos que ya figuran en los registros de la lista de espera de quienes se unieron con tu enlace: si confirmaron su correo y cuándo, su dirección de correo y su dominio, la hora de registro, el idioma de la página, la página de llegada, las etiquetas de campaña y las marcas de abuso. Las direcciones de correo solo se comparan en nuestro servidor, para detectar autoinvitaciones, registros repetidos y direcciones desechables.",
    ],
    purposesIntro: "Usamos esta información para:",
    purposes: [
      "contar los amigos confirmados y aplicar las reglas del programa, incluido el límite diario y la hora de cierre;",
      "darte las recompensas que alcances: el correo del lanzamiento antes que el resto, el enlace al precio early bird y los premios;",
      "revisar las recompensas para detectar fraude, como autoinvitaciones, direcciones repetidas o desechables y registros automatizados — las señales de revisión solo marcan un registro y una persona decide antes de denegar una recompensa;",
      "enviar los correos del programa: la guía de invitación y, salvo que lo desactives, un correo cuando se une un amigo.",
    ],
    visibility: [
      "Quién ve qué",
      " — tus recuentos solo los ves tú: en tu página de estado, que se abre desde el enlace firmado de nuestros correos, y en los correos del programa. Muestran cuántos amigos cuentan, nunca quiénes son. La clasificación pública del top {winners} muestra el puesto y el número de amigos de cada posición, con un apodo solo si esa persona lo eligió, decidió mostrarlo y nuestro equipo no lo ha ocultado; si no, muestra «{privateDiver}». Las direcciones de correo nunca se muestran.",
    ],
    prizes: [
      "Ganadores de premios",
      " — si ganas un premio que hay que enviar (una linterna subacuática o un WatchDive), te pedimos por correo los datos necesarios para entregarlo: tu nombre, la dirección de envío y un número de teléfono. Cuando a un premio se le aplica la retención fiscal coreana, también recogemos los datos de identificación que la ley exige para ese impuesto y solo los usamos para practicar y declarar la retención. Solo damos los datos de envío a la empresa de mensajería que envía el premio, y los datos fiscales a la autoridad tributaria cuando la ley lo exige.",
    ],
    legalBasis: [
      "Base legal",
      " — según el RGPD y el RGPD del Reino Unido, contamos invitaciones, damos recompensas y enviamos los correos del programa para cumplir las reglas del programa en el que participas (contrato). Registrar quién te invitó y revisar invitaciones y recompensas para detectar fraude se basa en nuestro interés legítimo en que el programa sea justo. Tu apodo solo se muestra si lo eliges (consentimiento), y puedes retirar esa elección en cualquier momento desde tu página de estado. Tratamos los datos de identificación fiscal para cumplir una obligación legal. Según la Ley de Protección de Información Personal de Corea (PIPA), tratamos los datos del programa y los datos de envío de premios en la medida necesaria para gestionar el programa y entregar el premio que reclames, y los datos de identificación fiscal solo cuando una ley lo exige.",
    ],
    sharing: [
      "Dónde se guarda",
      " — los datos de {program} se guardan con tu registro de la lista de espera en Notion, los correos del programa se envían con Resend y las páginas funcionan en Vercel: los encargados del tratamiento de la Sección 5. Nunca los vendemos.",
    ],
    retention: [
      "Cuánto tiempo los conservamos",
      " — conservamos los datos de {program} hasta que el programa haya cerrado y se hayan entregado todas las recompensas; después los eliminamos o anonimizamos. Los datos de envío de un premio se conservan solo para esa entrega. Los registros fiscales se conservan solo durante el tiempo que exige la ley y después se eliminan. Si antes nos pides eliminar tu registro de la lista de espera, tus datos de {program} se eliminan con él.",
    ],
    rights: [
      "Tus preferencias y derechos",
      " — puedes cambiar tu apodo, tu elección sobre la clasificación y los correos de amigos que se unen en cualquier momento desde tu página de estado. Los derechos de la Sección 7 también se aplican a los datos de {program}. Para ejercerlos, o si tienes preguntas sobre el programa, escribe a help@diveroid.com.",
    ],
  },
  fr: {
    title: "11. {program}",
    intro:
      "{program} est notre programme d’invitation d’amis. Chaque fiche de liste d’attente reçoit un code d’invitation à sa création. Pendant le programme, une fois votre e-mail confirmé, nous vous envoyons votre lien d’invitation et votre page de suivi, et nous comptons les amis qui s’inscrivent avec votre lien. Le responsable du traitement est DIVEROID LTD (Section 1). Tant que le programme est en cours, cette section complète les sections ci-dessus.",
    storedIntro: "Ce que nous conservons pour le programme, avec votre fiche de liste d’attente :",
    stored: [
      [
        "Votre code d’invitation",
        " — un code de 8 caractères créé avec votre fiche de liste d’attente et utilisé dans votre lien d’invitation.",
      ],
      [
        "Qui vous a invité",
        " — si vous vous êtes inscrit avec le lien d’un ami, le code d’invitation de cet ami, et non son nom ni son adresse e-mail. Le code du lien est aussi conservé dans le stockage local de votre navigateur, afin de pouvoir être ajouté lors de votre inscription.",
      ],
      ["Pseudo", " — uniquement si vous en choisissez un sur votre page de suivi {program}."],
      [
        "Vos choix",
        " — l’affichage ou non de votre pseudo dans le classement, et l’envoi ou non d’un e-mail quand un ami s’inscrit.",
      ],
      [
        "Décomptes et statut de vérification",
        " — le nombre d’amis confirmés comptés pour vous, le dernier décompte que nous vous avons envoyé par e-mail et sa date, le fait que notre équipe ait masqué ou non votre pseudo, et le statut de toute vérification manuelle des récompenses.",
      ],
    ],
    friends: [
      "Fiches des amis invités",
      " — pour compter les invitations et vérifier les récompenses, nous utilisons aussi des informations déjà présentes dans les fiches de liste d’attente des personnes inscrites avec votre lien : si et quand elles ont confirmé leur e-mail, leur adresse e-mail et son domaine, l’heure d’inscription, la langue de la page, la page d’arrivée, les balises de campagne et les signalements d’abus. Les adresses e-mail ne sont comparées que sur notre serveur, pour repérer les auto-invitations, les inscriptions répétées et les adresses jetables.",
    ],
    purposesIntro: "Nous utilisons ces informations pour :",
    purposes: [
      "compter les amis confirmés et appliquer les règles du programme, y compris la limite quotidienne et l’heure de clôture ;",
      "remettre les récompenses atteintes : l’e-mail de lancement en avance, le lien vers le prix early bird et les lots ;",
      "vérifier les récompenses pour détecter la fraude, comme les auto-invitations, les adresses répétées ou jetables et les inscriptions automatisées — les signaux de vérification ne font que signaler une fiche, et une personne décide avant tout refus de récompense ;",
      "envoyer les e-mails du programme : le guide d’invitation et, sauf si vous le désactivez, un e-mail quand un ami s’inscrit.",
    ],
    visibility: [
      "Qui voit quoi",
      " — vos décomptes ne sont visibles que par vous : sur votre page de suivi, ouverte depuis le lien signé de nos e-mails, et dans les e-mails du programme. Ils indiquent combien d’amis comptent, jamais qui ils sont. Le classement public du top {winners} affiche le rang et le nombre d’amis de chaque place, avec un pseudo uniquement si la personne en a choisi un, a décidé de l’afficher et que notre équipe ne l’a pas masqué ; sinon, il affiche « {privateDiver} ». Les adresses e-mail ne sont jamais affichées.",
    ],
    prizes: [
      "Gagnants de lots",
      " — si vous gagnez un lot à expédier (une lampe sous-marine ou un WatchDive), nous vous demandons par e-mail les informations nécessaires à sa livraison : votre nom, votre adresse de livraison et votre numéro de téléphone. Lorsque la retenue à la source coréenne s’applique à un lot, nous collectons aussi les données d’identification que la loi exige pour cet impôt, et nous ne les utilisons que pour pratiquer et déclarer la retenue. Nous ne transmettons les informations de livraison qu’au transporteur qui expédie le lot, et les données fiscales qu’à l’administration fiscale lorsque la loi l’exige.",
    ],
    legalBasis: [
      "Base légale",
      " — au titre du RGPD et du RGPD britannique, nous comptons les invitations, remettons les récompenses et envoyons les e-mails du programme pour exécuter les règles du programme auquel vous participez (contrat). L’enregistrement de la personne qui vous a invité et la vérification des invitations et des récompenses contre la fraude reposent sur notre intérêt légitime à mener un programme équitable. Votre pseudo n’est affiché que si vous le choisissez (consentement), et vous pouvez retirer ce choix à tout moment sur votre page de suivi. Nous traitons les données d’identification fiscale pour respecter une obligation légale. Au titre de la loi coréenne sur la protection des informations personnelles (PIPA), nous traitons les données du programme et les informations de livraison des lots dans la mesure nécessaire pour gérer le programme et livrer le lot que vous réclamez, et les données d’identification fiscale uniquement lorsqu’une loi l’exige.",
    ],
    sharing: [
      "Où elles sont conservées",
      " — les données {program} sont conservées avec votre fiche de liste d’attente dans Notion, les e-mails du programme sont envoyés via Resend et les pages sont hébergées par Vercel : les sous-traitants cités en Section 5. Nous ne les vendons jamais.",
    ],
    retention: [
      "Durée de conservation",
      " — nous conservons les données {program} jusqu’à la clôture du programme et la remise de toutes les récompenses, puis nous les supprimons ou les anonymisons. Les informations de livraison d’un lot ne sont conservées que pour cette livraison. Les documents fiscaux ne sont conservés que pendant la durée exigée par la loi, puis supprimés. Si vous demandez plus tôt la suppression de votre fiche de liste d’attente, vos données {program} sont supprimées avec elle.",
    ],
    rights: [
      "Vos choix et vos droits",
      " — vous pouvez modifier à tout moment votre pseudo, votre choix d’affichage dans le classement et les e-mails d’inscription d’amis sur votre page de suivi. Les droits de la Section 7 s’appliquent aussi aux données {program}. Pour les exercer, ou pour toute question sur le programme, écrivez à help@diveroid.com.",
    ],
  },
  de: {
    title: "11. {program}",
    intro:
      "{program} ist unser Programm, um Freunde einzuladen. Jeder Wartelisten-Eintrag erhält bei der Erstellung einen Einladungscode. Solange das Programm läuft, schicken wir dir nach der Bestätigung deiner E-Mail-Adresse deinen Einladungslink und deine Statusseite und zählen die Freunde, die sich über deinen Link anmelden. Verantwortlicher ist DIVEROID LTD (Abschnitt 1). Solange das Programm läuft, ergänzt dieser Abschnitt die Abschnitte oben.",
    storedIntro: "Was wir für das Programm zusammen mit deinem Wartelisten-Eintrag speichern:",
    stored: [
      [
        "Dein Einladungscode",
        " — ein 8-stelliger Code, der mit deinem Wartelisten-Eintrag entsteht und in deinem Einladungslink steht.",
      ],
      [
        "Wer dich eingeladen hat",
        " — wenn du dich über den Link eines Freundes angemeldet hast, dessen Einladungscode, nicht sein Name oder seine E-Mail-Adresse. Der Code aus dem Link wird außerdem im lokalen Speicher deines Browsers abgelegt, damit er bei deiner Anmeldung hinzugefügt werden kann.",
      ],
      ["Spitzname", " — nur wenn du auf deiner {program}-Statusseite einen festlegst."],
      [
        "Deine Auswahl",
        " — ob dein Spitzname in der Rangliste erscheint und ob wir dir eine E-Mail schicken, wenn ein Freund dazukommt.",
      ],
      [
        "Zählstände und Prüfstatus",
        " — wie viele bestätigte Freunde für dich zählen, der Stand, den wir dir zuletzt per E-Mail mitgeteilt haben, und wann, ob unser Team deinen Spitznamen ausgeblendet hat, und den Status einer manuellen Prüfung von Belohnungen.",
      ],
    ],
    friends: [
      "Einträge eingeladener Freunde",
      " — um Einladungen zu zählen und Belohnungen zu prüfen, nutzen wir auch Angaben, die bereits in den Wartelisten-Einträgen der Personen stehen, die sich über deinen Link angemeldet haben: ob und wann sie ihre E-Mail-Adresse bestätigt haben, die E-Mail-Adresse und ihre Domain, Anmeldezeit, Seitensprache, Einstiegsseite, Kampagnen-Tags und Missbrauchsmarkierungen. E-Mail-Adressen werden nur auf unserem Server verglichen, um Selbsteinladungen, wiederholte Anmeldungen und Wegwerfadressen zu erkennen.",
    ],
    purposesIntro: "Wir nutzen diese Angaben, um:",
    purposes: [
      "bestätigte Freunde zu zählen und die Programmregeln anzuwenden, einschließlich Tageslimit und Schlusszeit;",
      "die erreichten Belohnungen zu vergeben: die Start-E-Mail früher als die allgemeine Liste, den Link zum Early-Bird-Preis und Preise;",
      "Belohnungen auf Betrug zu prüfen, etwa Selbsteinladungen, wiederholte oder Wegwerfadressen und automatisierte Anmeldungen — Prüfsignale markieren einen Eintrag nur, und ein Mensch entscheidet, bevor eine Belohnung verweigert wird;",
      "Programm-E-Mails zu senden: die Einladungsanleitung und, sofern du sie nicht abschaltest, eine E-Mail, wenn ein Freund dazukommt.",
    ],
    visibility: [
      "Wer was sieht",
      " — deine Zählstände siehst nur du: auf deiner Statusseite, die du über den signierten Link in unseren E-Mails öffnest, und in Programm-E-Mails. Sie zeigen, wie viele Freunde zählen, nie, wer sie sind. Die öffentliche Top-{winners}-Rangliste zeigt für jeden Platz Rang und Anzahl der Freunde, mit Spitznamen nur, wenn die Person einen festgelegt, sich für die Anzeige entschieden und unser Team ihn nicht ausgeblendet hat; sonst steht dort „{privateDiver}“. E-Mail-Adressen werden nie angezeigt.",
    ],
    prizes: [
      "Gewinner von Preisen",
      " — wenn du einen Preis gewinnst, der verschickt werden muss (eine Unterwasserlampe oder eine WatchDive), fragen wir dich per E-Mail nach den Angaben für die Zustellung: Name, Lieferadresse und Telefonnummer. Wenn für einen Preis die koreanische Quellensteuer gilt, erheben wir außerdem die Identifikationsdaten, die das Gesetz für diese Steuer verlangt, und nutzen sie nur, um sie einzubehalten und zu melden. Lieferangaben geben wir nur an den Versanddienst weiter, der den Preis verschickt, und Steuerdaten nur an die Steuerbehörde, wenn das Gesetz es verlangt.",
    ],
    legalBasis: [
      "Rechtsgrundlage",
      " — nach der DSGVO und der UK-DSGVO zählen wir Einladungen, vergeben Belohnungen und senden Programm-E-Mails, um die Regeln des Programms zu erfüllen, an dem du teilnimmst (Vertrag). Die Erfassung, wer dich eingeladen hat, und die Prüfung von Einladungen und Belohnungen auf Betrug beruhen auf unserem berechtigten Interesse an einem fairen Programm. Dein Spitzname wird nur angezeigt, wenn du das wählst (Einwilligung), und du kannst diese Wahl jederzeit auf deiner Statusseite widerrufen. Steuerliche Identifikationsdaten verarbeiten wir zur Erfüllung einer rechtlichen Verpflichtung. Nach dem koreanischen Gesetz zum Schutz personenbezogener Informationen (PIPA) verarbeiten wir Programmdaten und Lieferangaben für Preise, soweit es für das Programm und die Zustellung des von dir beanspruchten Preises nötig ist, und steuerliche Identifikationsdaten nur, wenn ein Gesetz es verlangt.",
    ],
    sharing: [
      "Wo sie gespeichert werden",
      " — {program}-Daten werden mit deinem Wartelisten-Eintrag in Notion gespeichert, Programm-E-Mails werden über Resend versendet und die Seiten laufen bei Vercel: die in Abschnitt 5 genannten Auftragsverarbeiter. Wir verkaufen sie niemals.",
    ],
    retention: [
      "Wie lange wir sie aufbewahren",
      " — wir bewahren {program}-Daten auf, bis das Programm geschlossen ist und alle Belohnungen vergeben sind, und löschen oder anonymisieren sie dann. Lieferangaben für einen Preis bewahren wir nur für diese Zustellung auf. Steuerunterlagen bewahren wir nur so lange auf, wie das Gesetz es verlangt, und löschen sie dann. Wenn du uns schon vorher bittest, deinen Wartelisten-Eintrag zu löschen, werden deine {program}-Daten mit ihm gelöscht.",
    ],
    rights: [
      "Deine Auswahl und deine Rechte",
      " — Spitznamen, Anzeige in der Rangliste und E-Mails zu neuen Freunden kannst du jederzeit auf deiner Statusseite ändern. Die Rechte aus Abschnitt 7 gelten auch für {program}-Daten. Um sie auszuüben, oder bei Fragen zum Programm, schreib an help@diveroid.com.",
    ],
  },
  "pt-BR": {
    title: "11. {program}",
    intro:
      "{program} é o nosso programa de convite de amigos. Cada registro da lista de espera recebe um código de convite ao ser criado. Enquanto o programa estiver ativo, depois que você confirma o e-mail, enviamos seu link de convite e sua página de status, e contamos os amigos que entram pelo seu link. A controladora é a DIVEROID LTD (Seção 1). Enquanto o programa estiver ativo, esta seção complementa as seções acima.",
    storedIntro: "O que guardamos para o programa, junto com o seu registro da lista de espera:",
    stored: [
      [
        "Seu código de convite",
        " — um código de 8 caracteres criado com o seu registro da lista de espera e usado no seu link de convite.",
      ],
      [
        "Quem convidou você",
        " — se você entrou pelo link de um amigo, o código de convite desse amigo, não o nome nem o endereço de e-mail dele. O código do link também fica guardado no armazenamento local do navegador, para poder ser incluído quando você se cadastrar.",
      ],
      ["Apelido", " — só se você definir um na sua página de status do {program}."],
      [
        "Suas escolhas",
        " — se o seu apelido aparece no ranking e se enviamos um e-mail quando um amigo entra.",
      ],
      [
        "Contagens e status de análise",
        " — quantos amigos confirmados contam para você, a última contagem que enviamos por e-mail e quando, se nossa equipe ocultou seu apelido e o status de qualquer análise manual de recompensas.",
      ],
    ],
    friends: [
      "Registros dos amigos convidados",
      " — para contar convites e analisar recompensas, também usamos informações que já estão nos registros da lista de espera de quem entrou pelo seu link: se e quando confirmou o e-mail, o endereço de e-mail e seu domínio, o horário do cadastro, o idioma da página, a página de entrada, as tags de campanha e as marcações de abuso. Os endereços de e-mail são comparados apenas no nosso servidor, para identificar autoconvites, cadastros repetidos e endereços descartáveis.",
    ],
    purposesIntro: "Usamos essas informações para:",
    purposes: [
      "contar os amigos confirmados e aplicar as regras do programa, inclusive o limite diário e o horário de encerramento;",
      "entregar as recompensas que você alcançar: o e-mail do lançamento antes da lista geral, o link do preço early bird e os prêmios;",
      "analisar recompensas para detectar fraude, como autoconvites, endereços repetidos ou descartáveis e cadastros automatizados — os sinais de análise apenas marcam um registro, e uma pessoa decide antes de recusar qualquer recompensa;",
      "enviar os e-mails do programa: o guia de convite e, a menos que você desative, um e-mail quando um amigo entra.",
    ],
    visibility: [
      "Quem vê o quê",
      " — suas contagens aparecem só para você: na sua página de status, aberta pelo link assinado dos nossos e-mails, e nos e-mails do programa. Elas mostram quantos amigos contam, nunca quem eles são. O ranking público do top {winners} mostra a posição e o número de amigos de cada lugar, com apelido só quando a pessoa definiu um, escolheu mostrá-lo e nossa equipe não o ocultou; caso contrário, mostra “{privateDiver}”. Endereços de e-mail nunca são mostrados.",
    ],
    prizes: [
      "Ganhadores de prêmios",
      " — se você ganhar um prêmio que precisa ser enviado (uma lanterna subaquática ou um WatchDive), pedimos por e-mail os dados necessários para a entrega: seu nome, endereço de entrega e telefone. Quando o imposto retido na fonte coreano se aplica a um prêmio, também coletamos os dados de identificação que a lei exige para esse imposto e os usamos apenas para reter e declarar o imposto. Passamos os dados de entrega apenas à transportadora que envia o prêmio, e os dados fiscais apenas à autoridade tributária quando a lei exige.",
    ],
    legalBasis: [
      "Base legal",
      " — segundo o GDPR e o UK GDPR, contamos convites, entregamos recompensas e enviamos os e-mails do programa para cumprir as regras do programa de que você participa (contrato). Registrar quem convidou você e analisar convites e recompensas para detectar fraude se baseiam no nosso legítimo interesse em manter o programa justo. Seu apelido só aparece se você escolher (consentimento), e você pode retirar essa escolha a qualquer momento na sua página de status. Tratamos os dados de identificação fiscal para cumprir uma obrigação legal. Segundo a Lei de Proteção de Informações Pessoais da Coreia (PIPA), tratamos os dados do programa e os dados de entrega de prêmios na medida necessária para operar o programa e entregar o prêmio que você reivindicar, e os dados de identificação fiscal somente quando uma lei exige.",
    ],
    sharing: [
      "Onde ficam guardados",
      " — os dados do {program} ficam com o seu registro da lista de espera no Notion, os e-mails do programa são enviados pela Resend e as páginas rodam na Vercel: os operadores listados na Seção 5. Nunca vendemos esses dados.",
    ],
    retention: [
      "Por quanto tempo guardamos",
      " — guardamos os dados do {program} até o programa encerrar e todas as recompensas serem entregues; depois, os excluímos ou anonimizamos. Os dados de entrega de um prêmio ficam guardados só para essa entrega. Os registros fiscais ficam guardados apenas pelo prazo que a lei exige e depois são excluídos. Se você pedir antes a exclusão do seu registro da lista de espera, seus dados do {program} são excluídos junto.",
    ],
    rights: [
      "Suas escolhas e direitos",
      " — você pode mudar seu apelido, sua escolha sobre o ranking e os e-mails de amigos que entram a qualquer momento na sua página de status. Os direitos da Seção 7 também valem para os dados do {program}. Para exercê-los, ou para tirar dúvidas sobre o programa, escreva para help@diveroid.com.",
    ],
  },
};

/** The section for one locale, with program name, label and numbers filled in. */
export function buddyInvitePrivacy(locale: Locale): BuddyInvitePrivacyCopy {
  const source = TEXT[locale] ?? TEXT.en;
  const referral = referralCopy(locale);
  const values = {
    program: referral.programName,
    privateDiver: referral.leaderboard.privateDiver,
    winners: TOP_PRIZE_WINNERS,
  };
  const text = (value: string) => fill(value, values);
  const lead = ([head, body]: PrivacyLead): PrivacyLead => [text(head), text(body)];
  return {
    title: text(source.title),
    intro: text(source.intro),
    storedIntro: text(source.storedIntro),
    stored: source.stored.map(lead),
    friends: lead(source.friends),
    purposesIntro: text(source.purposesIntro),
    purposes: source.purposes.map(text),
    visibility: lead(source.visibility),
    prizes: lead(source.prizes),
    legalBasis: lead(source.legalBasis),
    sharing: lead(source.sharing),
    retention: lead(source.retention),
    rights: lead(source.rights),
  };
}

/** Raw templates, for tests. */
export const BUDDY_INVITE_PRIVACY_TEMPLATES: Readonly<Record<Locale, BuddyInvitePrivacyCopy>> =
  TEXT;
