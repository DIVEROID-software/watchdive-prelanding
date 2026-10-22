# Buddy Invite 운영 런북

규칙의 원본은 `src/lib/referral/program.ts` 입니다. 숫자·보상·마감은 그 파일만 바꿉니다. 모든 스크립트는 기본이 dry-run이며 `--apply`가 있어야 씁니다. 공개 규칙에 없는 보상은 약속하지 않습니다.

## 환경 변수

| 변수 | 용도 |
|---|---|
| `WATCHDIVE_REFERRAL_PROGRAM_ENABLED` | 마스터 스위치. `1`일 때만 프로그램 전체(환영 메일, 카드, 리더보드, 상태/규칙 페이지, 알림)가 켜집니다. 꺼져 있으면 `referral-announce --apply`도 거부됩니다. |
| `WATCHDIVE_REFERRAL_CLOSES_AT` | 마감 시각(ISO). 이 시각 이후 인증된 친구는 누구에게도 집계되지 않습니다. 비어 있으면 장기 마감(2027-01-31 23:59 한국 시간)이 적용됩니다. 장기 마감보다 늦은 값은 버려집니다. |
| `WATCHDIVE_REFERRAL_NOTICES_ENABLED` | 친구 참여 알림 메일(1시간당 1통 이하). 릴리스 순서 마지막 단계에서만 켭니다. |
| `WATCHDIVE_REFERRAL_RELEASED_AT` | 프로그램 공개 시각. 공지 대상(그 이전 인증자) 판정용. `--released-at`으로도 줄 수 있습니다. |
| `WATCHDIVE_SENDER_PHONE` | 한국 광고성 메일(ko 로케일 또는 가입 국가 KR) 발신자 블록의 전화번호. **값: `+82 10-6517-6232`** (오너 확정). 비어 있으면 ko/KR 대상 환영 안내·알림은 발송이 거부(throw)되고, 공지 `--apply`는 첫 발송 전에 `sender_phone_missing`으로 중단됩니다. |
| `WATCHDIVE_VERIFICATION_SECRET` | 기존 인증 비밀키. 모든 Buddy 메일의 수신거부 링크(`/unsubscribe/<token>`) 서명에 씁니다. 없으면 Buddy 메일은 발송되지 않습니다. |
| `NOTION_API_KEY`, `NOTION_WAITLIST_DB_ID`, `WATCHDIVE_PUBLIC_ORIGIN`, 상태 토큰 비밀키, 발송 시 `RESEND_API_KEY`·`WATCHDIVE_EMAIL_FROM` | 기존 스크립트와 동일. 값은 출력하지 않습니다. |

`WATCHDIVE_REFERRAL_CLOSES_AT`가 비어 있으면 마감은 코드의 장기 마감 `2027-01-31T23:59:00+09:00`(2027년 1월 31일 23:59 한국 시간)입니다. 그보다 이른 값을 넣으면 그 시각이 적용되고, 그보다 늦은 값은 버려지고 장기 마감이 남습니다 (`referralClosesAt`, `src/lib/referral/program.ts`). 환경 변수로 이 시각을 넘길 수 없습니다.

`referral-schema.ts`에는 `--help`가 없습니다. `--help`는 `unknown_argument`(종료 1)로 거절됩니다. 인자가 없으면 계획만 보고, `--apply`가 있을 때만 씁니다. `--dry-run`은 계획과 같습니다. Notion 변수가 없으면 `misconfigured`로 끝나고 아무 열도 만들지 않습니다. `referral-announce.ts`와 `referral-report.ts`는 `--help`가 있으며, Notion을 호출하지 않습니다.

## 릴리스 순서 (이 순서를 지킨다)

오너의 최종 확인 전에는 어떤 메일도 나가지 않습니다.

