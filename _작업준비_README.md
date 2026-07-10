# 🛠️ Watch Dive Pre-Landing — 작업 준비 (2026-07-06 갱신)

> ⚠️ **정본 PRD = `PRD.md`** (2026-07-06, 라이브 반영 최종). 이 문서는 초기 작업노트로, 일부 내용(구 헤드라인·게이미피케이션 미구현 표기 등)이 outdated. 현재 스펙은 PRD.md 참조.

> **✅ 7/6 포팅 완료 — Tu 불필요 확정**: 라이브(divewatch-dream-page.lovable.app)를 통째로 수확
> (`_tu_live_reference_20260706/` — 렌더 DOM·카피·에셋 17개 38MB·스크린샷)한 뒤 이 소스에 포팅.
> **텍스트 diff 0 · Lovable CDN 의존 0 (이미지 전부 `src/assets/live/` 로컬) · Lovable 배지 자동 소멸.**
> 실행: `npm run dev` → localhost:8080 (루피 확인 완료 7/6).
>
> **7/6 추가 반영**: ①NVIDIA "Backed by"→"Member of" ②**Supabase 완전 제거 → Notion 직수집 (E2E 검증 완료 ✅)**
>
> - 서버함수 `src/lib/api/waitlist.functions.ts` (중복이메일 dedupe 포함). `.env`에 `NOTION_API_KEY`(통합 "Watch Dive Prelanding") + `NOTION_WAITLIST_DB_ID` 세팅됨(로컬).
> - 수집 DB = Notion "Watch Dive Kickstarter — Pre-Landing Waitlist" (`af59cbb8116d4a4c99190ace8f3d15aa`, User Feedback 페이지 하위). 스키마 Email(title)·Phone·Source(hero/offer)·Signed up·Notes.
> - ⚠️ **Lovable Supabase 미들웨어 제거 필수였음**: `src/start.ts`의 `functionMiddleware:[attachSupabaseAuth]` 전역 미들웨어가 모든 서버함수를 가로채 Supabase env 없으면 throw → 제거함(공개폼=인증불필요). `src/integrations/supabase/*`는 잔존하나 미사용(import 끊음). validator API도 최신화(inputValidator→validator).
> - E2E: Playwright로 히어로/오퍼 폼 제출 → Notion 기록 확인(유입경로·전화 정상) → 테스트데이터 삭제 완료.
> - 🔜 **배포 시(Vercel)**: `NOTION_API_KEY`·`NOTION_WAITLIST_DB_ID`를 Vercel 프로젝트 env에 등록 필요(로컬 .env는 배포 안 됨).

---

## ✅ 현재 상태 (7/6 기준)

- **이 폴더 소스 = 정본, 라이브와 100% 동기화 완료.** 라이브(divewatch-dream-page.lovable.app, Tu 계정)는 이제 참고용일 뿐 — 우리가 독립.
- **스택**: TanStack Start + Vite + React + TS + shadcn(Radix) + Tailwind. (Supabase = 코드에서 제거됨, `src/integrations/supabase/*`는 미사용 잔존물)
- **빌드 검증됨** ✅: `npm run build` 정상. node v22/npm.
- **이메일 수집 = Notion 직수집** ✅ E2E 검증 완료 (위 참조).

## ▶️ 시작 명령어

```bash
cd ~/Desktop/Projects/watchdive-prelanding
npm run dev        # 로컬 개발 서버
npm run build      # 프로덕션 빌드 (dist/)
```

## 📊 7/4 QA 결과 — 6/29 발송 11개 대조 (라이브 기준)

| #   | 항목                               | 결과                                                                |
| --- | ---------------------------------- | ------------------------------------------------------------------- |
| 1   | $1 Stripe 삭제                     | ✅ 완전 삭제 (결제링크 0)                                           |
| 2   | 게이미피케이션 (공유→$5쿠폰)       | ❌ **미구현 — 백로그 1순위** (Jay 지시)                             |
| 3   | 히어로 워치화면 Figma 정답         | ✅ 실사진+정답UI (Depth 24.1/Dive Time 32'/NDL 21'/Heading 20°)     |
| 4   | 헤드라인 No-Deco                   | ✅ "Depth. Safety. No-Deco." (Hype 전멸)                            |
| 5   | Lovable 배지 제거                  | ❌ **잔존 — 백로그** (Lovable Settings→Hide badge 또는 코드 제거)   |
| 6   | 내부 마케팅용어 삭제               | ✅                                                                  |
| 7   | 호환 방식별 카드 2개               | ✅ "App Only / Housing + App" 정확 구현                             |
| 8   | 빈 이미지박스                      | ✅ 깨진 이미지 0                                                    |
| 9   | 액션캠 GoPro·Insta360만            | ✅                                                                  |
| 10  | NVIDIA 공식배지+AWS 제거+삼성 문구 | 🟡 NVIDIA·AWS ✅ / 삼성 "As featured" 문구는 누락(삼성 통째 삭제됨) |
| 11  | 앱 다운로드 문구 제거              | ✅ (전화 = optional VIP 링크 분리수집 유지)                         |

