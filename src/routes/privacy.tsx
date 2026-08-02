import { createFileRoute, Link } from "@tanstack/react-router";

import { EN_FROZEN_LANDING_MESSAGES } from "@/lib/i18n/frozen-landing-en";
import { LAUNCHOS_BROWSER_MEASUREMENT_ENABLED } from "@/lib/funnelContext";
import { homePath } from "@/lib/i18n/locale";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: EN_FROZEN_LANDING_MESSAGES.privacy.metaTitle },
      {
        name: "description",
        content: EN_FROZEN_LANDING_MESSAGES.privacy.metaDescription,
      },
    ],
  }),
  component: PrivacyPage,
});

export function PrivacyPage() {
  const locale = useCurrentLocale();
  const copy = useFrozenLandingMessages().privacy;
  const company = splitLabel(copy.s1Company);
  const representative = splitLabel(copy.s1Rep);
  const address = splitLabel(copy.s1Addr);
  const registration = splitLabel(copy.s1Reg);
  const privacyContact = splitLabel(copy.s1Contact);
  const email = splitLead(copy.s2Email);
  const phone = splitLead(copy.s2Phone);
  const security = splitLead(copy.s2Security);
  const usage = splitLead(copy.s2Usage);
  const rightsContact = splitAroundEmail(copy.s7Outro);
  const contact = splitAroundEmail(copy.s10Body);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <Link
          to={homePath(locale)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {copy.back}
        </Link>
        <h1 className="mt-6 text-4xl font-bold sm:text-5xl">{copy.h1}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          <strong>{copy.effectiveLabel}</strong> {copy.effectiveDate}
        </p>

        <div className="mt-10 space-y-6 text-base leading-relaxed text-foreground/90">
          <p>{copy.intro1}</p>
          <p>{copy.intro2}</p>

          <Section title={copy.s1Title}>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>{company[0]}</strong>
                {company[1]}
              </li>
              <li>
                <strong>{representative[0]}</strong>
                {representative[1]}
              </li>
              <li>
                <strong>{address[0]}</strong>
                {address[1]}
              </li>
              <li>
                <strong>{registration[0]}</strong>
                {registration[1]}
              </li>
              <li>
                <strong>{privacyContact[0]}</strong>
                {privacyContact[1]}
              </li>
            </ul>
          </Section>

          <Section title={copy.s2Title}>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>{email[0]}</strong>
                {email[1]}
              </li>
              <li>
                <strong>{phone[0]}</strong>
                {phone[1]}
              </li>
              <li>
                <strong>{security[0]}</strong>
                {security[1]}
              </li>
              <li>
                <strong>{usage[0]}</strong>
                {usage[1]}
              </li>
            </ul>
            <p>{copy.s2NoPayment}</p>
          </Section>

          <Section title={copy.s3Title}>
            <p>{copy.s3Intro}</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>{copy.s3Item1}</li>
              <li>{copy.s3Item2}</li>
              <li>{copy.s3Item3}</li>
              <li>{copy.s3Item4}</li>
              <li>{copy.s3Item5}</li>
            </ul>
            <p>{copy.s3Outro}</p>
          </Section>

          {LAUNCHOS_BROWSER_MEASUREMENT_ENABLED && (locale === "en" || locale === "ko") && (
            <LaunchOsMeasurementNotice korean={locale === "ko"} />
          )}

          <Section title={copy.s4Title}>
            <p>{copy.s4Body}</p>
          </Section>

          <Section title={copy.s5Title}>
            <p>{copy.s5Body}</p>
          </Section>

          <Section title={copy.s6Title}>
            <p>{copy.s6Body}</p>
          </Section>

          <Section title={copy.s7Title}>
            <p>{copy.s7Intro}</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>{copy.s7Item1}</li>
              <li>{copy.s7Item2}</li>
              <li>{copy.s7Item3}</li>
              <li>{copy.s7Item4}</li>
            </ul>
            <p>
              {rightsContact[0]}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:help@diveroid.com"
              >
                help@diveroid.com
              </a>
              {rightsContact[1]}
            </p>
          </Section>

          <Section title={copy.s8Title}>
            <p>{copy.s8Body}</p>
          </Section>

          <Section title={copy.s9Title}>
            <p>{copy.s9Body}</p>
          </Section>

          <Section title={copy.s10Title}>
            <p>
              {contact[0]}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:help@diveroid.com"
              >
                help@diveroid.com
              </a>
              {contact[1]}
            </p>
          </Section>

          <hr className="border-border" />
          <p className="text-sm italic text-muted-foreground">{copy.footerLine}</p>
        </div>
      </article>
    </div>
  );
}