1. **스키마**: `node --experimental-strip-types --env-file=.env scripts/referral-schema.ts` 로 계획 확인 → 타입 충돌 없으면 `--apply`. 여덟 개 속성(닉네임, 리더보드 동의, 닉네임 숨김, 알림 끄기, 마지막 알림 수, 알림 시각, 보상 검수, Dive Leader 도달 시각 `Referral leader reached at`)만 추가하고 재조회로 검증합니다. 이 속성들이 하나라도 없으면 알림 패스는 아무것도 읽거나 보내지 않고 `referral_notices_schema_missing` 로그를 남깁니다. 기존 속성은 건드리지 않습니다.
2. **발신자 전화번호 설정**: Vercel **Production과 Preview** 모두에 `WATCHDIVE_SENDER_PHONE=+82 10-6517-6232` 를 넣고, 공지 스크립트를 돌리는 서버(Mac mini)의 env 파일에도 같은 값을 넣습니다. 없으면 한국어/KR 메일은 나가지 않습니다(의도된 차단).
3. **스위치 끈 채로 배포**: Production의 `WATCHDIVE_REFERRAL_PROGRAM_ENABLED`가 없거나 `1`이 아닌 것을 확인한 뒤 코드를 올립니다. 배포 직후 Production `/`와 `/ko`는 예전 선착순 100명 문구 그대로이고, `/buddy-rules`와 `/ko/buddy-rules`는 404여야 합니다. 랭킹이나 새 초대 카드가 보이면 스위치가 켜진 것이므로 아래 롤백으로 끕니다.
4. **Preview 확인**: Preview에만 스위치를 `1`로 켜고 화면·문구·링크를 검토합니다. 클릭 순서는 `docs/referral-owner-checklist.md`입니다. Production 데이터에 쓰지 않고, 이 단계에서는 메일을 보내지 않습니다.
5. **오너 최종 확인**: 오너가 명시적으로 승인합니다. 승인 전에는 6번으로 가지 않습니다.
6. **Production 스위치 ON**: Production의 `WATCHDIVE_REFERRAL_PROGRAM_ENABLED`만 `1`로 바꿉니다. `WATCHDIVE_REFERRAL_NOTICES_ENABLED`는 아직 켜지 않습니다. 반영 후 Production `/buddy-rules`가 열리고, 히어로·오퍼의 $149 문장이 선착순 100명에 더해 가격 예약과 다이브 팀을 말하는지 확인합니다.
7. **자기 테스트**: 환영 안내는 가입 인증이 끝날 때 나갑니다. 별도 발송 스크립트는 없습니다. 오너 본인 주소로 Production에서 새로 가입·인증하고, 한국어 메일이면 제목 앞에 `(광고) `, 하단에 전화번호 `+82 10-6517-6232`와 수신거부가 있는지 봅니다. 기존 인증자에게 보내는 공지는 그와 별개이며 `referral-announce --only <내 이메일> --apply --confirm wd-buddy-invite-20261022`입니다. `--only`는 공개 시각 조건을 무시합니다.
8. **공지 배치 발송**(아래 참고): 소량 → 나머지.
9. **알림 켜기**: `WATCHDIVE_REFERRAL_NOTICES_ENABLED` ON.

## 기존 인증자 공지 (`referral-announce`)

프로그램 공개 이전에 인증한 사람은 새 환영 메일(안내)을 받지 못했으므로 한 번만 보냅니다. 인증됨·수신거부 아님(상태 unsubscribed/suppressed, `Launch mail`·`Reservation mail`의 `unsubscribed` 표시 — 같은 받은편지함의 다른 행 포함)·suspect/중복 아님·`Ref code`와 `Lead ID` 있음 조건이며, 공개 시각 이후 인증자는 대상이 아닙니다(새 환영 메일을 받음).

서버 `POST /api/cron/referral-announce`가 서명·조회·발송을 담당합니다. Mac mini에는 기존 `WATCHDIVE_REMINDER_CRON_SECRET`에 해당하는 bearer secret만 필요하며, Vercel의 `WATCHDIVE_VERIFICATION_SECRET`을 내보내지 않습니다. 먼저 스키마 계획/적용 절차로 `Referral announce` rich_text 열을 추가하고 확인합니다.

Mac mini 전용 비공개 JSON 파일(권한 600)에 `{"secret":"<기존 reminder cron secret>"}`를 저장합니다. 아래 `<config>`는 그 파일 경로입니다. 기존 reminder 설정 파일도 `secret` 필드가 있으면 사용할 수 있습니다.

