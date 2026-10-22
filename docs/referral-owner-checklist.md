# 버디 초대 — 오너 아침 확인 목록

이 목록은 Preview에서 눈으로 확인하고, 그 다음 명령만 순서대로 실행하는 절차입니다. 메일은 7번 자기 테스트 전에는 나가지 않습니다. 광고 계정, Notion 본문, Resend 대시보드 발송은 이 목록에 없습니다.

준비물: Vercel 프로젝트 환경 변수 화면, Preview 배포 주소, 사무실 Mac mini의 이 저장소와 `.env`. 명령은 그 서버에서만 실행합니다.

## 0. Production은 아직 끄기

1. Vercel → 이 프로젝트 → Settings → Environment Variables.
2. `WATCHDIVE_REFERRAL_PROGRAM_ENABLED`가 Production에 없거나 값이 `1`이 아닌지 확인합니다. `1`이면 값을 지우거나 `1`이 아닌 값으로 바꾸고, 환경 변수가 다시 배포되어야 적용되면 배포를 한 번 올립니다.
3. 브라우저에서 Production `https://watchdive.diveroid.com/buddy-rules` 와 `https://watchdive.diveroid.com/ko/buddy-rules` 를 엽니다. 둘 다 404여야 합니다.
4. Production `/` 와 `/ko` 의 가격 문장은 아직 “선착순 100명”만 말합니다. 랭킹 블록이 없어야 합니다.

## 1. 전화번호 (메일을 보내기 전에)

1. 같은 환경 변수 화면에서 `WATCHDIVE_SENDER_PHONE` 을 Production과 Preview 모두에 `+82 10-6517-6232` 로 넣습니다.
2. Mac mini에서 공지 스크립트가 읽는 env 파일에도 같은 값을 넣습니다. 파일 내용은 채팅이나 로그에 붙이지 않습니다.
3. `WATCHDIVE_REFERRAL_NOTICES_ENABLED` 는 Production에서 비어 있거나 `1`이 아니어야 합니다. 공지가 끝난 뒤의 단계입니다.

## 2. 스키마 계획 (쓰기 없음)

Mac mini, 저장소 루트:

```
node --experimental-strip-types --env-file=.env scripts/referral-schema.ts
```

- 종료 0, JSON의 `apply` 가 false, `ok` 가 true 이면 계획입니다. 빠진 열이 있으면 `actions` 에만 나옵니다.
- 열 타입이 이미 다르게 있으면 `schema_conflict`(종료 2)입니다. `--apply` 로 가지 않습니다.
- 이 스크립트에 `--help` 는 없습니다. 넣으면 `unknown_argument` 입니다.

계획에 더할 열만 있고 충돌이 없으면:

```
node --experimental-strip-types --env-file=.env scripts/referral-schema.ts --apply
```

끝난 뒤 인자 없이 한 번 더 실행해 `applied` 없이 `ok: true` 인지 봅니다. 여덟 열(닉네임, 리더보드 동의, 닉네임 숨김, 알림 끄기, 마지막 알림 수, 알림 시각, 보상 검수, `Referral leader reached at`)입니다.

## 3. 스위치 끈 채로 Production 배포

1. 코드를 Production에 올립니다. 환경 변수는 0번의 상태(스위치 꺼짐)를 유지합니다.
2. 배포가 끝나면 0번의 3·4를 다시 엽니다. 404와 예전 가격 문구가 그대로여야 합니다.

## 4. Preview만 스위치 켜기

1. Vercel에서 Preview 값만 `WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1` 로 넣습니다. Production은 그대로 둡니다.
2. Preview를 다시 배포하고, 브라우저에 그 Preview 주소를 엽니다. Production 주소가 아닌지 주소창을 확인합니다.

아래를 순서대로 클릭합니다. 가입 버튼을 눌러 실제 메일이 나가게 하지 않습니다. 결제·예약 버튼도 누르지 않습니다.

1. Preview `/` (영어). 히어로·오퍼의 $149 문장에 선착순 100명, 가격 예약, Dive Team, 정가 $299가 함께 있는지 읽습니다. “first 100”만 있는 문장이 남아 있으면 스위치를 올리지 않습니다. 버튼 문구는 “Notify me · $149 early bird”입니다.
2. 페이지 아래 공식 규칙 링크를 눌러 `/buddy-rules` 로 갑니다. 주최 주소(Office 12146 … E6 2JA, 회사번호 16343651), 나이 18/한국 19, 임직원·가구 실물 제외, 라이트 약 $70, WatchDive $299·시계 미포함·Apple/Galaxy 선택, 마감 2027년 1월 31일 23:59 한국 시간, 2027년 3월 전 발송, 캠페인이 실패해도 WatchDive 지급, 한국 22%를 발송 전에 회사에 냄, 2026년 10월 22일 이전 친구도 집계, 수신 거부해도 달성 혜택 유지, 하루 한도는 다음 날로 넘어가지 않음, 일반 명단의 정의가 보이는지 확인합니다.
3. Preview `/ko`. 같은 가격 문장이 한국어로 있는지 봅니다. 버튼은 “출시 알림 받기 · 얼리버드 $149”. 카드가 보이면 “아는 다이버에게 내 링크를 공유해 주세요”이고 “보내 주세요”가 아니어야 합니다. 공유 버튼은 “내 링크 공유하기”입니다. 공유 시트까지 열렸다면 문구에 $149와 선착순이 없어야 합니다. 시트를 닫습니다.
4. `/ko/buddy-rules`. 2번의 사실이 한국어로 있는지, 특히 “일반 명단은 버디 초대 단계가 없는 대기 명단”과 “대량·무단 메시지”가 있는지 봅니다.
5. `/zh-cn/buddy-rules`, `/ja/buddy-rules`, `/de/buddy-rules` 를 열어 제목과 주최 주소, 나이, $ 금액 자리표시가 그 언어로 채워져 있는지만 봅니다. 공개 주소는 소문자입니다. 영어 문장이 통째로 남아 있으면 멈춥니다.
6. `/privacy` 와 `/ko/privacy` 를 맨 아래까지 내려 버디 초대 절(11)이 있는지 봅니다. 닉네임, 랭킹, 한국 당첨자 세무 정보가 적혀 있어야 합니다.
7. 푸터의 규칙 링크가 각 언어 규칙으로 가는지 `/es`, `/fr`, `/pt-br` 에서 한 번씩 눌러 봅니다.
8. 랭킹은 비어 있거나 “검수 전”이라고 되어 있으면 정상입니다. 이메일 주소가 보이면 멈춥니다.

