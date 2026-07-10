# 📄 Watch Dive — Kickstarter Pre‑Landing PRD (최종)

> **버전 1.0 · 2026‑07‑06 · 상태: 🟢 LIVE**
> 작성/관리: 정은이(오케스트레이터) · 오너: 루피(Rupy) · 발표/의사결정: Jay(김정일)
> 이 문서 = 프리랜딩 페이지의 단일 정본(SSOT). 라이브 반영분 100% 기준.

---

## 1. 개요 & 목표

- **제품**: Watch Dive — 스마트워치(Apple Watch / Galaxy Watch)를 **60 m 다이빙 컴퓨터**로 바꿔주는 방수 하우징 + 센서 + 전용 앱(DIVEROID App 3.0).
- **이 페이지의 목적**: 킥스타터 런칭 전 **대기자(리드) 확보 + 바이럴 확산**.
  1. 이메일(+선택 전화) 수집 → 런칭 시 "가장 먼저" 알림
  2. 게이미피케이션(추천)으로 자발적 공유 유도
- **성공 지표(KPI)**: 대기자 수 / 추천을 통한 유입 비율(바이럴 계수) / 전화(VIP) 수집률.

## 2. 핵심 메시지 & 포지셔닝 (Jay 확정)

- **핵심 한 줄**: **"The most affordable dive computer solution."** (세상에서 가장 저렴한 다이빙 컴퓨터 솔루션)
  - 공유 카드(OG) 문구: **"Watch Dive — The world's most affordable dive computer"**
- **가입 이유(Reason to sign up)**: 원래 **$299** → 킥스타터 **초기 30명 한정 50% = $149**. 가입하면 **가장 먼저 알림 + 최저가 확보.**
- **헤드라인(H1)**: "Turn your Apple or Galaxy Watch into a **60 m dive computer**. Early bird from **$149** on Kickstarter."
- **타겟**: 입문·레크리에이션 다이버 (**Scuba + Freediving 둘 다**). 고가 전문 다이브컴퓨터($800~1,200) 앞에서 멈춘 입문자 시장.
- **언어**: **영어 ONLY** (다국어 계획 폐기 — 루피 7/6 확정).
- ⚠️ **경쟁사 실명 금지**(카피 텍스트). "타사/시중의 전문 다이브컴퓨터"로.

## 3. URL & 배포

| 항목                  | 값                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **라이브 URL (정식)** | **🟢 https://watchdive.diveroid.com** (커스텀 도메인, SSL 완료·OG 갱신됨)                                     |
| 백업 URL              | https://watchdive-prelanding.vercel.app (Vercel 기본, 계속 작동)                                              |
| 도메인 셋업           | Hostinger DNS `CNAME watchdive → cname.vercel-dns.com` 완료(루피 7/6) → Vercel 자동 SSL ✅                    |
| 호스팅                | Vercel (프로젝트 `ilpatto-9874s-projects/watchdive-prelanding`)                                               |
| 재배포                | `vercel --prod --token=<WDprelanding 토큰>` (또는 루피 `! vercel --prod`)                                     |
| ⚠️ 빌드 함정          | Lovable config가 nitro를 cloudflare로 강제 → 404. `vite.config.ts`에 `nitro:{preset:"vercel"}`로 해결(적용됨) |

## 4. 페이지 구조 (섹션 순서 = 라이브 기준)

