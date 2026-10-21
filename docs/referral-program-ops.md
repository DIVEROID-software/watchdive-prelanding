# Buddy Invite 운영 런북

규칙의 원본은 `src/lib/referral/program.ts` 입니다. 숫자·보상·마감은 그 파일만 바꿉니다. 모든 스크립트는 기본이 dry-run이며 `--apply`가 있어야 씁니다. 공개 규칙에 없는 보상은 약속하지 않습니다.

## 환경 변수

| 변수 | 용도 |
|---|---|
| `WATCHDIVE_REFERRAL_PROGRAM_ENABLED` | 마스터 스위치. `1`일 때만 프로그램 전체(환영 메일, 카드, 리더보드, 상태/규칙 페이지, 알림)가 켜집니다. 꺼져 있으면 `referral-announce --apply`도 거부됩니다. |
| `WATCHDIVE_REFERRAL_CLOSES_AT` | 마감 시각(ISO). 이 시각 이후 인증된 친구는 누구에게도 집계되지 않습니다. 비어 있으면 미정. |
| `WATCHDIVE_REFERRAL_NOTICES_ENABLED` | 친구 참여 알림 메일(1시간당 1통 이하). 릴리스 순서 마지막 단계에서만 켭니다. |
| `WATCHDIVE_REFERRAL_RELEASED_AT` | 프로그램 공개 시각. 공지 대상(그 이전 인증자) 판정용. `--released-at`으로도 줄 수 있습니다. |
| `WATCHDIVE_SENDER_PHONE` | 한국 광고성 메일(ko 로케일 또는 가입 국가 KR) 발신자 블록의 전화번호. **값: `+82 10-6517-6232`** (오너 확정). 비어 있으면 ko/KR 대상 환영 안내·알림은 발송이 거부(throw)되고, 공지 `--apply`는 첫 발송 전에 `sender_phone_missing`으로 중단됩니다. |
| `WATCHDIVE_VERIFICATION_SECRET` | 기존 인증 비밀키. 모든 Buddy 메일의 수신거부 링크(`/unsubscribe/<token>`) 서명에 씁니다. 없으면 Buddy 메일은 발송되지 않습니다. |
| `NOTION_API_KEY`, `NOTION_WAITLIST_DB_ID`, `WATCHDIVE_PUBLIC_ORIGIN`, 상태 토큰 비밀키, 발송 시 `RESEND_API_KEY`·`WATCHDIVE_EMAIL_FROM` | 기존 스크립트와 동일. 값은 출력하지 않습니다. |

## 릴리스 순서 (이 순서를 지킨다)

오너의 최종 확인 전에는 어떤 메일도 나가지 않습니다.

1. **스키마**: `node --experimental-strip-types --env-file=.env scripts/referral-schema.ts` 로 계획 확인 → 타입 충돌 없으면 `--apply`. 일곱 개 속성(닉네임, 리더보드 동의, 닉네임 숨김, 알림 끄기, 마지막 알림 수, 알림 시각, 보상 검수)만 추가하고 재조회로 검증합니다. 기존 속성은 건드리지 않습니다.
2. **발신자 전화번호 설정**: Vercel **Production과 Preview** 모두에 `WATCHDIVE_SENDER_PHONE=+82 10-6517-6232` 를 넣고, 공지 스크립트를 돌리는 서버(Mac mini)의 env 파일에도 같은 값을 넣습니다. 없으면 한국어/KR 메일은 나가지 않습니다(의도된 차단).
3. **스위치 끈 채로 배포**: Production에 코드를 올립니다. 이때 사용자에게는 아무 변화가 없어야 합니다.
4. **Preview 확인**: Preview 환경에만 스위치를 `1`로 켜고 화면·문구·링크·리더보드를 검토합니다(Production 데이터 쓰기 금지, 실제 메일 금지).
5. **오너 최종 확인**: 오너가 명시적으로 승인합니다.
6. **Production 스위치 ON**.
7. **자기 테스트**: 새 가입(또는 본인 계정)으로 환영 메일이 정상 도착하는지 확인. 공지 메일은 `referral-announce --only <내 이메일> --apply --confirm <프로그램ID>`.
8. **공지 배치 발송**(아래 참고): 소량 → 나머지.
9. **알림 켜기**: `WATCHDIVE_REFERRAL_NOTICES_ENABLED` ON.

## 기존 인증자 공지 (`referral-announce`)

프로그램 공개 이전에 인증한 사람은 새 환영 메일(안내)을 받지 못했으므로 한 번만 보냅니다. 인증됨·수신거부 아님(상태 unsubscribed/suppressed, `Launch mail`·`Reservation mail`의 `unsubscribed` 표시 — 같은 받은편지함의 다른 행 포함)·suspect/중복 아님·`Ref code`와 `Lead ID` 있음 조건이며, 공개 시각 이후 인증자는 대상이 아닙니다(새 환영 메일을 받음).

```
# 건수와 샘플(주소 마스킹) 확인, 발송 없음
node --experimental-strip-types --env-file=.env scripts/referral-announce.ts --released-at <공개시각>
# 자기 테스트 (공개 시각 조건 무시, 별도 멱등 키)
... --released-at <T> --only me@example.com --apply --confirm wd-buddy-invite-20261022
# 소량 배치 → 나머지 (재실행하면 이어서 진행)
... --released-at <T> --limit 20 --apply --confirm wd-buddy-invite-20261022
... --released-at <T> --apply --confirm wd-buddy-invite-20261022
```