Preview에서 이상하면 Production 스위치를 켜지 않습니다.

## 5. 오너 승인

여기까지의 화면을 보고 승인한다고 말한 뒤에만 6번으로 갑니다.

## 6. Production 스위치

1. Vercel Production의 `WATCHDIVE_REFERRAL_PROGRAM_ENABLED` 만 `1`로 합니다. 알림 변수는 아직 끕니다.
2. 필요한 재배포 후 `https://watchdive.diveroid.com/buddy-rules` 가 열리고, `/` 의 $149 문장에 가격 예약과 다이브 팀이 포함되는지 확인합니다.
3. `/ko/buddy-rules` 도 엽니다.

## 7. 본인 환영 메일

1. Production `/ko` 에서 오너 본인 주소로만 가입하고 인증 메일의 링크를 누릅니다. 다른 주소로 시험하지 않습니다.
2. 도착한 환영 메일을 엽니다. 제목이 `(광고) ` 로 시작하는지, 아래에 `보내는 곳: DIVEROID LTD · help@diveroid.com · +82 10-6517-6232 · Office 12146…`, 한글과 영어 수신거부 문장, 수신거부 링크가 있는지 봅니다.
3. 메일의 현황 링크를 눌러 현황 페이지가 열리고, 이메일 주소가 페이지에 없는지 확인합니다. 닉네임은 저장해 보고, 랭킹 표시는 시험 중에는 끄고 둡니다.

## 8. 기존 인증자 공지 (본인 → 20명 → 나머지)

공개 시각 `<T>`는 스위치를 켠 ISO 시각으로 고정합니다. 먼저 `Referral announce` rich_text 열을 스키마 도구로 추가·확인합니다. Mac mini의 비공개 JSON 설정 `<config>`에 기존 reminder cron bearer secret을 `secret` 필드로 사용합니다(권한 600). 서명 비밀키는 Vercel에 그대로 둡니다.

```
node --experimental-strip-types scripts/referral-announce.ts --help
node --experimental-strip-types scripts/referral-announce.ts --config <config> --released-at <T> --confirm wd-buddy-invite-20261022 --dry-run
node --experimental-strip-types scripts/referral-announce.ts --config <config> --released-at <T> --only <오너 이메일> --apply --confirm wd-buddy-invite-20261022
```

둘째는 건수만 확인하며 발송하지 않습니다. dry-run도 서버 스위치 ON과 confirm이 필요합니다. 셋째로 오너 메일이 7번의 `(광고)` 형식으로 도착한 뒤에만 아래를 실행하고 결과 검수 후 반복합니다(기본 20명, 최대 200명).

```
node --experimental-strip-types scripts/referral-announce.ts --config <config> --released-at <T> --limit 20 --apply --confirm wd-buddy-invite-20261022
```

Notion `Referral announce`에 intent가 먼저 기록되고 접수 후 sent로 바뀝니다. 표시가 있는 주소는 다시 발송하지 않습니다. `heldUnresolved`는 결과 불명확 보류이므로 Notion/Resend에서 확인하며 표시를 지우지 않습니다. 자기 테스트는 별도 키이고 행을 표시하지 않으니 완료 후 반복하지 않습니다. Mac mini에서만 단독 실행하고, HTTP 실패로 남은 `.referral-announce.lock`은 서버 종료 및 영수증 확인 후에만 수동 해제합니다. 자세한 제한은 운영 문서의 공지 절차를 따릅니다.

## 9. 친구 참여 알림 켜기

8번이 끝난 뒤 Production `WATCHDIVE_REFERRAL_NOTICES_ENABLED=1` 로 하고 재배포합니다. 그 전에 켜지지 않았는지 환경 변수 화면에서 다시 봅니다.

## 10. 주간 검수 (매주, 읽기만)

```
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --help
node --experimental-strip-types --env-file=.env scripts/referral-report.ts --out report.json
```

`report.json` 에 `@` 가 없어야 합니다. `review_needed` 인 사람은 Notion에서 `Referral reward review` 를 `pending` 으로 두고 조사한 뒤 `approved` 또는 `rejected` 로 바꿉니다. 닉네임이 부적절하면 `Referral nickname hidden` 을 체크합니다.

## 하지 않는 것

- `launch-mail.ts --wave` 로 1시간·2시간 선공개를 대신하지 않습니다. 그 발송 도구는 아직 없습니다.
- 한국 실물 경품은 세무사가 영국 법인의 원천징수를 확인하기 전에 보내지 않습니다.
- 스위치를 끄려면 `WATCHDIVE_REFERRAL_PROGRAM_ENABLED` 와 알림 변수를 끄고, `/buddy-rules` 가 다시 404인지 확인합니다. 코드 커밋을 되돌리지 않습니다.
