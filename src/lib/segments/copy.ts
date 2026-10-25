import type { Locale } from '../i18n/locale';

export type DiveSegment = 'freediving' | 'scuba';
export type SegmentCopy = {
  modes: Record<DiveSegment, string>;
  title: string;
  intro: string;
  discover: string;
  heroCaption: string;
  benefitTitle: string;
  benefits: { title: string; body: string }[];
  howTitle: string;
  howIntro: string;
  signupTitle: string;
  signupBody: string;
  signupCta: string;
  signupNote: string;
  priceNote: string;
  priceNoteHighlight: string;
  discountLabel: string;
  includeNote: string;
  compatibility: string;
  logTitle: string;
  logBody: string;
  logImageAlt: string;
  cameraTitle: string;
  cameraBody: string;
  finalTitle: string;
  finalBody: string;
  questionTitle: string;
  depthAnswer: string;
  noPayment: string;
  switchPrompt: string;
};

// Audience copy uses the current approved housing + app product facts.
// The public first-100 offer is not reserved by a free signup.
export const SEGMENT_COPY: Record<Locale, Record<DiveSegment, SegmentCopy>> = {
  "en": {
    "freediving": {
      "modes": {
        "freediving": "Freediving",
        "scuba": "Scuba diving"
      },
      "discover": "See how it works",
      "howTitle": "Keep your watch. Add WatchDive.",
      "howIntro": "The housing measures depth and water temperature. Your smartwatch displays the readings.",
      "signupTitle": "Get the WatchDive launch alert.",
      "signupBody": "Receive the link when WatchDive launches on Kickstarter.",
      "signupCta": "Notify me at launch",
      "signupNote": "Confirm your email to complete signup.",
      "priceNote": "Early bird · first 100 Kickstarter backers",
      "priceNoteHighlight": "first 100",
      "discountLabel": "OFF",
      "includeNote": "Housing + app. Smartwatch sold separately.",
      "compatibility": "Check compatible watches",
      "logTitle": "Your freedives, in your logbook.",
      "logBody": "Review your freediving records on WatchDive. After the dive, sync your dive profile to the DIVEROID app.",
      "cameraTitle": "Your footage, alongside your dive.",
      "cameraBody": "Bring footage from GoPro, Insta360, Canon and more together with your dive log in the DIVEROID app.",
      "finalTitle": "Be there when WatchDive launches.",
      "finalBody": "Get the Kickstarter launch link by email.",
      "questionTitle": "A few things to know.",
      "noPayment": "Free launch alert. No payment required.",
      "switchPrompt": "Explore the other dive mode",
      "title": "Your smartwatch.\nYour freedive computer.",
      "intro": "Add the WatchDive sensor housing to a compatible Apple Watch or Galaxy Watch. See depth, dive time and water temperature on your wrist.",
      "heroCaption": "Freediving with WatchDive",
      "benefitTitle": "The essentials for your freedive.",
      "benefits": [
        {
          "title": "See depth, time and temperature.",
          "body": "Check your dive readings on the smartwatch you already know."
        },
        {
          "title": "Keep your dive profile.",
          "body": "Sync to the DIVEROID app after the dive and review your record."
        },
        {
          "title": "Keep using your smartwatch.",
          "body": "Add the WatchDive housing for diving. Your watch stays with you on land."
        }
      ],
      "depthAnswer": "Recommended operating depth is 40 m. The housing completed a water-resistance test at 60 m; this is not independent certification or a guarantee in every environment. Dive within your training and the conditions.",
      "logImageAlt": "WatchDive freediving logbook"
    },
    "scuba": {
      "modes": {
        "freediving": "Freediving",
        "scuba": "Scuba diving"
      },
      "discover": "See how it works",
      "howTitle": "Keep your watch. Add WatchDive.",
      "howIntro": "The housing measures depth and water temperature. Your smartwatch displays the readings.",
      "signupTitle": "Get the WatchDive launch alert.",
      "signupBody": "Receive the link when WatchDive launches on Kickstarter.",
      "signupCta": "Notify me at launch",
      "signupNote": "Confirm your email to complete signup.",
      "priceNote": "Early bird · first 100 Kickstarter backers",
      "priceNoteHighlight": "first 100",
      "discountLabel": "OFF",
      "includeNote": "Housing + app. Smartwatch sold separately.",
      "compatibility": "Check compatible watches",
      "logTitle": "Back on the surface. Into your logbook.",
      "logBody": "Sync your dive profile to the DIVEROID app after the dive. Review your dives in one place.",
      "cameraTitle": "Your footage, alongside your dive.",
      "cameraBody": "Bring footage from GoPro, Insta360, Canon and more together with your dive log in the DIVEROID app.",
      "finalTitle": "Be there when WatchDive launches.",
      "finalBody": "Get the Kickstarter launch link by email.",
      "questionTitle": "A few things to know.",
      "noPayment": "Free launch alert. No payment required.",
      "switchPrompt": "Explore the other dive mode",
      "title": "Your smartwatch.\nYour dive computer.",
      "intro": "Add the WatchDive sensor housing to a compatible Apple Watch or Galaxy Watch. See your dive information on the watch you already know.",
      "heroCaption": "WatchDive in action underwater",
      "benefitTitle": "Your dive information, on your wrist.",
      "benefits": [
        {
          "title": "Check your no-deco time.",
          "body": "View no-decompression time, deco guidance and ascent alerts."
        },
        {
          "title": "Find your bearings.",
          "body": "A compass, depth, dive time and water temperature on your smartwatch."
        },
        {
          "title": "Review your dive afterwards.",
          "body": "Sync your dive profile to the DIVEROID app when you’re back at the surface."
        }
      ],
      "depthAnswer": "Recommended operating depth is 40 m. The housing completed a water-resistance test at 60 m; this is not independent certification or a guarantee in every environment. Dive within your training and the conditions.",
      "logImageAlt": "DIVEROID app scuba logbook"
    }
  },
  "ko": {
    "freediving": {
      "modes": {
        "freediving": "프리다이빙",
        "scuba": "스쿠버다이빙"
      },
      "discover": "작동 방식 보기",
      "howTitle": "쓰던 워치에 WatchDive를 더하세요.",
      "howIntro": "하우징이 수심과 수온을 측정하고, 스마트워치가 측정값을 보여줍니다.",
      "signupTitle": "WatchDive 출시 소식을 받아보세요.",
      "signupBody": "Kickstarter 캠페인이 열리면 링크를 보내드립니다.",
      "signupCta": "출시 알림 받기",
      "signupNote": "이메일 인증으로 신청을 완료하세요.",
      "priceNote": "얼리버드 · Kickstarter 후원자 선착순 100명",
      "priceNoteHighlight": "선착순 100명",
      "discountLabel": "할인",
      "includeNote": "하우징 + 앱 구성. 스마트워치는 별도입니다.",
      "compatibility": "지원 워치 확인하기",
      "logTitle": "프리다이빙 기록을 한눈에.",
      "logBody": "WatchDive에서 프리다이빙 기록을 확인하세요. 다이빙 후에는 DIVEROID 앱에 다이브 프로필을 동기화할 수 있습니다.",
      "cameraTitle": "다이빙 기록과 영상을 함께.",
      "cameraBody": "GoPro, Insta360, Canon 등으로 촬영한 영상과 다이빙 기록을 DIVEROID 앱에서 함께 확인하세요.",
      "finalTitle": "WatchDive의 시작을 함께하세요.",
      "finalBody": "Kickstarter 출시 링크를 이메일로 받아보세요.",
      "questionTitle": "시작 전에 확인하세요.",
      "noPayment": "무료 출시 알림 · 결제 없이 신청",
      "switchPrompt": "다른 다이빙 모드도 살펴보세요",
      "title": "매일 쓰는 스마트워치,\n이제 프리다이빙 컴퓨터로.",
      "intro": "지원되는 Apple Watch나 Galaxy Watch에 WatchDive 센서 하우징을 더하세요. 손목에서 수심, 다이빙 시간, 수온을 확인할 수 있습니다.",
      "heroCaption": "WatchDive와 함께하는 프리다이빙",
      "benefitTitle": "프리다이빙에 필요한 정보를 한눈에.",
      "benefits": [
        {
          "title": "수심, 시간, 수온을 한눈에.",
          "body": "익숙한 스마트워치 화면에서 다이빙 정보를 확인하세요."
        },
        {
          "title": "다이빙 후에도 기록으로.",
          "body": "DIVEROID 앱에 동기화하고 다이브 프로필을 돌아보세요."
        },
        {
          "title": "쓰던 워치를 그대로.",
          "body": "다이빙할 때는 WatchDive 하우징을 더하고, 일상에서는 스마트워치로 쓰세요."
        }
      ],
      "depthAnswer": "권장 사용 수심은 40 m입니다. 하우징은 60 m 방수 테스트를 완료했으며, 이는 독립 인증이나 모든 환경에서의 성능 보장이 아닙니다. 교육 범위와 당일 조건에 맞게 다이빙하세요.",
      "logImageAlt": "WatchDive 프리다이빙 로그북"
    },
    "scuba": {
      "modes": {
        "freediving": "프리다이빙",
        "scuba": "스쿠버다이빙"
      },
      "discover": "작동 방식 보기",
      "howTitle": "쓰던 워치에 WatchDive를 더하세요.",
      "howIntro": "하우징이 수심과 수온을 측정하고, 스마트워치가 측정값을 보여줍니다.",
      "signupTitle": "WatchDive 출시 소식을 받아보세요.",
      "signupBody": "Kickstarter 캠페인이 열리면 링크를 보내드립니다.",
      "signupCta": "출시 알림 받기",
      "signupNote": "이메일 인증으로 신청을 완료하세요.",
      "priceNote": "얼리버드 · Kickstarter 후원자 선착순 100명",
      "priceNoteHighlight": "선착순 100명",
      "discountLabel": "할인",
      "includeNote": "하우징 + 앱 구성. 스마트워치는 별도입니다.",
      "compatibility": "지원 워치 확인하기",
      "logTitle": "물 밖에서는 다이빙 기록으로.",
      "logBody": "다이빙 후 DIVEROID 앱에 다이브 프로필을 동기화하세요. 지난 다이빙을 한곳에서 돌아볼 수 있습니다.",
      "cameraTitle": "다이빙 기록과 영상을 함께.",
      "cameraBody": "GoPro, Insta360, Canon 등으로 촬영한 영상과 다이빙 기록을 DIVEROID 앱에서 함께 확인하세요.",
      "finalTitle": "WatchDive의 시작을 함께하세요.",
      "finalBody": "Kickstarter 출시 링크를 이메일로 받아보세요.",
      "questionTitle": "시작 전에 확인하세요.",
      "noPayment": "무료 출시 알림 · 결제 없이 신청",
      "switchPrompt": "다른 다이빙 모드도 살펴보세요",
      "title": "매일 쓰는 스마트워치,\n이제 다이브 컴퓨터로.",
      "intro": "지원되는 Apple Watch나 Galaxy Watch에 WatchDive 센서 하우징을 더하세요. 익숙한 워치에서 다이빙 정보를 확인할 수 있습니다.",
      "heroCaption": "수중에서 직접 사용하는 WatchDive",
      "benefitTitle": "다이빙에 필요한 정보를 손목에서.",
      "benefits": [
        {
          "title": "무감압 시간을 확인하세요.",
          "body": "무감압 시간, 감압 안내, 상승 알림을 확인할 수 있습니다."
        },
        {
          "title": "방향과 다이빙 정보를 함께.",
          "body": "스마트워치에서 나침반, 수심, 다이빙 시간, 수온을 확인하세요."
        },
        {
          "title": "다이빙을 마치고 기록으로.",
          "body": "수면으로 돌아오면 DIVEROID 앱에 다이브 프로필을 동기화하세요."
        }
      ],
      "depthAnswer": "권장 사용 수심은 40 m입니다. 하우징은 60 m 방수 테스트를 완료했으며, 이는 독립 인증이나 모든 환경에서의 성능 보장이 아닙니다. 교육 범위와 당일 조건에 맞게 다이빙하세요.",
      "logImageAlt": "DIVEROID 앱의 스쿠버다이빙 로그북"
    }
  },
  "zh-CN": {
    "freediving": {
      "modes": {
        "freediving": "自由潜水",
        "scuba": "水肺潜水"
      },
      "discover": "了解工作原理",
      "howTitle": "保留你的手表，装上 WatchDive。",
      "howIntro": "外壳测量水深和水温，智能手表显示读数。",
      "signupTitle": "接收 WatchDive 上线通知。",
      "signupBody": "WatchDive 在 Kickstarter 上线时，我们会发送链接。",
      "signupCta": "上线时通知我",
      "signupNote": "验证邮箱即可完成登记。",
      "priceNote": "早鸟价 · Kickstarter 前 100 位支持者",
      "priceNoteHighlight": "前 100 位支持者",
      "discountLabel": "优惠",
      "includeNote": "包含外壳和应用。智能手表需另购。",
      "compatibility": "查看兼容手表",
      "logTitle": "自由潜水记录，一目了然。",
      "logBody": "在 WatchDive 上查看自由潜水记录。潜水后，将潜水曲线同步至 DIVEROID 应用。",
      "cameraTitle": "潜水记录与影像，一起回看。",
      "cameraBody": "在 DIVEROID 应用中，将 GoPro、Insta360、Canon 等设备拍摄的影像与潜水日志放在一起。",
      "finalTitle": "不错过 WatchDive 上线。",
      "finalBody": "通过邮件获取 Kickstarter 上线链接。",
      "questionTitle": "开始前，你可能想了解。",
      "noPayment": "免费上线通知，无需付款。",
      "switchPrompt": "了解另一种潜水模式",
      "title": "你的智能手表，\n也是自由潜水电脑。",
      "intro": "为兼容的 Apple Watch 或 Galaxy Watch 装上 WatchDive 传感器外壳，在腕上查看水深、潜水时间和水温。",
      "heroCaption": "与 WatchDive 一起自由潜水",
      "benefitTitle": "自由潜水信息，一眼掌握。",
      "benefits": [
        {
          "title": "查看水深、时间和水温。",
          "body": "在熟悉的智能手表屏幕上查看潜水数据。"
        },
        {
          "title": "留下你的潜水曲线。",
          "body": "潜水后同步至 DIVEROID 应用，回看潜水记录。"
        },
        {
          "title": "继续使用你的手表。",
          "body": "潜水时装上 WatchDive 外壳，回到岸上继续日常佩戴。"
        }
      ],
      "depthAnswer": "建议使用深度为 40 m。外壳已完成 60 m 防水测试；这不等同于独立认证，也不保证在所有环境下的性能。请在所受训练和实际条件允许的范围内潜水。",
      "logImageAlt": "WatchDive 自由潜水日志"
    },
    "scuba": {
      "modes": {
        "freediving": "自由潜水",
        "scuba": "水肺潜水"
      },
      "discover": "了解工作原理",
      "howTitle": "保留你的手表，装上 WatchDive。",
      "howIntro": "外壳测量水深和水温，智能手表显示读数。",
      "signupTitle": "接收 WatchDive 上线通知。",
      "signupBody": "WatchDive 在 Kickstarter 上线时，我们会发送链接。",
      "signupCta": "上线时通知我",
      "signupNote": "验证邮箱即可完成登记。",
      "priceNote": "早鸟价 · Kickstarter 前 100 位支持者",
      "priceNoteHighlight": "前 100 位支持者",
      "discountLabel": "优惠",
      "includeNote": "包含外壳和应用。智能手表需另购。",
      "compatibility": "查看兼容手表",
      "logTitle": "回到水面，回看潜水记录。",
      "logBody": "潜水结束后，将潜水曲线同步至 DIVEROID 应用，在一处回顾每次潜水。",
      "cameraTitle": "潜水记录与影像，一起回看。",
      "cameraBody": "在 DIVEROID 应用中，将 GoPro、Insta360、Canon 等设备拍摄的影像与潜水日志放在一起。",
      "finalTitle": "不错过 WatchDive 上线。",
      "finalBody": "通过邮件获取 Kickstarter 上线链接。",
      "questionTitle": "开始前，你可能想了解。",
      "noPayment": "免费上线通知，无需付款。",
      "switchPrompt": "了解另一种潜水模式",
      "title": "你的智能手表，\n也是潜水电脑。",
      "intro": "为兼容的 Apple Watch 或 Galaxy Watch 装上 WatchDive 传感器外壳，在熟悉的手表上查看潜水信息。",
      "heroCaption": "水下使用 WatchDive",
      "benefitTitle": "潜水信息，就在腕上。",
      "benefits": [
        {
          "title": "查看免减压时间。",
          "body": "显示免减压时间、减压指引和上升提醒。"
        },
        {
          "title": "查看方向与潜水数据。",
          "body": "在智能手表上查看指南针、水深、潜水时间和水温。"
        },
        {
          "title": "潜水后，回顾潜水曲线。",
          "body": "回到水面后，将潜水曲线同步至 DIVEROID 应用。"
        }
      ],
      "depthAnswer": "建议使用深度为 40 m。外壳已完成 60 m 防水测试；这不等同于独立认证，也不保证在所有环境下的性能。请在所受训练和实际条件允许的范围内潜水。",
      "logImageAlt": "DIVEROID 应用中的水肺潜水日志"
    }
  },
  "zh-TW": {
    "freediving": {
      "modes": {
        "freediving": "自由潛水",
        "scuba": "水肺潛水"
      },
      "discover": "了解運作方式",
      "howTitle": "保留你的手錶，加上 WatchDive。",
      "howIntro": "防水殼測量深度與水溫，智慧手錶顯示讀數。",
      "signupTitle": "接收 WatchDive 上線通知。",
      "signupBody": "WatchDive 在 Kickstarter 上線時，我們會寄送連結。",
      "signupCta": "上線時通知我",
      "signupNote": "驗證電子郵件即可完成登記。",
      "priceNote": "早鳥價 · Kickstarter 前 100 位贊助者",
      "priceNoteHighlight": "前 100 位贊助者",
      "discountLabel": "優惠",
      "includeNote": "包含防水殼與 App。智慧手錶需另購。",
      "compatibility": "查看相容手錶",
      "logTitle": "自由潛水紀錄，一目了然。",
      "logBody": "在 WatchDive 上查看自由潛水紀錄。潛水後，將潛水曲線同步至 DIVEROID App。",
      "cameraTitle": "潛水紀錄與影像，一起回顧。",
      "cameraBody": "在 DIVEROID App 中，將 GoPro、Insta360、Canon 等設備拍攝的影像與潛水日誌放在一起。",
      "finalTitle": "不錯過 WatchDive 上線。",
      "finalBody": "透過電子郵件取得 Kickstarter 上線連結。",
      "questionTitle": "開始前，先了解這些。",
      "noPayment": "免費上線通知，無須付款。",
      "switchPrompt": "探索另一種潛水模式",
      "title": "你的智慧手錶，\n也是自由潛水電腦。",
      "intro": "為相容的 Apple Watch 或 Galaxy Watch 裝上 WatchDive 感測器防水殼，在手腕上查看深度、潛水時間與水溫。",
      "heroCaption": "與 WatchDive 一起自由潛水",
      "benefitTitle": "自由潛水資訊，一眼掌握。",
      "benefits": [
        {
          "title": "查看深度、時間與水溫。",
          "body": "在熟悉的智慧手錶螢幕上查看潛水數據。"
        },
        {
          "title": "留下你的潛水剖面。",
          "body": "潛水後同步至 DIVEROID App，回顧潛水紀錄。"
        },
        {
          "title": "繼續使用你的手錶。",
          "body": "潛水時裝上 WatchDive 防水殼，上岸後繼續日常佩戴。"
        }
      ],
      "depthAnswer": "建議使用深度為 40 m。防水殼已完成 60 m 防水測試；這不等同於獨立認證，也不保證在所有環境下的性能。請依受訓範圍與實際條件潛水。",
      "logImageAlt": "WatchDive 自由潛水日誌"
    },
    "scuba": {
      "modes": {
        "freediving": "自由潛水",
        "scuba": "水肺潛水"
      },
      "discover": "了解運作方式",
      "howTitle": "保留你的手錶，加上 WatchDive。",
      "howIntro": "防水殼測量深度與水溫，智慧手錶顯示讀數。",
      "signupTitle": "接收 WatchDive 上線通知。",
      "signupBody": "WatchDive 在 Kickstarter 上線時，我們會寄送連結。",
      "signupCta": "上線時通知我",
      "signupNote": "驗證電子郵件即可完成登記。",
      "priceNote": "早鳥價 · Kickstarter 前 100 位贊助者",
      "priceNoteHighlight": "前 100 位贊助者",
      "discountLabel": "優惠",
      "includeNote": "包含防水殼與 App。智慧手錶需另購。",
      "compatibility": "查看相容手錶",
      "logTitle": "回到水面，回顧潛水紀錄。",
      "logBody": "潛水後將潛水剖面同步至 DIVEROID App，在同一處回顧每次潛水。",
      "cameraTitle": "潛水紀錄與影像，一起回顧。",
      "cameraBody": "在 DIVEROID App 中，將 GoPro、Insta360、Canon 等設備拍攝的影像與潛水日誌放在一起。",
      "finalTitle": "不錯過 WatchDive 上線。",
      "finalBody": "透過電子郵件取得 Kickstarter 上線連結。",
      "questionTitle": "開始前，先了解這些。",
      "noPayment": "免費上線通知，無須付款。",
      "switchPrompt": "探索另一種潛水模式",
      "title": "你的智慧手錶，\n也是潛水電腦。",
      "intro": "為相容的 Apple Watch 或 Galaxy Watch 裝上 WatchDive 感測器防水殼，在熟悉的手錶上查看潛水資訊。",
      "heroCaption": "水下使用 WatchDive",
      "benefitTitle": "潛水資訊，就在手腕上。",
      "benefits": [
        {
          "title": "查看免減壓時間。",
          "body": "顯示免減壓時間、減壓指引與上升提醒。"
        },
        {
          "title": "查看方向與潛水數據。",
          "body": "在智慧手錶上查看指南針、深度、潛水時間與水溫。"
        },
        {
          "title": "潛水後，回顧潛水剖面。",
          "body": "回到水面後，將潛水剖面同步至 DIVEROID App。"
        }
      ],
      "depthAnswer": "建議使用深度為 40 m。防水殼已完成 60 m 防水測試；這不等同於獨立認證，也不保證在所有環境下的性能。請依受訓範圍與實際條件潛水。",
      "logImageAlt": "DIVEROID App 中的水肺潛水日誌"
    }
  },
  "ja": {
    "freediving": {
      "modes": {
        "freediving": "フリーダイビング",
        "scuba": "スキューバダイビング"
      },
      "discover": "仕組みを見る",
      "howTitle": "いつものウォッチに、WatchDiveを。",
      "howIntro": "ハウジングが深度と水温を測定し、スマートウォッチに表示します。",
      "signupTitle": "WatchDiveの公開通知を受け取る。",
      "signupBody": "Kickstarterでの公開時に、リンクをお送りします。",
      "signupCta": "公開通知を受け取る",
      "signupNote": "メールを認証すると登録完了です。",
      "priceNote": "早期割引 · Kickstarter支援者先着100名",
      "priceNoteHighlight": "先着100名",
      "discountLabel": "OFF",
      "includeNote": "ハウジング＋アプリ。スマートウォッチは別売りです。",
      "compatibility": "対応ウォッチを確認",
      "logTitle": "フリーダイビングの記録を、一目で。",
      "logBody": "WatchDiveでフリーダイビングの記録を確認。ダイビング後は、ダイブプロフィールをDIVEROIDアプリに同期できます。",
      "cameraTitle": "映像も、ダイビング記録と一緒に。",
      "cameraBody": "GoPro、Insta360、Canonなどで撮影した映像とダイブログを、DIVEROIDアプリでまとめて確認できます。",
      "finalTitle": "WatchDiveの公開をお見逃しなく。",
      "finalBody": "Kickstarterの公開リンクをメールでお届けします。",
      "questionTitle": "使う前に、知っておきたいこと。",
      "noPayment": "公開通知の登録は無料。お支払いは不要です。",
      "switchPrompt": "もう一つのダイビングモードを見る",
      "title": "いつものスマートウォッチを、\nフリーダイビングコンピュータに。",
      "intro": "対応するApple WatchまたはGalaxy Watchに、WatchDiveセンサーハウジングを装着。深度、潜水時間、水温を手首で確認できます。",
      "heroCaption": "WatchDive とフリーダイビング",
      "benefitTitle": "フリーダイビングの情報を、ひと目で。",
      "benefits": [
        {
          "title": "深度、時間、水温を確認。",
          "body": "使い慣れたスマートウォッチで、潜水データを確認できます。"
        },
        {
          "title": "ダイビングを記録に残す。",
          "body": "ダイビング後にDIVEROIDアプリへ同期して、プロファイルを振り返れます。"
        },
        {
          "title": "いつものウォッチを、そのまま。",
          "body": "潜るときはWatchDiveのハウジングを装着。陸上ではいつものスマートウォッチとして。"
        }
      ],
      "depthAnswer": "推奨使用深度は40 mです。ハウジングは60 mの耐水試験を完了していますが、第三者認証やあらゆる環境での性能を保証するものではありません。訓練の範囲と当日の状況に合わせて潜ってください。",
      "logImageAlt": "WatchDiveのフリーダイビングログブック"
    },
    "scuba": {
      "modes": {
        "freediving": "フリーダイビング",
        "scuba": "スキューバダイビング"
      },
      "discover": "仕組みを見る",
      "howTitle": "いつものウォッチに、WatchDiveを。",
      "howIntro": "ハウジングが深度と水温を測定し、スマートウォッチに表示します。",
      "signupTitle": "WatchDiveの公開通知を受け取る。",
      "signupBody": "Kickstarterでの公開時に、リンクをお送りします。",
      "signupCta": "公開通知を受け取る",
      "signupNote": "メールを認証すると登録完了です。",
      "priceNote": "早期割引 · Kickstarter支援者先着100名",
      "priceNoteHighlight": "先着100名",
      "discountLabel": "OFF",
      "includeNote": "ハウジング＋アプリ。スマートウォッチは別売りです。",
      "compatibility": "対応ウォッチを確認",
      "logTitle": "水面に戻ったら、ダイビング記録に。",
      "logBody": "ダイビング後にプロファイルをDIVEROIDアプリへ同期。これまでのダイビングをまとめて振り返れます。",
      "cameraTitle": "映像も、ダイビング記録と一緒に。",
      "cameraBody": "GoPro、Insta360、Canonなどで撮影した映像とダイブログを、DIVEROIDアプリでまとめて確認できます。",
      "finalTitle": "WatchDiveの公開をお見逃しなく。",
      "finalBody": "Kickstarterの公開リンクをメールでお届けします。",
      "questionTitle": "使う前に、知っておきたいこと。",
      "noPayment": "公開通知の登録は無料。お支払いは不要です。",
      "switchPrompt": "もう一つのダイビングモードを見る",
      "title": "いつものスマートウォッチを、\nダイブコンピュータに。",
      "intro": "対応するApple WatchまたはGalaxy Watchに、WatchDiveセンサーハウジングを装着。使い慣れたウォッチで潜水情報を確認できます。",
      "heroCaption": "水中で使う WatchDive",
      "benefitTitle": "潜水情報を、手首で確認。",
      "benefits": [
        {
          "title": "無減圧潜水時間を確認。",
          "body": "無減圧潜水時間、減圧ガイダンス、浮上アラートを表示します。"
        },
        {
          "title": "方位と潜水データを確認。",
          "body": "コンパス、深度、潜水時間、水温をスマートウォッチに表示します。"
        },
        {
          "title": "ダイビング後に振り返る。",
          "body": "水面に戻ったら、プロファイルをDIVEROIDアプリへ同期できます。"
        }
      ],
      "depthAnswer": "推奨使用深度は40 mです。ハウジングは60 mの耐水試験を完了していますが、第三者認証やあらゆる環境での性能を保証するものではありません。訓練の範囲と当日の状況に合わせて潜ってください。",
      "logImageAlt": "DIVEROIDアプリのスキューバダイビングログブック"
    }
  },
  "es": {
    "freediving": {
      "modes": {
        "freediving": "Apnea",
        "scuba": "Buceo autónomo"
      },
      "discover": "Descubre cómo funciona",
      "howTitle": "Tu reloj, con WatchDive.",
      "howIntro": "La carcasa mide la profundidad y la temperatura del agua. Tu smartwatch muestra los datos.",
      "signupTitle": "Recibe el aviso de lanzamiento.",
      "signupBody": "Te enviaremos el enlace cuando WatchDive llegue a Kickstarter.",
      "signupCta": "Avísame del lanzamiento",
      "signupNote": "Confirma tu correo para completar el registro.",
      "priceNote": "Precio de lanzamiento · primeros 100 mecenas en Kickstarter",
      "priceNoteHighlight": "primeros 100",
      "discountLabel": "de descuento",
      "includeNote": "Carcasa + app. Smartwatch no incluido.",
      "compatibility": "Consulta los relojes compatibles",
      "logTitle": "Tus inmersiones de apnea, en tu diario.",
      "logBody": "Consulta tus registros de apnea en WatchDive. Después de bucear, sincroniza tu perfil de inmersión con la app DIVEROID.",
      "cameraTitle": "Tus imágenes y tu inmersión, juntas.",
      "cameraBody": "Reúne tus grabaciones de GoPro, Insta360, Canon y otras cámaras con tu diario de buceo en la app DIVEROID.",
      "finalTitle": "No te pierdas el lanzamiento de WatchDive.",
      "finalBody": "Recibe por correo el enlace de lanzamiento en Kickstarter.",
      "questionTitle": "Antes de empezar.",
      "noPayment": "Aviso de lanzamiento gratuito. Sin pago.",
      "switchPrompt": "Descubre el otro modo de buceo",
      "title": "Tu smartwatch.\nTu ordenador de apnea.",
      "intro": "Añade la carcasa con sensores WatchDive a un Apple Watch o Galaxy Watch compatible. Consulta profundidad, tiempo de inmersión y temperatura del agua en tu muñeca.",
      "heroCaption": "Apnea con WatchDive",
      "benefitTitle": "Lo esencial para tu apnea.",
      "benefits": [
        {
          "title": "Profundidad, tiempo y temperatura.",
          "body": "Consulta los datos de inmersión en el smartwatch que ya conoces."
        },
        {
          "title": "Conserva tu perfil de inmersión.",
          "body": "Sincroniza con la app DIVEROID después de bucear y revisa tu registro."
        },
        {
          "title": "Sigue usando tu reloj.",
          "body": "Añade la carcasa WatchDive para bucear. En tierra, sigue usando tu smartwatch."
        }
      ],
      "depthAnswer": "La profundidad de uso recomendada es de 40 m. La carcasa completó una prueba de resistencia al agua a 60 m; no es una certificación independiente ni una garantía para todos los entornos. Bucea dentro de los límites de tu formación y de las condiciones del día.",
      "logImageAlt": "Diario de apnea de WatchDive"
    },
    "scuba": {
      "modes": {
        "freediving": "Apnea",
        "scuba": "Buceo autónomo"
      },
      "discover": "Descubre cómo funciona",
      "howTitle": "Tu reloj, con WatchDive.",
      "howIntro": "La carcasa mide la profundidad y la temperatura del agua. Tu smartwatch muestra los datos.",
      "signupTitle": "Recibe el aviso de lanzamiento.",
      "signupBody": "Te enviaremos el enlace cuando WatchDive llegue a Kickstarter.",
      "signupCta": "Avísame del lanzamiento",
      "signupNote": "Confirma tu correo para completar el registro.",
      "priceNote": "Precio de lanzamiento · primeros 100 mecenas en Kickstarter",
      "priceNoteHighlight": "primeros 100",
      "discountLabel": "de descuento",
      "includeNote": "Carcasa + app. Smartwatch no incluido.",
      "compatibility": "Consulta los relojes compatibles",
      "logTitle": "Vuelve a la superficie. Revisa tu inmersión.",
      "logBody": "Después de bucear, sincroniza el perfil de inmersión con la app DIVEROID. Consulta tus inmersiones en un solo lugar.",
      "cameraTitle": "Tus imágenes y tu inmersión, juntas.",
      "cameraBody": "Reúne tus grabaciones de GoPro, Insta360, Canon y otras cámaras con tu diario de buceo en la app DIVEROID.",
      "finalTitle": "No te pierdas el lanzamiento de WatchDive.",
      "finalBody": "Recibe por correo el enlace de lanzamiento en Kickstarter.",
      "questionTitle": "Antes de empezar.",
      "noPayment": "Aviso de lanzamiento gratuito. Sin pago.",
      "switchPrompt": "Descubre el otro modo de buceo",
      "title": "Tu smartwatch.\nTu ordenador de buceo.",
      "intro": "Añade la carcasa con sensores WatchDive a un Apple Watch o Galaxy Watch compatible. Consulta los datos de inmersión en el reloj que ya conoces.",
      "heroCaption": "WatchDive en acción bajo el agua",
      "benefitTitle": "Tu inmersión, en tu muñeca.",
      "benefits": [
        {
          "title": "Consulta el tiempo sin descompresión.",
          "body": "Muestra el tiempo sin descompresión, indicaciones de descompresión y avisos de ascenso."
        },
        {
          "title": "Oriéntate y consulta tus datos.",
          "body": "Brújula, profundidad, tiempo de inmersión y temperatura del agua en tu smartwatch."
        },
        {
          "title": "Revisa tu inmersión al terminar.",
          "body": "Al volver a la superficie, sincroniza el perfil de inmersión con la app DIVEROID."
        }
      ],
      "depthAnswer": "La profundidad de uso recomendada es de 40 m. La carcasa completó una prueba de resistencia al agua a 60 m; no es una certificación independiente ni una garantía para todos los entornos. Bucea dentro de los límites de tu formación y de las condiciones del día.",
      "logImageAlt": "Diario de buceo con botella de la app DIVEROID"
    }
  },
  "fr": {
    "freediving": {
      "modes": {
        "freediving": "Apnée",
        "scuba": "Plongée bouteille"
      },
      "discover": "Voir comment ça marche",
      "howTitle": "Votre montre, avec WatchDive.",
      "howIntro": "Le caisson mesure la profondeur et la température de l’eau. Votre montre affiche les données.",
      "signupTitle": "Recevez l’alerte de lancement.",
      "signupBody": "Nous vous enverrons le lien dès le lancement de WatchDive sur Kickstarter.",
      "signupCta": "M’avertir du lancement",
      "signupNote": "Confirmez votre adresse e-mail pour terminer l’inscription.",
      "priceNote": "Offre de lancement · 100 premiers contributeurs Kickstarter",
      "priceNoteHighlight": "100 premiers",
      "discountLabel": "de réduction",
      "includeNote": "Caisson + application. Montre connectée non incluse.",
      "compatibility": "Vérifier les montres compatibles",
      "logTitle": "Vos apnées, dans votre carnet.",
      "logBody": "Consultez vos apnées sur WatchDive. Après la plongée, synchronisez votre profil avec l’application DIVEROID.",
      "cameraTitle": "Vos images et votre plongée, réunies.",
      "cameraBody": "Retrouvez vos images GoPro, Insta360, Canon et autres avec votre carnet de plongée dans l’application DIVEROID.",
      "finalTitle": "Ne manquez pas le lancement de WatchDive.",
      "finalBody": "Recevez par e-mail le lien de lancement sur Kickstarter.",
      "questionTitle": "Quelques points à connaître.",
      "noPayment": "Alerte de lancement gratuite. Aucun paiement requis.",
      "switchPrompt": "Découvrir l’autre mode de plongée",
      "title": "Votre montre connectée.\nVotre ordinateur d’apnée.",
      "intro": "Ajoutez le caisson à capteurs WatchDive à une Apple Watch ou Galaxy Watch compatible. Consultez profondeur, durée et température de l’eau au poignet.",
      "heroCaption": "En apnée avec WatchDive",
      "benefitTitle": "L’essentiel pour votre apnée.",
      "benefits": [
        {
          "title": "Profondeur, durée et température.",
          "body": "Consultez vos données sur la montre connectée que vous connaissez déjà."
        },
        {
          "title": "Gardez votre profil de plongée.",
          "body": "Après la plongée, synchronisez-le avec l’application DIVEROID pour le consulter."
        },
        {
          "title": "Gardez votre montre au quotidien.",
          "body": "Ajoutez le caisson WatchDive pour plonger. À terre, retrouvez votre montre connectée."
        }
      ],
      "depthAnswer": "La profondeur d’utilisation recommandée est de 40 m. Le caisson a fait l’objet d’un test d’étanchéité à 60 m ; il ne s’agit ni d’une certification indépendante ni d’une garantie dans tous les environnements. Plongez dans les limites de votre formation et des conditions du jour.",
      "logImageAlt": "Carnet d’apnée WatchDive"
    },
    "scuba": {
      "modes": {
        "freediving": "Apnée",
        "scuba": "Plongée bouteille"
      },
      "discover": "Voir comment ça marche",
      "howTitle": "Votre montre, avec WatchDive.",
      "howIntro": "Le caisson mesure la profondeur et la température de l’eau. Votre montre affiche les données.",
      "signupTitle": "Recevez l’alerte de lancement.",
      "signupBody": "Nous vous enverrons le lien dès le lancement de WatchDive sur Kickstarter.",
      "signupCta": "M’avertir du lancement",
      "signupNote": "Confirmez votre adresse e-mail pour terminer l’inscription.",
      "priceNote": "Offre de lancement · 100 premiers contributeurs Kickstarter",
      "priceNoteHighlight": "100 premiers",
      "discountLabel": "de réduction",
      "includeNote": "Caisson + application. Montre connectée non incluse.",
      "compatibility": "Vérifier les montres compatibles",
      "logTitle": "De retour en surface, retrouvez votre plongée.",
      "logBody": "Après la plongée, synchronisez votre profil avec l’application DIVEROID. Retrouvez vos plongées au même endroit.",
      "cameraTitle": "Vos images et votre plongée, réunies.",
      "cameraBody": "Retrouvez vos images GoPro, Insta360, Canon et autres avec votre carnet de plongée dans l’application DIVEROID.",
      "finalTitle": "Ne manquez pas le lancement de WatchDive.",
      "finalBody": "Recevez par e-mail le lien de lancement sur Kickstarter.",
      "questionTitle": "Quelques points à connaître.",
      "noPayment": "Alerte de lancement gratuite. Aucun paiement requis.",
      "switchPrompt": "Découvrir l’autre mode de plongée",
      "title": "Votre montre connectée.\nVotre ordinateur de plongée.",
      "intro": "Ajoutez le caisson à capteurs WatchDive à une Apple Watch ou Galaxy Watch compatible. Consultez vos données de plongée sur votre montre habituelle.",
      "heroCaption": "WatchDive en action sous l’eau",
      "benefitTitle": "Vos données de plongée, au poignet.",
      "benefits": [
        {
          "title": "Consultez le temps sans palier.",
          "body": "Affiche le temps sans palier, les indications de décompression et les alertes de remontée."
        },
        {
          "title": "Gardez vos repères.",
          "body": "Compas, profondeur, durée de plongée et température de l’eau sur votre montre connectée."
        },
        {
          "title": "Revoyez votre plongée après coup.",
          "body": "De retour en surface, synchronisez votre profil avec l’application DIVEROID."
        }
      ],
      "depthAnswer": "La profondeur d’utilisation recommandée est de 40 m. Le caisson a fait l’objet d’un test d’étanchéité à 60 m ; il ne s’agit ni d’une certification indépendante ni d’une garantie dans tous les environnements. Plongez dans les limites de votre formation et des conditions du jour.",
      "logImageAlt": "Carnet de plongée bouteille dans l’application DIVEROID"
    }
  },
  "de": {
    "freediving": {
      "modes": {
        "freediving": "Apnoetauchen",
        "scuba": "Gerätetauchen"
      },
      "discover": "So funktioniert’s",
      "howTitle": "Deine Uhr. Dazu WatchDive.",
      "howIntro": "Das Gehäuse misst Tiefe und Wassertemperatur. Deine Smartwatch zeigt die Werte an.",
      "signupTitle": "Erfahre, wann WatchDive startet.",
      "signupBody": "Wir senden dir den Link, sobald WatchDive auf Kickstarter startet.",
      "signupCta": "Zum Start benachrichtigen",
      "signupNote": "Bestätige deine E-Mail-Adresse, um die Anmeldung abzuschließen.",
      "priceNote": "Frühbucherpreis · erste 100 Unterstützer auf Kickstarter",
      "priceNoteHighlight": "erste 100",
      "discountLabel": "Rabatt",
      "includeNote": "Gehäuse + App. Smartwatch separat erhältlich.",
      "compatibility": "Kompatible Uhren prüfen",
      "logTitle": "Deine Apnoetauchgänge im Logbuch.",
      "logBody": "Sieh dir deine Apnoetauchgänge auf WatchDive an. Synchronisiere dein Tauchprofil nach dem Tauchgang mit der DIVEROID App.",
      "cameraTitle": "Deine Aufnahmen. Dein Tauchgang.",
      "cameraBody": "Führe Aufnahmen von GoPro, Insta360, Canon und weiteren Kameras mit deinem Tauchlogbuch in der DIVEROID App zusammen.",
      "finalTitle": "Sei beim Start von WatchDive dabei.",
      "finalBody": "Erhalte den Kickstarter-Link zum Start per E-Mail.",
      "questionTitle": "Gut zu wissen.",
      "noPayment": "Kostenlose Startbenachrichtigung. Keine Zahlung nötig.",
      "switchPrompt": "Entdecke den anderen Tauchmodus",
      "title": "Deine Smartwatch.\nDein Apnoecomputer.",
      "intro": "Ergänze eine kompatible Apple Watch oder Galaxy Watch um das WatchDive-Sensorgehäuse. Lies Tiefe, Tauchzeit und Wassertemperatur am Handgelenk ab.",
      "heroCaption": "Freitauchen mit WatchDive",
      "benefitTitle": "Das Wesentliche für deinen Apnoetauchgang.",
      "benefits": [
        {
          "title": "Tiefe, Zeit und Temperatur im Blick.",
          "body": "Lies deine Tauchdaten auf der Smartwatch ab, die du schon kennst."
        },
        {
          "title": "Behalte dein Tauchprofil.",
          "body": "Synchronisiere es nach dem Tauchgang mit der DIVEROID App und sieh dir deinen Eintrag an."
        },
        {
          "title": "Deine Uhr bleibt deine Uhr.",
          "body": "Zum Tauchen kommt das WatchDive-Gehäuse dazu. An Land nutzt du deine Smartwatch wie gewohnt."
        }
      ],
      "depthAnswer": "Die empfohlene Einsatztiefe beträgt 40 m. Das Gehäuse hat einen Wasserdichtigkeitstest bei 60 m absolviert. Das ist keine unabhängige Zertifizierung und keine Garantie für jede Umgebung. Beachte die Grenzen deiner Ausbildung und die aktuellen Bedingungen.",
      "logImageAlt": "WatchDive Apnoe-Logbuch"
    },
    "scuba": {
      "modes": {
        "freediving": "Apnoetauchen",
        "scuba": "Gerätetauchen"
      },
      "discover": "So funktioniert’s",
      "howTitle": "Deine Uhr. Dazu WatchDive.",
      "howIntro": "Das Gehäuse misst Tiefe und Wassertemperatur. Deine Smartwatch zeigt die Werte an.",
      "signupTitle": "Erfahre, wann WatchDive startet.",
      "signupBody": "Wir senden dir den Link, sobald WatchDive auf Kickstarter startet.",
      "signupCta": "Zum Start benachrichtigen",
      "signupNote": "Bestätige deine E-Mail-Adresse, um die Anmeldung abzuschließen.",
      "priceNote": "Frühbucherpreis · erste 100 Unterstützer auf Kickstarter",
      "priceNoteHighlight": "erste 100",
      "discountLabel": "Rabatt",
      "includeNote": "Gehäuse + App. Smartwatch separat erhältlich.",
      "compatibility": "Kompatible Uhren prüfen",
      "logTitle": "Wieder aufgetaucht. Im Logbuch gespeichert.",
      "logBody": "Synchronisiere dein Tauchprofil nach dem Tauchgang mit der DIVEROID App. So findest du deine Tauchgänge an einem Ort.",
      "cameraTitle": "Deine Aufnahmen. Dein Tauchgang.",
      "cameraBody": "Führe Aufnahmen von GoPro, Insta360, Canon und weiteren Kameras mit deinem Tauchlogbuch in der DIVEROID App zusammen.",
      "finalTitle": "Sei beim Start von WatchDive dabei.",
      "finalBody": "Erhalte den Kickstarter-Link zum Start per E-Mail.",
      "questionTitle": "Gut zu wissen.",
      "noPayment": "Kostenlose Startbenachrichtigung. Keine Zahlung nötig.",
      "switchPrompt": "Entdecke den anderen Tauchmodus",
      "title": "Deine Smartwatch.\nDein Tauchcomputer.",
      "intro": "Ergänze eine kompatible Apple Watch oder Galaxy Watch um das WatchDive-Sensorgehäuse. Sieh deine Tauchdaten auf der Uhr, die du schon kennst.",
      "heroCaption": "WatchDive unter Wasser im Einsatz",
      "benefitTitle": "Deine Tauchdaten am Handgelenk.",
      "benefits": [
        {
          "title": "Behalte die Nullzeit im Blick.",
          "body": "Zeigt Nullzeit, Dekompressionshinweise und Aufstiegswarnungen an."
        },
        {
          "title": "Orientierung und Daten im Blick.",
          "body": "Kompass, Tiefe, Tauchzeit und Wassertemperatur auf deiner Smartwatch."
        },
        {
          "title": "Sieh dir deinen Tauchgang danach an.",
          "body": "Synchronisiere dein Tauchprofil nach dem Auftauchen mit der DIVEROID App."
        }
      ],
      "depthAnswer": "Die empfohlene Einsatztiefe beträgt 40 m. Das Gehäuse hat einen Wasserdichtigkeitstest bei 60 m absolviert. Das ist keine unabhängige Zertifizierung und keine Garantie für jede Umgebung. Beachte die Grenzen deiner Ausbildung und die aktuellen Bedingungen.",
      "logImageAlt": "Gerätetauch-Logbuch in der DIVEROID App"
    }
  },
  "pt-BR": {
    "freediving": {
      "modes": {
        "freediving": "Mergulho livre",
        "scuba": "Mergulho autônomo"
      },
      "discover": "Veja como funciona",
      "howTitle": "Seu relógio, com WatchDive.",
      "howIntro": "A caixa mede a profundidade e a temperatura da água. Seu smartwatch exibe os dados.",
      "signupTitle": "Receba o aviso de lançamento.",
      "signupBody": "Enviaremos o link quando o WatchDive chegar ao Kickstarter.",
      "signupCta": "Avise-me no lançamento",
      "signupNote": "Confirme seu e-mail para concluir o cadastro.",
      "priceNote": "Preço de lançamento · primeiros 100 apoiadores no Kickstarter",
      "priceNoteHighlight": "primeiros 100",
      "discountLabel": "de desconto",
      "includeNote": "Caixa + app. Smartwatch vendido separadamente.",
      "compatibility": "Confira os relógios compatíveis",
      "logTitle": "Seu mergulho livre, no seu diário.",
      "logBody": "Veja seus registros de mergulho livre no WatchDive. Após o mergulho, sincronize seu perfil com o app DIVEROID.",
      "cameraTitle": "Suas imagens junto do seu mergulho.",
      "cameraBody": "Reúna imagens da GoPro, Insta360, Canon e outras câmeras com seu diário de mergulho no app DIVEROID.",
      "finalTitle": "Acompanhe o lançamento do WatchDive.",
      "finalBody": "Receba por e-mail o link de lançamento no Kickstarter.",
      "questionTitle": "Antes de começar.",
      "noPayment": "Aviso de lançamento gratuito. Sem pagamento.",
      "switchPrompt": "Conheça o outro modo de mergulho",
      "title": "Seu smartwatch.\nSeu computador de apneia.",
      "intro": "Adicione a caixa com sensores WatchDive a um Apple Watch ou Galaxy Watch compatível. Veja profundidade, tempo de mergulho e temperatura da água no pulso.",
      "heroCaption": "Mergulho livre com WatchDive",
      "benefitTitle": "O essencial para sua apneia.",
      "benefits": [
        {
          "title": "Profundidade, tempo e temperatura.",
          "body": "Confira os dados do mergulho no smartwatch que você já conhece."
        },
        {
          "title": "Guarde seu perfil de mergulho.",
          "body": "Após o mergulho, sincronize com o app DIVEROID e reveja seu registro."
        },
        {
          "title": "Continue com seu relógio.",
          "body": "Para mergulhar, adicione a caixa WatchDive. Em terra, use seu smartwatch como de costume."
        }
      ],
      "depthAnswer": "A profundidade de uso recomendada é de 40 m. A caixa concluiu um teste de resistência à água a 60 m; isso não é uma certificação independente nem uma garantia para todos os ambientes. Mergulhe dentro dos limites do seu treinamento e das condições do dia.",
      "logImageAlt": "Diário de mergulho livre do WatchDive"
    },
    "scuba": {
      "modes": {
        "freediving": "Mergulho livre",
        "scuba": "Mergulho autônomo"
      },
      "discover": "Veja como funciona",
      "howTitle": "Seu relógio, com WatchDive.",
      "howIntro": "A caixa mede a profundidade e a temperatura da água. Seu smartwatch exibe os dados.",
      "signupTitle": "Receba o aviso de lançamento.",
      "signupBody": "Enviaremos o link quando o WatchDive chegar ao Kickstarter.",
      "signupCta": "Avise-me no lançamento",
      "signupNote": "Confirme seu e-mail para concluir o cadastro.",
      "priceNote": "Preço de lançamento · primeiros 100 apoiadores no Kickstarter",
      "priceNoteHighlight": "primeiros 100",
      "discountLabel": "de desconto",
      "includeNote": "Caixa + app. Smartwatch vendido separadamente.",
      "compatibility": "Confira os relógios compatíveis",
      "logTitle": "De volta à superfície, reveja o mergulho.",
      "logBody": "Após o mergulho, sincronize seu perfil com o app DIVEROID. Reúna seus mergulhos em um só lugar.",
      "cameraTitle": "Suas imagens junto do seu mergulho.",
      "cameraBody": "Reúna imagens da GoPro, Insta360, Canon e outras câmeras com seu diário de mergulho no app DIVEROID.",
      "finalTitle": "Acompanhe o lançamento do WatchDive.",
      "finalBody": "Receba por e-mail o link de lançamento no Kickstarter.",
      "questionTitle": "Antes de começar.",
      "noPayment": "Aviso de lançamento gratuito. Sem pagamento.",
      "switchPrompt": "Conheça o outro modo de mergulho",
      "title": "Seu smartwatch.\nSeu computador de mergulho.",
      "intro": "Adicione a caixa com sensores WatchDive a um Apple Watch ou Galaxy Watch compatível. Veja os dados do mergulho no relógio que você já conhece.",
      "heroCaption": "WatchDive em ação debaixo d’água",
      "benefitTitle": "Os dados do mergulho no seu pulso.",
      "benefits": [
        {
          "title": "Confira o tempo sem descompressão.",
          "body": "Exibe tempo sem descompressão, orientações de descompressão e alertas de subida."
        },
        {
          "title": "Veja a direção e os dados.",
          "body": "Bússola, profundidade, tempo de mergulho e temperatura da água no seu smartwatch."
        },
        {
          "title": "Reveja seu mergulho depois.",
          "body": "Ao voltar à superfície, sincronize seu perfil de mergulho com o app DIVEROID."
        }
      ],
      "depthAnswer": "A profundidade de uso recomendada é de 40 m. A caixa concluiu um teste de resistência à água a 60 m; isso não é uma certificação independente nem uma garantia para todos os ambientes. Mergulhe dentro dos limites do seu treinamento e das condições do dia.",
      "logImageAlt": "Diário de mergulho autônomo no app DIVEROID"
    }
  }
};

export function segmentCopy(locale: Locale, segment: DiveSegment): SegmentCopy {
  return SEGMENT_COPY[locale][segment];
}