## 📋 남은 작업 백로그 (루피+정은이 직접)

- [x] ~~Supabase 소유권/이관~~ → **Notion 직수집으로 대체 완료(7/6)**
- [x] ~~Lovable 배지 제거~~ → **포팅으로 자동 소멸(7/6)**
- [x] ~~"BACKED BY"→"Member of"~~ → **완료(7/6)**
- [x] ~~게이미피케이션~~ → **완료(7/6)**: 가입 성공 시 개인 공유링크(`/?ref=<code>`) 발급 + "Get $5 off for every friend who joins" 카드(navigator.share/클립보드 복사). Notion에 `Ref code`(본인코드)·`Referred by`(초대한코드) 칸 추가. E2E 검증(친구가 ref링크로 가입→Referred by 기록 확인). **$5 정산=Notion에서 "Referred by"별 카운트로 수동/KS런칭시** (라이브 카운트 표시는 안 함=정직). ⚠️쿠폰 실제 발급/상한 정책은 KS 단계에서 확정.
- [x] ~~삼성 문구~~ → **완료(7/6)**: Credentials 섹션 신설(NvidiaInception→Credentials 3종). NVIDIA 공식배지 + "Powered by AWS"(인프라 사실) + "As featured by Samsung"(삼성 광고 등장 사실, 로고 없이 텍스트). 헤더 "Built by a proven team".
- [x] ~~KS 카운트다운 "JULY 15"~~ → **완료(7/6): 제거. 7/15는 실일정 아님(루피 확인), KS 페이지도 미완성. "Launching soon on Kickstarter" 상시배너로 교체**(CountdownBanner→LaunchBanner, useCountdown/KICKSTARTER_LAUNCH 삭제). 실제 KS 확정일 나오면 카운트다운 부활 가능.
- [ ] 삼성 "As featured by Samsung" 추가 여부 — 루피 결정 (근거: asset_samsung_ad_sponsorship)
- [ ] 루피의 추가 수정사항 ("아직 수정할 것 많다")
- [ ] 다국어: 한·영·번체(zh-TW)
- [ ] 배포: Vercel + 도메인 → 배포 전 Vercel env에 NOTION_API_KEY·NOTION_WAITLIST_DB_ID 등록 + 폼동작·모바일 재검증

## ✅ 워치 화면 정답 용어 (Figma)

`Depth, m` / `Dive Time 2'`(분) / `Temp 23°C` / `NDL 99'`(무감압=NDL) / `Heading 128°`(나침반)
2뷰 = default(Depth/DiveTime/Temp/NDL) + compass(Depth/DiveTime/NDL/Heading)
⚠️ AI가 만든 SURFACE/NO DECOR/MAX DEPTH/WATCHDIVE = 가짜, 쓰지 말 것

## 🎯 헤드라인·포지셔닝 (확정, 라이브 반영됨)

- H1: "Turn your Apple or Galaxy Watch into a 60 m dive computer. Early bird from $149 on Kickstarter."
- 프로미스 카드: "Depth. Safety. No-Deco." + $149(50% off $299)
- 타겟 = Scuba + Freediving 둘 다 (영구 확정)

## 📦 실촬 자산 (Dropbox)

`04_Growth & Ops/prelanding-campaign/Watch Dive/` — Main 33초 + ShortClip3 + Shorts4 + GIF6 + 사진 RAW/편집본
→ 제품/워치 화면은 AI 금지, 이 실촬·Figma export 사용

## 🔁 QA 재실행 (재사용)

Playwright 자동 QA 스크립트로 언제든 재검사 가능 — 정은이에게 "프리랜딩 QA 다시 돌려줘".
(11개 항목 텍스트/DOM 검사 + 데스크탑 스윕 12장 + 모바일 풀샷)

---

**다음 세션 시작점**: Tu 최신 소스 수령 → 이 폴더 교체 → 백로그 1번(게이미피케이션)부터.
