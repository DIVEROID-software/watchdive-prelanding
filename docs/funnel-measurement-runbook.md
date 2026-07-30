# WatchDive 퍼널 측정·대시보드 운영 Runbook

## 목적과 범위

이 구현은 광고 노출부터 유효·검증 리드까지의 Website 및 Meta Instant Form 경로를 같은 기준으로 비교한다. 랜딩 페이지의 시각 디자인·카피·자산·레이아웃은 변경하지 않는다.

- 운영 대시보드: `/ops/funnel`
- Meta Lead Ads webhook: `/api/meta/leadgen`
- 이메일·전화 검증 결과 webhook: `/api/funnel/lead-status`
- 집계 시간대 및 광고 계정 시간대: `Asia/Seoul`
- 통화: `EUR`
- 개인정보 원본 저장소: 기존 Notion CRM
- 측정 저장소: Supabase의 익명 이벤트, 가명화된 리드 상태, Meta 집계치만 저장

## 활성화 순서

### 1. Supabase migration 적용

대상 파일:

```text
supabase/migrations/20260729090000_funnel_measurement.sql
supabase/migrations/20260729120000_meta_insights_refresh_ttl.sql
```

두 migration을 위 순서로 적용한 뒤 애플리케이션을 배포한다. 두 번째 migration은
기존 `reserve_meta_insights_sync`를 변경하지 않고
`reserve_meta_insights_sync_v2`를 추가한다. 따라서 rolling deployment 중 이전
애플리케이션은 기존 RPC 계약을 계속 사용하고, 새 애플리케이션만 v2를 사용한다.
새 애플리케이션을 migration보다 먼저 배포하면 v1으로 자동 fallback하지 않고
Meta 동기화를 fail-closed 처리한다. 이전 코드와 새 TTL 계약이 섞여 세대를
잘못 재사용하는 상황을 막기 위한 의도된 동작이다.

적용 후 다음 항목이 생성됐는지 확인한다.

- `funnel_events`
- `funnel_leads`
- `meta_daily_insights`
- `meta_range_insights`
- `meta_insights_sync_state`
- `signup_rate_limit_buckets`
- 대시보드 집계 RPC `get_funnel_dashboard_aggregate_v1`
- Meta 세대 예약 RPC `reserve_meta_insights_sync`,
  TTL 예약 RPC `reserve_meta_insights_sync_v2`, 실패 RPC `fail_meta_insights_sync`
- Meta 성과 원자 교체 RPC `replace_meta_insights_range`
- 가입 rate-limit RPC
- 모든 측정 테이블의 RLS 및 `service_role` 전용 권한

브라우저의 anon key로 위 테이블을 읽거나 쓸 수 없어야 한다.

이 migration은 세대 번호가 없던 기존 Meta 일별·기간 스냅샷을 삭제한다. 기존
성과는 재현 가능한 집계 데이터이므로 임의의 첫 세대로 추정하지 않는다. 적용 후
대시보드를 한 번 새로고침하면 선택 범위를 Graph에서 다시 채운다.

### 2. Vercel 서버 환경변수 설정

실제 값은 저장소, PR, 문서, 브라우저 번들에 넣지 않는다. Preview에서 먼저 설정·검증한 뒤 Production에 동일하게 적용한다.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FUNNEL_DASHBOARD_TOKEN
SIGNUP_RATE_LIMIT_HMAC_SECRET
SIGNUP_RATE_LIMIT_WINDOW_SECONDS
SIGNUP_RATE_LIMIT_MAX_ATTEMPTS

VITE_META_TRACKING_ENABLED
VITE_META_PIXEL_ID
META_PIXEL_ID
META_CAPI_ENABLED
META_CAPI_ACCESS_TOKEN

META_MARKETING_ACCESS_TOKEN
META_AD_ACCOUNT_ID
META_CAMPAIGN_IDS
META_WEBSITE_CAMPAIGN_IDS
META_INSTANT_FORM_CAMPAIGN_IDS