```
# 건수만 확인, 발송/행 쓰기 없음
node --experimental-strip-types scripts/referral-announce.ts --config <config> --released-at <T> --confirm wd-buddy-invite-20261022 --dry-run
# 자기 테스트 (별도 멱등 키, Notion 행에 표시하지 않음)
node --experimental-strip-types scripts/referral-announce.ts --config <config> --released-at <T> --confirm wd-buddy-invite-20261022 --only me@example.com --apply
# 소량 배치; 결과를 검수하고 같은 명령으로 다음 배치 진행
node --experimental-strip-types scripts/referral-announce.ts --config <config> --released-at <T> --confirm wd-buddy-invite-20261022 --limit 20 --apply
```

- dry-run도 서버 마스터 스위치 ON 및 정확한 `--confirm`이 필요합니다. OFF는 404이며 Notion을 읽지 않습니다. `--released-at`은 고정 ISO 시각, `--limit`은 1~200(기본 20)입니다. `--rate`/`--receipt-dir`는 폐기되었습니다.
- Notion `Referral announce`에 발송 전 `intent <ISO> <keyhash>`, 제공자 접수 후 `sent <ISO> <keyhash>`를 기록합니다. 어떤 표시라도 있으면 같은 받은편지함의 모든 행을 제외합니다. `sent`는 `alreadySent`, 나머지는 `heldUnresolved`입니다. 실패도 intent를 지우거나 재발송하지 않습니다.
- `--only`는 공개 시각 조건만 무시하고 인증·수신거부·광고 규칙은 그대로 적용합니다. 별도 selftest 멱등 키를 사용하고 행에 기록하지 않으므로, 제공자 멱등 보관 기간 이후 반복하면 다시 발송될 수 있습니다. 오너 테스트 완료 후 반복하지 않습니다.
- 응답과 CLI 출력은 건수만 포함하며 주소·링크·메일 샘플을 출력하지 않습니다. `sent`는 제공자 접수 건수이며 받은편지함 도착 증거가 아닙니다. sent 기록 실패 시 접수 건수와 held가 함께 증가할 수 있습니다.
- 순차 발송(500ms 간격), 35초 작업 예산/45초 외부 요청 중단 신호, 최대 200건입니다. 시간 부족 건은 `deferred`이며 다음 배치에서 처리합니다. 전체 조회(최대 200페이지)가 완료되지 않으면 발송하지 않습니다.
- **Mac mini 단일 호출자만 운영**합니다. config 옆 `.referral-announce.lock`이 중첩 실행을 막습니다. Notion PATCH는 원자적 CAS가 아니므로 다른 호스트/직접 API 호출을 병행하지 않습니다. HTTP 결과가 불명확하면 잠금을 유지합니다. 서버 실행 종료 및 Notion/Resend 영수증을 확인한 뒤에만 잠금을 수동 해제하며 intent는 지우지 않습니다.
- 본문은 새 환영 안내 메일과 같은 렌더러(`buddyGuideBody`)입니다. 모든 Buddy 메일(환영 안내·알림·공지)은 `List-Unsubscribe`(https 원클릭 + mailto)와 `List-Unsubscribe-Post`를 달고, 수신거부 링크는 기존 `/unsubscribe/<token>`을 씁니다(POST 시 `Launch mail`에 `unsubscribed` 기록 → 출시·예약·Buddy 알림·공지 모두 중단).
- ko 로케일 또는 가입 국가 KR: 제목 앞 `(광고) `, 하단에 `보내는 곳: DIVEROID LTD · help@diveroid.com · <전화> · <주소>`와 한/영 수신거부 문구(정보통신망법 제50조).

## 마감 시각 설정

Kickstarter 공개 시각이 정해지면 `WATCHDIVE_REFERRAL_CLOSES_AT`을 그 직전으로 잡습니다. 비어 있는 동안에는 장기 마감(2027-01-31 23:59 한국 시간)이 이미 적용 중입니다. 규칙상 **마감일을 최소 7일 전에 공지**해야 하므로 공지(랜딩·규칙 페이지·메일)를 먼저 하고, 그 후에 값을 넣습니다. 알린 마감은 한 번만, 원래 시각 48시간 전 메일 고지와 함께만 옮깁니다. 장기 마감보다 뒤로 미룰 수 없습니다.

