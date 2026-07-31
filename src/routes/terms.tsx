import { createFileRoute, Link } from "@tanstack/react-router";

import { EN_FROZEN_LANDING_MESSAGES } from "@/lib/i18n/frozen-landing-en";
import { homePath, privacyPath } from "@/lib/i18n/locale";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: EN_FROZEN_LANDING_MESSAGES.terms.metaTitle },
      {
        name: "description",
        content: EN_FROZEN_LANDING_MESSAGES.terms.metaDescription,
      },
    ],
  }),
  component: TermsPage,
});

export function TermsPage() {
  const locale = useCurrentLocale();
  const copy = useFrozenLandingMessages().terms;
  const storeDisclaimer = splitSecondSentence(copy.s1Body);
  const changeDisclaimer = splitChangeDisclaimer(copy.s2Body);
  const privacyReference = splitAround(copy.s3Body, copy.s3PrivacyLink);
  const contact = splitAround(copy.s7Body, "help@diveroid.com");

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

        <div className="prose-content mt-10 space-y-6 text-base leading-relaxed text-foreground/90">
          <p>{copy.intro}</p>

          <Section title={copy.s1Title}>
            <p>
              {storeDisclaimer[0]}
              <strong>{storeDisclaimer[1]}</strong>
              {storeDisclaimer[2]}
            </p>
          </Section>

          <Section title={copy.s2Title}>
            <p>
              {changeDisclaimer[0]}
              <strong>{changeDisclaimer[1]}</strong>
              {changeDisclaimer[2]}
            </p>
          </Section>

          <Section title={copy.s3Title}>
            <p>
              {privacyReference[0]}
              <Link to={privacyPath(locale)} className="text-primary underline underline-offset-4">
                {copy.s3PrivacyLink}
              </Link>
              {privacyReference[2]}
            </p>
          </Section>

          <Section title={copy.s4Title}>
            <p>{copy.s4Body}</p>
          </Section>

          <Section title={copy.s5Title}>
            <p>{copy.s5Body1}</p>
            <p>{copy.s5Body2}</p>
          </Section>

          <Section title={copy.s6Title}>
            <p>{copy.s6Body}</p>
          </Section>

          <Section title={copy.s7Title}>
            <p>
              {contact[0]}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:help@diveroid.com"
              >
                help@diveroid.com
              </a>
              {contact[2]}
            </p>
          </Section>

          <hr className="border-border" />
          <p className="text-sm italic text-muted-foreground">{copy.footerLine}</p>
        </div>
      </article>
    </div>
  );
}

function splitSecondSentence(value: string): readonly [string, string, string] {
  const sentencePattern = /[.!?。！？](?:\s+|$)/g;
  const first = sentencePattern.exec(value);
  const second = sentencePattern.exec(value);
  if (!first || !second) return ["", value, ""];
  const secondStart = first.index + first[0].length;
  const secondEnd = second.index + 1;
  return [value.slice(0, secondStart), value.slice(secondStart, secondEnd), value.slice(secondEnd)];
}

const CHANGE_DISCLAIMERS = [
  "may change",
  "변경될 수 있습니다",
  "可能在 Kickstarter 众筹之前或期间发生变更",
  "可能在 Kickstarter 募資之前或期間變更",
  "変更される可能性があります",
  "pueden cambiar",
  "peuvent changer",
  "können sich vor oder während der Kickstarter-Kampagne ändern",
  "podem mudar",
] as const;

function splitChangeDisclaimer(value: string): readonly [string, string, string] {
  const highlight = CHANGE_DISCLAIMERS.find((candidate) => value.includes(candidate));
  return highlight ? splitAround(value, highlight) : ["", value, ""];
}

function splitAround(value: string, needle: string): readonly [string, string, string] {
  const index = value.indexOf(needle);
  if (index < 0) return [value, "", ""];
  return [value.slice(0, index), needle, value.slice(index + needle.length)];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
      {children}
    </section>
  );
}