META_GRAPH_API_VERSION
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
META_PAGE_ACCESS_TOKEN
META_PAGE_ID
META_LEADGEN_FORM_IDS
META_LEADGEN_CAMPAIGN_IDS
META_ADSET_COUNTRY_MAP

LEAD_STATUS_WEBHOOK_SECRET
```

세대 예약·교체·실패 처리와 게재 위치 breakdown에는 새 환경변수가 필요하지 않다.
기존 Supabase service-role 및 Meta Insights 환경변수를 그대로 사용한다.

보안 규칙:

- `SUPABASE_SERVICE_ROLE_KEY`, Meta 토큰, webhook secret은 서버 전용이다.
- `FUNNEL_DASHBOARD_TOKEN`, `SIGNUP_RATE_LIMIT_HMAC_SECRET`, `LEAD_STATUS_WEBHOOK_SECRET`은 각각 독립적인 고엔트로피 값으로 만든다.
- Production에서는 가입 rate-limit 설정이 누락되면 요청을 통과시키지 않는다.
- Pixel ID와 CAPI dataset ID가 다르면 CAPI를 보내지 않는다.

Codex가 생성한 운영 토큰은 값 자체를 저장소나 로그에 남기지 않고 macOS
Keychain에도 보관한다. 운영 대시보드 토큰이 필요한 관리자는 로컬 터미널에서
다음 명령으로 Production 값을 직접 조회한다.

```bash
security find-generic-password -w \
  -s watchdive-FUNNEL_DASHBOARD_TOKEN \
  -a production
