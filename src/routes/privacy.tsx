import { createFileRoute, Link } from "@tanstack/react-router";

import { EN_FROZEN_LANDING_MESSAGES } from "@/lib/i18n/frozen-landing-en";
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