마감 직후, 아래 주간 검수 명령에 `--out`과 `--with-emails`를 붙여 **한 번** 실행하고 그 파일을 비공개로 보관합니다. 그 파일이 공식 확정 결과입니다. 나중에 `--now`로 다시 돌린 출력은 마감 판정과 생성 시각만 바꿀 뿐 당시 행 상태를 재현하지 않으므로 확정본을 대신하지 않습니다.

## 주간 검수

```
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --help
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --out report.json
```

`--help`와 `--out` 없는 실행은 요약을 표준 출력에만 씁니다. `--with-emails`만 주고 `--out-dir`이 없으면 종료 1이며 파일을 만들지 않습니다. `--now <ISO>`는 판정 시각만 바꿉니다. 이 명령은 읽기 전용입니다.

- 요약은 이메일·페이지 ID가 없는 JSON입니다(티어별 인원, 제외 건수, 상위 10, 라이트 배분 순번 1..30, 리더보드 스냅샷).
- 상위 20명과 10명 이상 달성자는 `review_needed`와 사유 코드로 표시됩니다: `burst_verifications`(10분 안 5명 이상 인증), `disposable_domains`, `rare_domains`, `same_locale`/`same_landing_path`/`same_utm`(80% 이상 동일), `fast_verify`(가입 후 60초 내 인증이 절반 이상), `quick_confirmation`(인증 메일 발송 후 20초 안에 인증한 친구 2명 이상, Google/Apple 로그인은 제외), `alias_services`(duck.com·mozmail.com·SimpleLogin·addy.io·Proton Pass 등 별칭/포워딩 주소 친구 3명 이상; 친구로는 인정됨), `domain_concentration`(주요 메일 서비스가 아닌 한 도메인에 친구 4명 이상), `pending_ratio`(미인증 가입 5건 이상이고 전체의 67% 이상), `burst_signups`(10분 안 가입 5건 이상, 미인증 포함). 신호는 사람이 보는 단서일 뿐 자동 제외가 아닙니다. 친구 이메일은 요약에 나오지 않으며 두 명 이상이 공유한 도메인만 집계됩니다.
- 의심되면 Notion에서 해당 행의 `Referral reward review`를 `pending`으로 두고 조사, 문제 없으면 `approved`, 부정이면 `rejected`로 바꿉니다. `rejected`는 리포트의 조기 안내·Dive Team·라이트·상위 후보 파일에서 빠집니다. 집계 자체(친구 수)를 고치려면 해당 친구 행의 Suspect/Duplicate를 사용합니다.
- 닉네임 숨김: 부적절하거나 사칭이면 해당 행의 **`Referral nickname hidden`** 체크. 공개 리더보드에는 "비공개 다이버"로 표시됩니다.

## 출시일 조기 안내 (런치 메일)

주소가 필요한 파일은 `--with-emails --out-dir <dir>`일 때만 만들어지며 권한 0600(디렉터리 0700)입니다. 저장소 밖 비공개 위치를 쓰고 사용 후 삭제합니다.

```
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --with-emails --out-dir <private dir> --out report.json
```

파일: `early-notice-2h.csv`, `early-notice-1h.csv`, `dive-team.csv`, `light-winners.csv`, `top-candidates.csv`.

캠페인 공개 시각을 T라고 합니다. 일반 명단은 버디 초대 단계가 없는 인증 대기자(친구 0명)입니다.

1. **T-2시간**: `early-notice-2h.csv`만 (3명 이상, 다이브 팀·다이브 리더 포함). 안내 메일이며, 아직 열리지 않은 캠페인 링크를 넣지 않습니다.
2. **T-1시간**: `early-notice-1h.csv`만 (1~2명). 2시간 구간에 있는 주소가 섞이지 않았는지 확인합니다.
3. **T**: 공개 링크 메일은 **선공개를 받은 사람을 포함한 인증 대기자 전원**에게 보냅니다. 선공개 명단을 공개 메일에서 빼면, 그 사람들은 링크 메일을 받지 못합니다.