```

### 3. Meta Instant Form webhook 연결

Meta App의 Page webhook에 아래 callback을 등록한다.

```text
https://watchdive.diveroid.com/api/meta/leadgen
```

- Verify token: `META_WEBHOOK_VERIFY_TOKEN`
- 구독 필드: `leadgen`
- Page access token 권한: `leads_retrieval`, `pages_manage_metadata`
- Marketing API token 권한: `ads_read`
- `META_PAGE_ID`와 `META_LEADGEN_FORM_IDS` allowlist는 필수다.
- `META_LEADGEN_CAMPAIGN_IDS`를 설정하면 Graph에서 조회한 campaign도 한 번 더 제한한다.
- 해당 Page의 다른 양식 리드는 WatchDive CRM에 들어오면 안 된다.
- 배포 전에 `20260729090000_funnel_measurement.sql`,
  `20260729120000_meta_insights_refresh_ttl.sql`,
  `20260730130000_meta_lead_ingestion_state.sql`을 순서대로 적용한다.
- 마지막 migration의 Platform Lead ID 예약·완료 RPC가 동시 webhook에서 Notion
  생성자를 하나로 제한한다. 처리 중인 동일 리드에는 성공 응답을 보내지 않고
  Meta 재시도를 유지한다.

### 4. Website 광고 URL 파라미터

Website 광고는 다음 동적 파라미터를 최종 URL에 유지한다.

```text
utm_source={{site_source_name}}
utm_medium=paid_social
utm_campaign={{campaign.name}}
utm_content={{ad.name}}
campaign_id={{campaign.id}}
adset_id={{adset.id}}
ad_id={{ad.id}}
campaign_name={{campaign.name}}
adset_name={{adset.name}}
ad_name={{ad.name}}
site_source_name={{site_source_name}}
placement={{placement}}
```

Website와 Instant Form 캠페인은 각각 `META_WEBSITE_CAMPAIGN_IDS`, `META_INSTANT_FORM_CAMPAIGN_IDS`에 정확히 한 번만 포함해야 한다. 두 allowlist의 중복 또는 누락은 대시보드에서 범위 오류로 취급한다.

### 5. 검증 공급자 callback

이메일/SMS 검증 공급자는 다음 endpoint로 개인정보 없이 결과만 보낸다.

```text
POST https://watchdive.diveroid.com/api/funnel/lead-status
Authorization: Bearer <LEAD_STATUS_WEBHOOK_SECRET>
Content-Type: application/json
```

payload에는 측정 `leadId`와 검증 boolean만 포함한다. 이메일, 전화번호, IP, user-agent를 보내지 않는다.

## 측정 계약

### Website

```text
landing_view
→ cta_view
→ cta_click
→ form_view
→ form_start
→ form_submit_attempt
→ form_submit_success | form_submit_error
→ lead_validated
→ lead_verified
```

CTA view는 실제 50% 이상 노출, 영상 milestone은 실제 재생 진행률로 기록한다. 사전 동의 단계의 익명 세션은 메모리에만 유지한다.

### Meta Instant Form

```text
Meta form open
→ Meta form start
→ Meta form lead
→ instant_form_webhook
→ instant_form_crm_saved
→ lead_validated
→ lead_verified
```

Meta form lead는 CRM 저장·품질 판정 전까지 `valid lead`로 부르지 않는다.

### 핵심 KPI

- Paid valid-lead CPL = 동일 광고 account·campaign·날짜 범위 spend ÷ paid-attributed valid lead
- Verified phone CPL = 동일 범위 spend ÷ valid이면서 phone verified인 paid-attributed lead
- Website 단계 전환율 = 단계별 고유 익명 session 수 기준
- Instant Form 단계 전환율 = Meta 집계와 CRM 이벤트를 별도로 보존해 reconciliation
- Reach와 frequency = 선택한 전체 기간을 breakdown 없이 조회한 exact-range 값
- 일별 reach는 절대 합산하지 않는다.
- Source/Page breakdown은 Meta 지출과 같은 grain이 아니므로 CPL을 표시하지 않는다.
- Placement key = `conversion_location|publisher_platform/platform_position`
  (예: `website|instagram/reels`, `instant_form|instagram/stories`)
- Website placement는 URL attribution의 `placement`와 Meta breakdown이 같은 키일
  때만 valid-lead CPL을 계산한다.
- Instant Form placement는 Meta의 지출·노출·form lead를 Reels/Stories/Feed별로
  보여준다. CRM 리드에는 placement가 없으므로 placement valid-lead CPL은 `null`이다.

### Meta 동기화 세대 계약

1. 서버는 Graph를 호출하기 전에 Supabase에서 account 단위의 단조 증가
   `generation`과 DB 시각 `reserved_at`을 예약한다.
2. 예약 즉시 상태는 `syncing`이다. 서버 중단이나 timeout으로 이 상태가 남으면
   이전 paid snapshot을 정상 데이터로 노출하지 않는다.
3. 일별 행과 exact-range marker는 모두 같은 generation과 reserved time을 갖는다.
4. 한 transaction에서 전체 범위를 교체하고 현재 예약과 일치할 때만 상태를
   `ready`로 바꾼다. 처리된 실패는 같은 generation만 `failed`로 표시한다.
5. 대시보드 aggregate는 같은 SQL statement snapshot에서 예상 generation,
   현재 상태, 일별 행, exact-range marker를 함께 검증한다.
6. Meta가 0행을 반환해도 현재 generation의 exact marker가 있으면
   authoritative zero로 취급한다. marker가 없거나 상태가 `syncing`/`failed`면
   paid 데이터는 fail-closed다.
   단, 일별 전체 rowset이 비었는데 exact impressions·reach·frequency·spend·click이
   하나라도 0이 아니면 서로 다른 Graph 결과가 섞인 것으로 보고 commit을 거부한다.
7. 교체 직후 다른 replica가 새 generation을 예약해 aggregate와 불일치하면
   전체 동기화를 1초 뒤 한 번만 재시도하고, 다시 불일치하면 오류로 종료한다.
8. Supabase의 예약·교체·실패 RPC는 각각 10초 timeout으로 제한한다.
9. v2 예약 RPC는 동일 account·campaign·날짜 범위의 `ready` generation과
   exact-range marker가 모두 10분 이내일 때만 Meta Graph 호출을 생략한다.
   첫 번째 퍼널 이벤트·리드 집계는 화면의 60초 poll마다 다시 읽는다.
10. account generation은 하나이므로 5분 lease 안의 `syncing` 예약은 요청 날짜가
    달라도 새 예약을 차단한다. 기존 요청이 완료된 뒤 다음 poll에서 다른 범위를
    새로 예약한다.

## 개인정보·동의 규칙

- 명시적 폼 제출 전 Meta Pixel과 CAPI를 보내지 않는다.
- Global Privacy Control이 켜져 있으면 Meta 측정을 보내지 않는다.
- Pixel과 CAPI의 같은 전환은 같은 `event_id`를 사용한다.
- 이메일, 전화, raw IP, user-agent, canonical email은 측정 테이블과 대시보드에 저장·반환하지 않는다.
- raw IP는 가입 남용 방지와 CAPI 전송 중에만 일시적으로 사용한다.
- 가입 rate-limit에는 시간창별 keyed HMAC만 저장한다.
- 대시보드는 unlinked, `noindex`, token-protected이며 집계값만 반환한다.

## Preview 검증 체크리스트

1. 랜딩 페이지의 텍스트·자산·레이아웃·반응형 디자인이 현재 Production과 동일하다.
2. 동의 전 Network에 Meta Pixel/CAPI 호출이 없다.
3. 테스트 가입 한 건이 Notion CRM에 저장되고 Supabase에는 개인정보 없는 측정 행만 생긴다.
4. 동일 가입의 Browser Lead와 Server Lead가 같은 `event_id`로 들어오고 Events Manager에서 중복 제거된다.
5. Instant Form 테스트 리드가 allowlist를 통과해 `webhook → CRM → valid` 순서로 보인다.
6. `/ops/funnel`의 잘못된 token은 데이터를 반환하지 않는다.
7. Website/Instant campaign 범위가 뒤바뀐 데이터는 health 경고로 나타나며 CPL 분모에 들어가지 않는다.
8. Meta 동기화 실패 시 이전 수치를 정상 수치처럼 표시하지 않는다.
9. 선택 기간 exact reach/frequency가 일별 합산값이 아닌지 확인한다.
10. 동일 가입/검증 webhook을 재시도해도 verified 상태가 되돌아가지 않고 중복 이벤트가 늘지 않는다.
11. `meta_insights_sync_state`가 선택 범위와 campaign scope에서 `ready`이고, 일별 행과
    exact marker의 generation이 동일하다.
12. Graph가 빈 범위를 반환하는 테스트에서 일별 행은 0개지만 exact marker가 남고
    대시보드 paid 지표가 0으로 표시된다.
13. 게재 위치 탭에서 Website/Instant Form이 분리되고 Instagram
    Reels·Stories·Feed의 지출·리드가 각각 보인다. Instant Form placement CPL은
    CRM placement가 없을 때 계산되지 않는다.

## Production 배포 후 확인

- `https://watchdive.diveroid.com`이 새 Production deployment를 가리키고 HTTP 200이다.
- Pixel dataset ID는 `1028181916616055`와 일치한다.
- Meta Events Manager에서 Website Browser+Server 수신 및 deduplication을 확인한다.
- Instant Form webhook subscription 상태와 실제 테스트 리드 한 건을 확인한다.
- 대시보드에서 Storage, Meta Insights, Meta scope, Verification webhook이 모두 `ready`다.
- 새로운 실제 리드의 Notion 수와 valid lead 수 차이를 확인하되 원인을 추정하지 않는다.

## 운영 원칙

- 리드 원본과 집계값이 다르면 자동으로 맞춰 보이게 하지 말고 reconciliation 차이를 노출한다.
- 오류나 부분 집계에서는 CPL을 계산하지 않는다.
- Meta Insights 범위 교체는 한 transaction으로 완료돼야 한다.
- `syncing` 또는 `failed` generation에서 이전 paid snapshot을 수동으로 정상 처리하지 않는다.
- Instant Form placement Meta lead는 CRM과 연결되기 전 `valid lead`로 재명명하지 않는다.
- 예산·타겟·소재 의사결정은 최소한 유효 리드와 전환 위치가 reconciliation된 뒤 한다.
- 연락처 30만 건 규모에서 Notion 직수집이 병목이 되면 별도 승인된 암호화 CRM/queue로 이관한다. 측정 DB에 원본 연락처를 추가하지 않는다.