- `--apply`는 스위치 ON **그리고** `--confirm <REFERRAL_PROGRAM_ID>`가 정확할 때만 동작합니다.
- 멱등 키 `wd-buddy-invite-20261022-announce-<leadId 또는 pageId>`. 영수증(`<receipt-dir>/…announce.jsonl`)에는 주소 없이 해시만 남고 fsync 됩니다.
- 이미 수락된 사람은 건너뜁니다. 실패(제공자 거절)는 다음 실행에서 재시도, 결과 불명(intent만 있음)은 `heldUnresolved`로 보류되고 재발송하지 않습니다. 보류 건은 Resend 대시보드에서 확인한 뒤 판단합니다.
- 발송은 순차·속도제한(기본 초당 2통)이며 영수증 잠금으로 동시 실행을 막습니다.
- 본문은 새 환영 안내 메일과 같은 렌더러(`buddyGuideBody`)입니다. 모든 Buddy 메일(환영 안내·알림·공지)은 `List-Unsubscribe`(https 원클릭 + mailto)와 `List-Unsubscribe-Post`를 달고, 수신거부 링크는 기존 `/unsubscribe/<token>`을 씁니다(POST 시 `Launch mail`에 `unsubscribed` 기록 → 출시·예약·Buddy 알림·공지 모두 중단).
- ko 로케일 또는 가입 국가 KR: 제목 앞 `(광고) `, 하단에 `보내는 곳: DIVEROID LTD · help@diveroid.com · <전화> · <주소>`와 한/영 수신거부 문구(정보통신망법 제50조).

## 마감 시각 설정

`WATCHDIVE_REFERRAL_CLOSES_AT`은 Kickstarter 공개 직전으로 잡습니다. 규칙상 **마감일을 최소 7일 전에 공지**해야 하므로 공지(랜딩·규칙 페이지·메일)를 먼저 하고, 그 후에 값을 설정/배포합니다. 마감을 앞당기지 않습니다.

## 주간 검수

```
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --out report.json
```

- 요약은 이메일·페이지 ID가 없는 JSON입니다(티어별 인원, 제외 건수, 상위 10, 라이트 배분 순번 1..30, 리더보드 스냅샷).
- 상위 20명과 10명 이상 달성자는 `review_needed`와 사유 코드로 표시됩니다: `burst_verifications`(10분 안 5명 이상 인증), `disposable_domains`, `rare_domains`, `same_locale`/`same_landing_path`/`same_utm`(80% 이상 동일), `fast_verify`(가입 후 60초 내 인증이 절반 이상). 신호는 사람이 보는 단서일 뿐 자동 제외가 아닙니다. 친구 이메일은 요약에 나오지 않으며 두 명 이상이 공유한 도메인만 집계됩니다.
- 의심되면 Notion에서 해당 행의 `Referral reward review`를 `pending`으로 두고 조사, 문제 없으면 `approved`, 부정이면 `rejected`로 바꿉니다. `rejected`는 리포트의 조기 안내·Dive Team·라이트·상위 후보 파일에서 빠집니다. 집계 자체(친구 수)를 고치려면 해당 친구 행의 Suspect/Duplicate를 사용합니다.
- 닉네임 숨김: 부적절하거나 사칭이면 해당 행의 **`Referral nickname hidden`** 체크. 공개 리더보드에는 "비공개 다이버"로 표시됩니다.

## 출시일 조기 안내 (런치 메일)

주소가 필요한 파일은 `--with-emails --out-dir <dir>`일 때만 만들어지며 권한 0600(디렉터리 0700)입니다. 저장소 밖 비공개 위치를 쓰고 사용 후 삭제합니다.

```
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --with-emails --out-dir <private dir> --out report.json
```

파일: `early-notice-2h.csv`, `early-notice-1h.csv`, `dive-team.csv`, `light-winners.csv`, `top-candidates.csv`.

캠페인 공개 시각 T 기준 발송 순서(런치 메일 도구, 기존 `launch-mail`로 수동 발송):
1. **T-2시간**: `early-notice-2h.csv` (3명 이상 달성자)
2. **T-1시간**: `early-notice-1h.csv` (1~2명 달성자). 2시간 구간 주소는 이미 받았으므로 중복 제거를 확인합니다.
3. **T**: 일반 리스트(위 두 구간은 제외).

## 보상 처리

- **Dive Team (5명)**: `dive-team.csv`로 비공개 Kickstarter 리워드 링크를 개별 발송합니다. 링크는 대상자만 알 수 있는 비공개 값이며 공개 채널·로그·리포트에 남기지 않습니다. 발송 전 `review_needed` 여부를 확인합니다.
- **언더워터 라이트 (10명, 선착순 30)**: `light-winners.csv`의 순번(도달 순서)대로 30명. 사무실 재고로 배송하며 **배송비·관세/세금은 받는 사람 부담**임을 연락 메일에 명시합니다. 순번 안의 `review_needed`는 확정 전 검수합니다.
- **상위 3명 (마감 시점)**: `top-candidates.csv`로 마감 시점 순위를 확정하고 검수한 뒤 개별 연락합니다. **14일 안에 답장**이 없으면 규칙에 따라 다음 순위로 넘깁니다. 배송비·세금은 받는 사람 부담.

## 자동화되지 않는 것

- 보상 확정, 부정 판정, 닉네임 숨김, `rewardReview` 설정(전부 수동).
- 런치 조기 안내 발송(리포트 파일만 만들고 발송은 사람이 `launch-mail`로).
- Dive Team 비공개 링크 생성·발송, 라이트·상위 3명 연락과 배송.
- 마감 시각 설정과 7일 전 공지.
- 스키마 적용, 스위치 전환, 공지 발송 시작(모두 오너 확인 후 수동).
- 친구 참여 알림은 서버 틱이 자동이지만 스위치/알림 변수가 켜져 있을 때만 동작합니다.