`scripts/launch-mail.ts`는 이 CSV를 읽지 않습니다. 웨이브는 `t-1d`, `t-1h`, `t-0`뿐이고 각 웨이브는 인증된 대기자 전체를 고릅니다. `t-2h` 웨이브는 없습니다. `t-1h`의 발송 창은 공개 90분 전~40분 전이라 2시간 전 약속과 맞지 않습니다. `--wave t-1h`나 `t-0`으로 선공개를 대신하지 마십시오. 전원에게 같은 시각에 나가거나, 2시간 전 약속이 깨집니다.

선공개만 골라 보내는 스크립트는 이 저장소에 없습니다. Kickstarter 공개 전에, CSV의 주소만 넣고 `(광고)`·수신거부·발신자 블록을 유지하는 발송 방법을 따로 정합니다. 그 방법이 생기기 전에는 1시간·2시간 선공개를 실행했다고 기록하지 않습니다. `t-1d`(하루 전, 전원) 본문은 “한 시간 전에 다시 쓴다”고 되어 있어, 2시간 전 안내를 받는 사람(3명 이상)과 문장이 어긋납니다. 공개 전에 그 문장도 같이 고칩니다. 이 항목은 프로그램 스위치를 켜는 조건이 아니라, 캠페인 공개 전의 조건입니다.

## 보상 처리

배송 전에는 공통으로 다음을 확인합니다. 가입 폼은 나이와 임직원 여부를 받지 않으므로 코드가 걸러 주지 않습니다.

- 만 19세(한국 거주) 또는 만 18세이면서 거주지 성년. 미달이면 실물 혜택은 다음 순서로 넘깁니다.
- DIVEROID LTD·계열사의 임직원·계약자, 이 프로그램 운영에 참여한 사람, 그 가구원은 실물 혜택 제외. 오픈 소식 선공개와 다이브 팀 링크는 규칙상 받을 수 있습니다.
- 라이트와 WatchDive는 WatchDive 킥스타터 배송 국가로만. 그 목록을 마감 전에 규칙 페이지에 올리지 않았으면 보내지 않습니다. 목록 밖이면 다음 순서로 넘깁니다.
- 한 사람과 한 가구에 라이트 1개, WatchDive 1개. 이름·주소·전화번호로 겹치면 하나를 넘깁니다. 한 사람이 라이트와 WatchDive를 같이 받는 것은 허용됩니다.
- `review_needed`는 확정 전에 사람이 봅니다. 자동 제외가 아닙니다.

경품 연락(당첨·배송·세금)은 경품 지급 안내에 해당하므로 제목에 `(광고)`를 붙이지 않습니다. 수신 거부한 사람에게는 그 보상 처리에 필요한 연락만 합니다 (`contact` = `unsubscribed`).

- **Dive Team (5명)**: `dive-team.csv`로 비공개 Kickstarter 리워드 링크를 개별 발송합니다. 링크는 대상자만 알 수 있는 비공개 값이며 공개 채널·로그·리포트에 남기지 않습니다. 회원 1명당 후원 1건, 킥스타터 웹사이트(로그인, PC·모바일 브라우저)에서만, 앱·레이트 플레지·플레지 매니저에서는 쓸 수 없다고 적습니다. 배송비와 세금은 다른 후원자와 같습니다.
- **언더워터 라이트 (10명, 선착순 30)**: `light-winners.csv`의 순번대로 30명. 사무실 재고로, 검수 후 14일 안에 연락하고 **2027년 3월 전**에 보냅니다. 모델명은 오너가 정하지 않았습니다. 규칙에는 “약 USD 70”만 있습니다. 모델이 정해지면 연락 메일에 적고, 규칙 문구를 그 다음에 바꿉니다. 배송비·관세는 받는 사람 부담. 14일 안에 답이 없거나 받을 수 없으면 10명 달성 순서의 다음 사람에게 넘깁니다.
- **상위 3명**: 마감 직후 보관한 `top-candidates.csv`로 순위를 확정합니다. 캠페인이 목표에 못 미쳐도, 취소되어도, 늦어져도 WatchDive 센서 하우징을 줍니다. 현금 대체가 아닙니다. 당첨자가 Apple Watch용 또는 Galaxy Watch용을 고릅니다. 시계는 포함되지 않습니다. 마감 후 14일 안에 연락하고 2027년 3월 전에 보냅니다. 14일 안에 답이 없으면 랭킹의 다음 사람에게 넘깁니다.
- **한국 원천징수 (D6)**: 라이트(약 USD 70)와 WatchDive(USD 299) 모두 5만원을 넘으므로 22% 대상입니다. 한국 거주 당첨자에게 발송 전에 세무사가 확인한 금액을 안내하고, 그 금액을 회사에 받은 뒤에만 보냅니다. 성명·주민등록번호·주소는 그 신고에만 쓰고 세법이 정한 기간만 보관합니다. **영국 법인 DIVEROID LTD가 한국 원천징수 의무자인지는 세무사 확인 전입니다.** 확인 전에는 한국으로 실물 경품을 보내지 않습니다. 세액을 회사가 대신 부담하는 방식(그로스업)은 오너 결정이 아닙니다.
- **당첨 공개**: 공개 랭킹은 상위 3명만, 닉네임을 켠 사람만 보여 줍니다. 라이트 30명의 명단이 아닙니다. 검수가 끝나면 당첨 닉네임(또는 “비공개 다이버”)과 집계 수를 규칙 페이지에 사람이 올립니다. 30일 후 랭킹을 내리는 기능은 없습니다. 그 문장을 규칙에 넣지 않습니다.