1. **Sticky CTA**(우하단 상시) + **상단 배너**: "Launching soon on Kickstarter" / "First 30 backers · 50% off"
2. **Hero**: H1 + 핵심 메시지 + **가격 앵커 배지**(~~$299~~ **$149** 50% OFF · first 30 backers) + 이메일/전화 폼 + 스탯 타일(60 m / Scuba+Freedive / $149) + 수중 워치 프로미스 카드("Depth. Safety. No‑Deco.")
3. **ValueSection**(Why Watch Dive): 4카드 **아이콘+설명**(Use what you own / Premium build / Real dive value / Shareable dives)
4. **FunctionsSection**: 기능 설명(Ascent‑Rate Alert / No‑Deco·NDL / Depth·Time·Temp / Scuba+Freedive) + GIF
5. **HowItWorks**: 3스텝(워치 넣기 → 실시간 가이드 → 다이브 로그 싱크), 이미지 하단정렬
6. **AppEcosystem (DIVEROID App 3.0)**: 하이라이트 타일 3개(Auto/Sites/Share) + **3카드 가로 스와이프 캐러셀**(01 Auto logbook & gallery · 02 Dive sites near you · 03 Share with dive data). 데스크탑 3장 고정, 모바일 스와이프
7. **Compatibility**: 자체호스팅 영상 + 방식별 2카드(**App Only**=워치 내장센서·Apple Watch Ultra / **Housing + App**=하우징 센서·전 Apple/Galaxy/Pixel/Wear OS) — 각 참고사진(모바일서도 표시)
8. **ActionCameras**: "Pairs with your action camera" — GoPro · Insta360 · Canon · & more + AUTO LOGBOOK GIF
9. **OfferSection**(#offer-form): 킥스타터 배너 + ~~$299~~ **$149 — 50% off** + "first to know…first 30 backers…before it goes to $299" + 이메일/전화 폼
10. **Credentials**("Built by a proven team"): NVIDIA Inception 배지 / Powered by AWS(로고) / As featured by **SAMSUNG**(삼성 광고 속 우리 제품 실사진). 브랜드 컬러 액센트바
11. **FAQ** + **Footer**(Privacy/Terms)

## 5. 핵심 기능

### 5.1 리드 수집 (이메일 + 전화)

- **이메일**: 필수. **전화**: 선택(항상 노출, "Phone for VIP launch alert (optional)"). 히어로·Offer 폼 둘 다.
- 제출 → 서버함수 `joinWaitlist`(`src/lib/api/waitlist.functions.ts`) → **Notion 직수집**. 중복 이메일 dedupe(성공 처리, 기존 코드 반환).
- 유입경로(`Source` = hero/offer) 자동 기록.

### 5.2 게이미피케이션 (추천 — Jay 요구) ✅ 라이브 검증됨

- 가입 성공 → 개인 **공유 링크 `/?ref=<본인코드>`** + **"Get $5 off for every friend who joins"** 카드(navigator.share / 클립보드 복사).
- 친구가 그 링크로 가입 → 친구 행 **`Referred by` = 본인코드** 기록. → `Referred by`별 카운트 = 추천 수.
- **할인 = $5 × 추천 수(누적·무제한).**
- ⚠️ **현 단계 = 집계만.** 실제 $5 쿠폰 발급은 **킥스타터 런칭 시점**에 (이메일↔추천수 매칭 → 펀딩가 조정/쿠폰코드). **쿠폰 실발급·상한 정책은 KS 단계에서 Jay와 확정.**

### 5.3 데이터 (Notion)

- DB: **"Watch Dive Kickstarter — Pre‑Landing Waitlist"** (`af59cbb8116d4a4c99190ace8f3d15aa`, User Feedback 페이지 하위 · Season 2 Early Access와 별개).
- 스키마: `Email`(title) · `Phone` · `Source`(select: hero/offer) · `Signed up`(date) · `Ref code` · `Referred by` · `Notes`.
- 토큰: `NOTION_API_KEY`(통합 "Watch Dive Prelanding") — **서버 전용, 브라우저 미노출.**

## 6. 기술 & 자산

- **스택**: TanStack Start + Vite + React + TypeScript + shadcn(Radix) + Tailwind. (Supabase 제거됨)
- **환경변수**(Vercel Production+Preview): `NOTION_API_KEY`, `NOTION_WAITLIST_DB_ID`.
- **디자인**: 딥 바이올렛(#120e34/#3d2683) + 시안 액센트(#36a9e1/#4fe0e6). 폰트 Work Sans.
- **공유 카드(OG)**: `public/og-image.png` (1200×630 — 제품 수중샷 + "The world's most affordable dive computer" + ~~$299~~ $149). `twitter:card=summary_large_image`. ⚠️소셜 캐시=새 공유 또는 `?v=` 파라미터로 갱신.
- **실촬 자산**: 제품/워치 화면은 **AI 재생성 금지** — 실촬(Dropbox `04_Growth & Ops/prelanding-campaign/Watch Dive/`) + Figma export 사용.
- **워치 UI 정답 용어**: Depth,m / Dive Time / Temp / NDL(무감압) / Heading(나침반). ⚠️SURFACE/NO DECOR/MAX DEPTH = 가짜.

## 7. 미해결 / 다음 단계 (Open items)

- [x] ~~커스텀 도메인 연결~~ → **완료 7/6: 🟢 https://watchdive.diveroid.com 라이브(SSL·OG 갱신)**
- [ ] **모바일 최종 점검**(전 섹션 스윕)
- [ ] **$5 쿠폰 정산 정책 확정**(KS 단계, Jay) — 발급 방식·상한
- [ ] **가격 정본 통일**: 본 프리랜딩=$299/$149(Jay 확정). 다른 메모(product_watch_dive)엔 $189 기재 → 정본 재조정 필요
- [ ] 삼성 카드 광고 실사진 = 반영 완료. (추가 협찬 근거 필요시 asset_samsung_ad_sponsorship)
- [ ] 테스트 리드 정리(런칭 전) — 현재 테스트 4건 보류 중
- [ ] 광고 집행(Jay 알고리즘) → 이 URL로

## 8. 변경 이력 (요약)

- **7/6**: Tu 완전 독립(라이브 포팅) · Supabase→Notion 직수집 · 게이미피케이션 구현·검증 · Credentials 3종 · App 3.0 캐러셀 · **Jay 가격 메시지($299→$149·초기30명) 반영** · ValueSection 아이콘 · 전화 항상노출 · **Vercel 라이브 배포** · 커스텀 도메인 watchdive.diveroid.com · OG 공유카드 · 영어 ONLY 확정.
- **7/6 (3-AI 피드백 반영)**: GIF→MP4(24MB→0.8MB·모바일) · **안전/신뢰 블록 신설**(면책 포함) · **양방향 추천(give $5, get $5)**+?ref 배너·localStorage 지속·"invite 30=free" · 히어로 신뢰 로고스트립 · 전화 이유 강화.
- **7/6 밤 (아이콘·카운터·게이미피케이션 노출)**: 전 섹션 아이콘 투입(스탯타일·기능·App3·ValueSection) · 신뢰스트립 로고칩화 · **게이미피케이션 가입前 티저** · **추천 진행 카운터**(성공카드 진행바) · **대기자 사회적증거 카운터**(≥25 자동표시).
- **7/6 밤 2부 (Jay 공유 직전 최종)**: ⭐**히어로 슬로건 승격** — H1 최대타이틀=**"The world's most affordable dive computer"**(most affordable 시안) → 2번째 메커니즘("Turn your watch into a 60m dive computer") → 3번째 가격. · App3 캐러셀 **Auto→Share→Sites 재정렬**(탭·소개문구·번호 전부) · App3 이미지 교체(Auto=로그#100 상세, Share=신규) + **이미지내 텍스트 PIL 편집**(Gangseo-gu→Seogwipo-si, Diving Time 38→42min·Capture 38→12m Auto와 정합, 유닛 폰트=원본 보존) · 모바일 히어로 워치이미지 상단배치(order-first) · 트러스트스트립 그룹화 · 🎁 이모지 높이정렬 · **🧹 코드 클린업**(Lovable/Supabase dead files 삭제, .vercel/output 완전 클린, 콘솔에러0).
- **7/6 밤 (최종 폴리시·Gemini/멀티AI 피드백)**: 스탯타일 아이콘/정렬(수심화살표·고글·태그) · **모바일 히어로 밸런스**(스탯타일 컴팩트 가로행·서브카피 2줄 단축) · App3 캡션 아이콘 하단 이동 · **"Launch hook" 개발라벨 제거** + "Recreational depth 40 m" 카드 삭제 · **공유버튼 "Share & get yours free"** · **App3 캐러셀 상단탭 active 싱크 수정**(center-based scroll, 탭클릭 이동) · 기능영상 크롭 미적용(레터박스 아님·온영상 라벨 보호) · 창업자 스토리 미채택(KS 본페이지용). ⚠️ **외부AI QA는 반드시 `watchdive.diveroid.com` 지정**(Lovable URL=옛 초기본, 캐시 오탐 주의).

## 9. 🔜 다음 우선순위 (3-AI 공통 권고 — Rupy 결정/자산 필요)

1. ~~실시간 대기자 카운터~~ → **구현 완료(7/6밤)**: 히어로 `WaitlistCounter`("N divers on the waitlist")=**count≥25일때 자동표시**(늘어나는 방식·60s캐시). + 성공카드 **추천 진행 카운터**("N joined·$N off·X to free"+진행바). ⚠️"줄어드는 X석 남음"은 미채택(대기자>30시 "0석"→가입급감 함정). 원하면 "주간 얼리버드 X석" 리셋방식 가능.
2. **창업자/팀 스토리** "Built by divers, for divers" + 창업자 사진 1장 (킥스타터는 사람에 펀딩). → 자산 필요.
3. **KS "Notify me" CTA 병행** (런칭 랭킹 직결) → KS 프리런치 페이지 생기면 즉시.
4. **다이버 신뢰**(PADI/SSI 또는 베타 후기 1~2줄) → 콘텐츠 필요.
5. **추천 마일스톤 티어**(3명→스트랩·10명→무료) — KS단계 $정책 Jay 확정 후.
6. **모바일 H1 단축**(폼 폴드 안으로) · **Sticky CTA 폼 겹침 숨김** · **가격 정본 $189 vs $299 통일**.

---

*상세 작업 로그·함정 기록은 메모리 `project_tu_prelanding.md` 참조. 옛 작업노트=`*작업준비*README.md`(일부 outdated).*