function LaunchOsMeasurementNotice({ korean }: { korean: boolean }) {
  return (
    <Section title={korean ? "선택적 광고 성과 측정" : "Optional advertising measurement"}>
      <p>
        {korean
          ? "허용을 선택한 경우에만 가명(무작위) 방문 ID와 승인된 Meta 캠페인·광고세트·광고 ID를 사용해 광고 노출 이후의 웹사이트 가입 퍼널을 측정합니다. 이메일·전화번호·IP 주소·사용자 에이전트는 LaunchOS 이벤트에 포함하지 않습니다."
          : "Only after you choose Allow, we use a pseudonymous random visit ID and approved Meta campaign, ad set and ad IDs to measure the website signup funnel after an ad interaction. LaunchOS events do not include email, phone number, IP address or user agent."}
      </p>
      <p>
        {korean
          ? "거부하면 이후 측정을 중단하고 이 브라우저의 측정 세션을 지운 뒤, 기존 LaunchOS 기록의 집계 제외와 삭제 처리를 요청합니다. 화면에 ‘집계 제외·삭제 대기’가 표시되면 집계 제외는 접수됐지만 물리 삭제는 아직 끝나지 않은 상태입니다. 전송 실패는 대기 요청으로 남으며, 다른 원천 시스템의 삭제는 help@diveroid.com으로 별도 요청할 수 있습니다."
          : "Declining stops future measurement, clears this browser's measurement session, and requests exclusion and deletion processing for prior LaunchOS records. An ‘excluded, deletion pending’ status means exclusion was accepted but physical deletion is not yet complete. Failed delivery remains pending for retry; deletion from other source systems can be requested separately at help@diveroid.com."}
      </p>
      <p>
        {korean
          ? "이 가명 측정 기록은 Watch Dive 런칭 캠페인 종료 또는 삭제 요청 중 먼저 도래하는 시점까지만 보유하며, 어떤 경우에도 수집일로부터 400일을 넘기지 않습니다."
          : "We retain these pseudonymous measurement records only until the Watch Dive launch campaign ends or you request deletion, whichever comes first, and never for more than 400 days from collection."}
      </p>
    </Section>
  );
}

function splitLabel(value: string): readonly [string, string] {
  const delimiterIndex = value.search(/[:：]/);
  if (delimiterIndex < 0) return [value, ""];
  return [value.slice(0, delimiterIndex + 1), value.slice(delimiterIndex + 1)];
}

function splitLead(value: string): readonly [string, string] {
  const markerIndexes = [value.indexOf(" ("), value.indexOf("（"), value.indexOf(" —")].filter(
    (index) => index >= 0,
  );
  if (markerIndexes.length === 0) return [value, ""];
  const markerIndex = Math.min(...markerIndexes);
  return [value.slice(0, markerIndex), value.slice(markerIndex)];
}

function splitAroundEmail(value: string): readonly [string, string] {
  const email = "help@diveroid.com";
  const emailIndex = value.indexOf(email);
  if (emailIndex < 0) return [value, ""];
  return [value.slice(0, emailIndex), value.slice(emailIndex + email.length)];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
      {children}
    </section>
  );
}