## 법무 검토 D7 (2026-10-22) — 집계·보상 유지 규칙

- **안내한 티어는 유지**: 보유 티어 = max(현재 인정 수, `Referral notified count`). 알림 메일 이후 친구가 Suspect 등으로 빠져도 이미 안내한 티어(조기 안내 시간, Dive Team, Dive Leader)는 유지됩니다. 단 `Referral reward review` = `rejected`이면 유지되지 않습니다. 순위(상위 3명)는 현재 인정 수 기준입니다.
- **라이트 순번**: Dive Leader(10명)를 처음 안내한 알림이 발송(공급자 수락)된 뒤, 같은 기록에서 `Referral leader reached at`(날짜, 1회 기록)에 그 시점의 10번째 인정 친구 인증 시각을 씁니다. 이미 값이 있으면 절대 덮어쓰지 않고, 발송이 실패하면 쓰지 않습니다. 값이 있으면(보상 검수 `rejected` 아님) 그 값이 라이트 순번 기준입니다. 값이 없는 행(아직 안내 전, 또는 이 열 추가 전에 안내됨)은 현재 인정 기록과 10명 이상을 안내한 메일 시각(`Referral notified at`) 중 이른 값을 씁니다. 운영자는 이 열을 수정하지 않습니다.
- **수신 거부**: 친구가 인증 후 수신 거부해도 계속 집계됩니다. 상태만 `unsubscribed`로 바꾸는 것은 집계를 지우지 않습니다. 친구가 삭제를 요청하면 그 행을 지우거나 `Email verified`와 `Verified at`을 비워서, 확인된 가입이 더 이상 아니게 만듭니다. 그것만 집계에서 빠집니다. 초대한 사람이 수신 거부해도 달성한 보상과 라이트·상위 3명 순위는 유지되며, 알림·조기 안내 메일은 보내지 않습니다. 보상 파일의 `contact` 열이 `unsubscribed`이면 해당 보상 처리 목적의 연락만 합니다.
- **순위 제외**: Suspect, Duplicate, 차단 플래그, `rejected` 검수인 초대자만 순위·보상에서 빠지며, 그 자리는 다음 순서로 넘어갑니다(라이트 30개는 항상 다음 순번으로 채워짐).
- **마감 후 결과 확정**: 마감 시각 이후 인증한 친구는 집계되지 않습니다. 공식 확정 결과는 **마감 직후 실행해 보관한 ops 리포트**(`--out`, `--with-emails`)입니다. `--now`는 마감 판정과 생성 시각만 바꾸고 과거 행 상태를 재현하지 않으므로, 나중에 다시 돌려 확정 결과를 대신하지 않습니다. 이후 화면·리더보드는 ops 조치(친구 제외 등)로만 바뀌며, 그 변경은 확정 리포트를 기준으로 검토합니다.

## 롤백 (스위치 끄기)

1. Production(그리고 켜 두었다면 Preview)에서 `WATCHDIVE_REFERRAL_PROGRAM_ENABLED`를 지우거나 `1`이 아닌 값으로 바꿉니다. `WATCHDIVE_REFERRAL_NOTICES_ENABLED`도 끕니다.
2. 환경 변수가 새 배포에만 들어가면 그 배포를 한 번 올립니다. 코드 롤백이 아닙니다. 이전 커밋으로 되돌리지 않습니다.
3. 읽어서 확인합니다. Production `/buddy-rules`와 `/ko/buddy-rules`는 404. `/`와 `/ko`의 $149 문장은 스위치 끄기 전용 문구(선착순 100명, 예외 없음)로 돌아갑니다. 개인정보 처리방침에 버디 초대 절(11)이 없어야 합니다. 환영 메일은 예전 본문만 나갑니다.
4. 이미 보낸 공지·알림은 거두어지지 않습니다. 수신 거부 링크는 그대로 동작해야 합니다. 스위치를 다시 켜는 것은 오너의 새 지시가 있을 때만입니다.

## 자동화되지 않는 것

- 보상 확정, 부정 판정, 닉네임 숨김, `rewardReview` 설정(전부 수동).
- 런치 선공개 발송. 리포트가 CSV만 만듭니다. `launch-mail`은 그 CSV를 보내지 않습니다. 수신자 한정 발송은 공개 전에 따로 만듭니다.
- Dive Team 비공개 링크 생성·발송, 라이트·상위 3명 연락과 배송, 한국 원천세 수령.
- 마감 시각 공지(7일 전)와 `WATCHDIVE_REFERRAL_CLOSES_AT` 입력.
- 스키마 적용, 스위치 전환, 공지 발송 시작(모두 오너 확인 후 수동).
- 나이·임직원·배송 국가·가구 중복은 배송 때 사람이 확인합니다.
- 친구 참여 알림은 서버 틱이 자동이지만 마스터 스위치와 `WATCHDIVE_REFERRAL_NOTICES_ENABLED`가 둘 다 `1`일 때만 동작합니다 (`referralNoticesEnabled`).

## 스위치 전에 오너가 아직 가진 항목

프로그램 스위치를 켜도 되고, 켜기 전에 막을 것은 아닙니다. 해당 시점이 오기 전에 끝내야 합니다.

- 라이트 제품명. 지금은 약 USD 70만 규칙에 있습니다.
- 킥스타터 배송 국가 목록. 마감 전에 규칙 페이지에 공개합니다.
- 한국 경품의 원천징수 의무자(영국 법인 여부)에 대한 세무사 확인. 확인 전 한국 실물 발송 금지.
- 선공개 CSV만 보내는 방법, 그리고 `t-1d` 메일의 “한 시간 전” 문장. 캠페인 공개 전.
- 기존 예약 메일·런치 메일에는 `(광고)`와 발신자 전화번호 블록이 없습니다. 버디 메일만 갖추고 있습니다. 한국 수신자에게 그 두 메일을 보내기 전에 같은 형식을 넣습니다.
- 이탈리아·퀘벡을 실물 혜택에서 빼지는 않았습니다. 오너 결정은 킥스타터 배송 국가로 한정하는 것입니다.


### Notice delivery claims (final review, 2026-10-22)

The notice pass now writes the notified count/time (and first leader instant) **before** calling the mail provider. A failed or unknown claim write sends nothing. A successful claim followed by a crash, timeout, unknown provider outcome or failed rollback stays claimed: a missed notice is preferred to a duplicate after provider idempotency retention expires. Only definitive HTTP 4xx rejection (excluding 408/409) attempts to restore the previous count/time and remove a newly claimed leader stamp. The count is therefore a delivery claim, not proof of inbox delivery; unknown outcomes may retain tiers without a delivered notice.

Run notices only from the existing single office Mac mini five-minute cron caller and do not overlap it with manual/API invocations. Notion PATCH is not compare-and-swap; this claim is not a distributed lock and does not certify at-most-once across concurrent callers. Do not clear a retained claim or replay an unknown outcome without provider reconciliation. OFF still performs no referral schema/row read or write.
